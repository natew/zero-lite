import { AsyncLocalStorage } from 'node:async_hooks'
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'

import { createSchema, string, table } from '@rocicorp/zero'
import {
  createSQLiteApplicationDatabase,
  createSyncExecutor,
  type ApplicationTransaction,
} from 'orez-lite'
import { createQueryCompiler } from 'orez-lite/cloudflare/query-compiler'
import { executeTransactionQueryPlan } from 'orez-lite/cloudflare/transaction-query'
import { afterAll, describe, expect, test, vi } from 'vitest'

import { createZeroServerBindings, setupAsyncLocalStorage } from './server'

const previousEnvironment = vi.hoisted(() => {
  const previous = process.env.VITE_ENVIRONMENT
  process.env.VITE_ENVIRONMENT = 'client'
  return previous
})

afterAll(() => {
  if (previousEnvironment === undefined) delete process.env.VITE_ENVIRONMENT
  else process.env.VITE_ENVIRONMENT = previousEnvironment
})

import { mutations } from './mutations'
import { serverWhere } from './serverWhere'

describe('mutations registry', () => {
  test('re-registering a handler replaces it per key (HMR)', () => {
    const permissions = serverWhere('post', () => true)
    const v1 = async () => {}
    const v2 = async () => {}
    mutations('post', permissions, { custom: v1 })
    const proxy = mutations('post', permissions, { custom: v2 })
    // per-key merge must still take the newest registration for an edited
    // handler, otherwise HMR would pin the stale implementation
    expect(proxy.custom).toBe(v2)
  })
})

describe('generated CRUD authorization', () => {
  test('authorizes both sides of composite-key writes through the server executor', async () => {
    setupAsyncLocalStorage(AsyncLocalStorage)
    const document = table('document')
      .columns({
        workspace: string(),
        id: string(),
        ownerId: string(),
        title: string(),
      })
      .primaryKey('workspace', 'id')
    const schema = createSchema({
      tables: [document],
      relationships: [],
      enableLegacyQueries: true,
    })
    const sqlite = new DatabaseSync(':memory:')
    sqlite.exec(
      'CREATE TABLE document (workspace TEXT, id TEXT, ownerId TEXT, title TEXT, PRIMARY KEY (workspace, id))'
    )
    const compile = createQueryCompiler(schema)
    const query: ApplicationTransaction['query'] = async (sql, params = []) =>
      sqlite.prepare(sql).all(...params.map((value) => value as SQLInputValue)) as any
    const tx: ApplicationTransaction = {
      query,
      exec: async (sql, params = []) => ({
        changes: Number(
          sqlite.prepare(sql).run(...params.map((value) => value as SQLInputValue))
            .changes
        ),
      }),
      queryAst: async (ast, format, queryName) =>
        executeTransactionQueryPlan(
          compile(ast, format),
          (sql, params) =>
            sqlite.prepare(sql).all(...params.map((value) => value as SQLInputValue)),
          { queryName }
        ),
    }
    const database = createSQLiteApplicationDatabase({
      query,
      transaction: async (work) => {
        sqlite.exec('BEGIN')
        try {
          const result = await work(tx)
          sqlite.exec('COMMIT')
          return result
        } catch (error) {
          sqlite.exec('ROLLBACK')
          throw error
        }
      },
    })
    const permission = serverWhere('document', (eb, auth) =>
      eb.cmp(
        'ownerId',
        auth && 'id' in auth && typeof auth.id === 'string' ? auth.id : ''
      )
    )
    const bindings = createZeroServerBindings({
      schema,
      models: { document: { mutate: mutations(document, permission) } },
      createServerActions: () => ({}),
    })
    const executor = createSyncExecutor({
      database,
      schema,
      mutators: bindings.mutators,
      effects: {
        runBackground: (promise) => promise,
        report: (error) => {
          throw error
        },
      },
    })
    const server = bindings.server(executor)
    const auth = { authData: { id: 'alice' } }
    const own = { workspace: 'a', id: 'same', ownerId: 'alice', title: 'own' }
    const foreign = { workspace: 'b', id: 'same', ownerId: 'bob', title: 'foreign' }
    try {
      await server.mutate.document.insert(own, auth)
      await server.mutate.document.insert(foreign, { authData: { id: 'bob' } })
      await expect(
        server.mutate.document.insert({ ...foreign, id: 'forbidden' }, auth)
      ).rejects.toThrow()
      await expect(
        server.mutate.document.upsert({ ...foreign, ownerId: 'alice' }, auth)
      ).rejects.toThrow()
      await expect(
        server.mutate.document.update({ ...own, ownerId: 'bob' }, auth)
      ).rejects.toThrow()
      await expect(
        server.mutate.document.upsert({ ...own, ownerId: 'bob' }, auth)
      ).rejects.toThrow()
      await expect(
        server.mutate.document.upsert({ ...foreign, id: 'missing' }, auth)
      ).rejects.toThrow()
      await server.mutate.document.upsert({ ...own, title: 'updated' }, auth)
      await server.mutate.document.upsert({ ...own, title: 'updated' }, auth)
      await server.mutate.document.upsert({ ...own, id: 'new' }, auth)
      expect(
        sqlite.prepare('SELECT * FROM document ORDER BY workspace, id').all()
      ).toEqual([{ ...own, id: 'new' }, { ...own, title: 'updated' }, foreign])
    } finally {
      sqlite.close()
    }
  })
})
