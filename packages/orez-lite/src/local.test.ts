import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { createLocalApplicationSqlClientFactory } from './local.js'

const unusedCompiler = () => {
  throw new Error('unexpected AST query')
}
const directories: string[] = []
const factories: ReturnType<typeof createLocalApplicationSqlClientFactory>[] = []
function setup() {
  const dataDir = mkdtempSync(join(tmpdir(), 'orez-local-sql-'))
  const factory = createLocalApplicationSqlClientFactory({ dataDir })
  directories.push(dataDir)
  factories.push(factory)
  return factory
}
afterEach(async () => {
  for (const factory of factories.splice(0)) await factory.close()
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true })
})

describe('local application SQL', () => {
  it('executes bound queries and compiled plans, and rolls back a rejected batch', async () => {
    const factory = setup()
    const client = factory('app')
    expect(factory('app')).toBe(client)
    expect(() => factory('../escape')).toThrow('invalid application SQLite namespace')
    await client.transaction(unusedCompiler, async (tx) => {
      await tx.exec('CREATE TABLE item (id TEXT PRIMARY KEY, enabled INTEGER)')
      expect(
        await tx.execMany([
          { sql: 'INSERT INTO item VALUES (?, ?)', params: ['first', true] },
          { sql: 'INSERT INTO item VALUES (?, ?)', params: ['second', false] },
        ])
      ).toEqual([{ changes: 1 }, { changes: 1 }])
    })
    const compiler = () => ({
      rootTable: 'item',
      planHash: '0123456789abcdef',
      root: {
        table: 'item',
        singular: false,
        sql: 'SELECT id, enabled FROM item WHERE id = ?',
        bindings: [
          { kind: 'literal' as const, value: { kind: 'text' as const, value: 'first' } },
        ],
        columns: [
          { name: 'id', columnType: 'string' as const },
          { name: 'enabled', columnType: 'boolean' as const },
        ],
        relationships: [],
      },
    })
    expect(
      await client.transaction(compiler, (tx) =>
        tx.queryAst({}, { singular: false, relationships: {} })
      )
    ).toEqual([{ id: 'first', enabled: true }])
    await expect(
      client.transaction(unusedCompiler, async (tx) => {
        await tx.execMany([
          { sql: 'INSERT INTO item VALUES (?, ?)', params: ['third', true] },
          { sql: 'INSERT INTO item VALUES (?, ?)', params: ['first', false] },
        ])
      })
    ).rejects.toThrow('UNIQUE')
    expect(
      await client.transaction(unusedCompiler, (tx) =>
        tx.query('SELECT * FROM item ORDER BY id')
      )
    ).toEqual([
      { id: 'first', enabled: 1 },
      { id: 'second', enabled: 0 },
    ])
    await expect(
      client.transaction(
        compiler,
        (tx) => tx.queryAst({}, { singular: false, relationships: {} }),
        { maxRows: 0 }
      )
    ).rejects.toThrow()
  })

  it('rejects nested transactions, releases the queue after rollback, and drains on close', async () => {
    const factory = setup()
    const client = factory('app')
    await client.transaction(unusedCompiler, (tx) =>
      tx.exec('CREATE TABLE item (id TEXT)')
    )
    await expect(
      client.transaction(unusedCompiler, async (tx) => {
        await tx.exec('INSERT INTO item VALUES (?)', ['rolled-back'])
        await client.transaction(unusedCompiler, () => undefined)
      })
    ).rejects.toThrow('nested SQLite transactions')
    let entered!: () => void
    const started = new Promise<void>((resolve) => {
      entered = resolve
    })
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const first = client.transaction(unusedCompiler, async (tx) => {
      entered()
      await gate
      await tx.exec('INSERT INTO item VALUES (?)', ['committed'])
      return tx
    })
    await started
    const second = client.transaction(unusedCompiler, (tx) =>
      tx.query('SELECT * FROM item')
    )
    const closing = factory.close()
    await expect(client.transaction(unusedCompiler, () => undefined)).rejects.toThrow(
      'closed'
    )
    release()
    const escaped = await first
    expect(await second).toEqual([{ id: 'committed' }])
    await closing
    await expect(escaped.query('SELECT 1')).rejects.toThrow('transaction has ended')
  })
})
