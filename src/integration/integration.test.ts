/**
 * integration test adapted from zero-cache's integration.pg.test.ts
 *
 * validates the full sync pipeline: pglite → change tracking → replication
 * protocol → zero-cache → websocket poke messages to clients.
 *
 * uses orez's startZeroLite() instead of real postgres + manual zero-cache.
 */

import { describe, expect, test, beforeEach } from 'vitest'
import WebSocket from 'ws'
import { startZeroLite } from '../index.js'
import type { PGlite } from '@electric-sql/pglite'

// simple async queue for collecting websocket messages
class Queue<T> {
  private items: T[] = []
  private waiters: Array<{ resolve: (v: T) => void; timer?: ReturnType<typeof setTimeout> }> = []

  enqueue(item: T) {
    const waiter = this.waiters.shift()
    if (waiter) {
      if (waiter.timer) clearTimeout(waiter.timer)
      waiter.resolve(item)
    } else {
      this.items.push(item)
    }
  }

  dequeue(fallback?: T, timeoutMs = 10000): Promise<T> {
    if (this.items.length > 0) {
      return Promise.resolve(this.items.shift()!)
    }
    return new Promise<T>((resolve) => {
      const waiter: { resolve: (v: T) => void; timer?: ReturnType<typeof setTimeout> } = {
        resolve,
      }
      if (fallback !== undefined) {
        waiter.timer = setTimeout(() => {
          const idx = this.waiters.indexOf(waiter)
          if (idx >= 0) this.waiters.splice(idx, 1)
          resolve(fallback)
        }, timeoutMs)
      }
      this.waiters.push(waiter)
    })
  }
}

const WATERMARK_REGEX = /[0-9a-z]{2,}/

describe('orez integration', { timeout: 60000 }, () => {
  let db: PGlite
  let zeroPort: number
  let pgPort: number
  let shutdown: () => Promise<void>

  beforeEach(async () => {
    // find available ports in high range to avoid conflicts
    const testPgPort = 23000 + Math.floor(Math.random() * 1000)
    const testZeroPort = testPgPort + 100

    const dataDir = `.orez-integration-test-${Date.now()}`
    const result = await startZeroLite({
      pgPort: testPgPort,
      zeroPort: testZeroPort,
      dataDir,
      logLevel: 'error',
      skipZeroCache: false,
    })

    db = result.db
    zeroPort = result.zeroPort
    pgPort = result.pgPort
    shutdown = result.stop

    // create test tables
    await db.exec(`
      CREATE TABLE IF NOT EXISTS foo (
        id TEXT PRIMARY KEY,
        value TEXT,
        num INTEGER
      );

      CREATE TABLE IF NOT EXISTS bar (
        id TEXT PRIMARY KEY,
        foo_id TEXT
      );

      -- publication for zero-cache
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_publication WHERE pubname = 'zero_test'
        ) THEN
          CREATE PUBLICATION zero_test FOR TABLE foo, TABLE bar;
        END IF;
      END $$;
    `)

    return async () => {
      await shutdown()
      // clean up data dir
      const { rmSync } = await import('node:fs')
      try {
        rmSync(dataDir, { recursive: true, force: true })
      } catch {}
    }
  })

  test('zero-cache starts and accepts websocket connections', async () => {
    // wait for zero-cache to be ready
    await waitForZero(zeroPort)

    const ws = new WebSocket(
      `ws://localhost:${zeroPort}/sync/v4/connect` +
        `?clientGroupID=test-cg&clientID=test-client&wsid=ws1&schemaVersion=1&baseCookie=&ts=${Date.now()}&lmid=0`,
    )

    const connected = new Promise<void>((resolve, reject) => {
      ws.on('open', resolve)
      ws.on('error', reject)
      setTimeout(() => reject(new Error('ws connect timeout')), 5000)
    })

    await connected

    const firstMessage = await new Promise<unknown>((resolve) => {
      ws.on('message', (data) => {
        resolve(JSON.parse(data.toString()))
      })
    })

    expect(firstMessage).toMatchObject(['connected', { wsid: 'ws1' }])

    ws.close()
  })

  test('initial sync delivers existing rows via poke', async () => {
    // insert data before connecting
    await db.query(`INSERT INTO foo (id, value, num) VALUES ($1, $2, $3)`, [
      'row1',
      'hello',
      42,
    ])

    await waitForZero(zeroPort)

    const downstream = new Queue<unknown>()
    const ws = connectAndSubscribe(zeroPort, downstream, {
      table: 'foo',
      orderBy: [['id', 'asc']],
    })

    // connected
    expect(await downstream.dequeue()).toMatchObject(['connected', { wsid: 'ws1' }])

    // initial poke sequence
    expect(await downstream.dequeue()).toMatchObject(['pokeStart', expect.anything()])
    expect(await downstream.dequeue()).toMatchObject(['pokeEnd', expect.anything()])

    // query registration poke
    expect(await downstream.dequeue()).toMatchObject(['pokeStart', expect.anything()])
    expect(await downstream.dequeue()).toMatchObject([
      'pokePart',
      expect.objectContaining({
        desiredQueriesPatches: expect.anything(),
      }),
    ])
    expect(await downstream.dequeue()).toMatchObject(['pokeEnd', expect.anything()])

    // data poke with rows
    const pokeStart = (await downstream.dequeue()) as [string, { pokeID: string }]
    expect(pokeStart[0]).toBe('pokeStart')

    const pokePart = (await downstream.dequeue()) as [string, Record<string, unknown>]
    expect(pokePart[0]).toBe('pokePart')
    expect(pokePart[1].rowsPatch).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          op: 'put',
          tableName: 'foo',
          value: expect.objectContaining({
            id: 'row1',
            value: 'hello',
          }),
        }),
      ]),
    )

    expect(await downstream.dequeue()).toMatchObject(['pokeEnd', expect.anything()])

    ws.close()
  })

  test('live replication: insert triggers poke', async () => {
    await waitForZero(zeroPort)

    const downstream = new Queue<unknown>()
    const ws = connectAndSubscribe(zeroPort, downstream, {
      table: 'foo',
      orderBy: [['id', 'asc']],
    })

    // drain initial connection + sync pokes
    await drainInitialPokes(downstream)

    // now insert data - this should trigger a replication poke
    await db.query(`INSERT INTO foo (id, value, num) VALUES ($1, $2, $3)`, [
      'live-row',
      'live-value',
      99,
    ])

    // wait for the replication poke
    const poke = await waitForPokePart(downstream, 15000)
    expect(poke.rowsPatch).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          op: 'put',
          tableName: 'foo',
          value: expect.objectContaining({
            id: 'live-row',
            value: 'live-value',
          }),
        }),
      ]),
    )

    ws.close()
  })

  test('live replication: update triggers poke', async () => {
    // insert initial data
    await db.query(`INSERT INTO foo (id, value, num) VALUES ($1, $2, $3)`, [
      'upd-row',
      'original',
      1,
    ])

    await waitForZero(zeroPort)

    const downstream = new Queue<unknown>()
    const ws = connectAndSubscribe(zeroPort, downstream, {
      table: 'foo',
      orderBy: [['id', 'asc']],
    })

    await drainInitialPokes(downstream)

    // update the row
    await db.query(`UPDATE foo SET value = $1, num = $2 WHERE id = $3`, [
      'updated',
      2,
      'upd-row',
    ])

    const poke = await waitForPokePart(downstream, 15000)
    expect(poke.rowsPatch).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          op: 'put',
          tableName: 'foo',
          value: expect.objectContaining({
            id: 'upd-row',
            value: 'updated',
          }),
        }),
      ]),
    )

    ws.close()
  })

  test('live replication: delete triggers poke', async () => {
    await db.query(`INSERT INTO foo (id, value, num) VALUES ($1, $2, $3)`, [
      'del-row',
      'to-delete',
      1,
    ])

    await waitForZero(zeroPort)

    const downstream = new Queue<unknown>()
    const ws = connectAndSubscribe(zeroPort, downstream, {
      table: 'foo',
      orderBy: [['id', 'asc']],
    })

    await drainInitialPokes(downstream)

    // delete the row
    await db.query(`DELETE FROM foo WHERE id = $1`, ['del-row'])

    const poke = await waitForPokePart(downstream, 15000)
    expect(poke.rowsPatch).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          op: 'del',
          tableName: 'foo',
        }),
      ]),
    )

    ws.close()
  })

  test('concurrent inserts all replicate', async () => {
    await waitForZero(zeroPort)

    const downstream = new Queue<unknown>()
    const ws = connectAndSubscribe(zeroPort, downstream, {
      table: 'foo',
      orderBy: [['id', 'asc']],
    })

    await drainInitialPokes(downstream)

    // insert 5 rows concurrently
    await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        db.query(`INSERT INTO foo (id, value, num) VALUES ($1, $2, $3)`, [
          `concurrent-${i}`,
          `value-${i}`,
          i,
        ]),
      ),
    )

    // collect all poke parts within a window
    const allRows = await collectPokeRows(downstream, 15000)
    const ids = allRows
      .filter((r: any) => r.op === 'put' && r.tableName === 'foo')
      .map((r: any) => r.value.id)
      .sort()

    expect(ids).toEqual([
      'concurrent-0',
      'concurrent-1',
      'concurrent-2',
      'concurrent-3',
      'concurrent-4',
    ])

    ws.close()
  })

  // --- helpers ---

  function connectAndSubscribe(
    port: number,
    downstream: Queue<unknown>,
    query: Record<string, unknown>,
  ): WebSocket {
    const ws = new WebSocket(
      `ws://localhost:${port}/sync/v4/connect` +
        `?clientGroupID=test-cg-${Date.now()}&clientID=test-client&wsid=ws1&schemaVersion=1&baseCookie=&ts=${Date.now()}&lmid=0`,
    )

    ws.on('message', (data) => {
      downstream.enqueue(JSON.parse(data.toString()))
    })

    ws.on('open', () => {
      ws.send(
        JSON.stringify([
          'initConnection',
          {
            desiredQueriesPatch: [{ op: 'put', hash: 'q1', ast: query }],
          },
        ]),
      )
    })

    return ws
  }

  async function drainInitialPokes(downstream: Queue<unknown>) {
    // drain messages until we've seen the initial data sync complete
    // pattern: connected → pokeStart/End → pokeStart/pokePart(queries)/pokeEnd → pokeStart/pokePart(data)/pokeEnd
    let settled = false
    const timeout = Date.now() + 30000

    while (!settled && Date.now() < timeout) {
      const msg = (await downstream.dequeue('timeout' as any, 2000)) as any
      if (msg === 'timeout') {
        settled = true
      } else if (Array.isArray(msg) && msg[0] === 'pokeEnd') {
        // after a pokeEnd, check if another poke comes quickly
        const next = (await downstream.dequeue('timeout' as any, 1500)) as any
        if (next === 'timeout') {
          settled = true
        } else {
          // got another poke, keep draining
        }
      }
    }
  }

  async function waitForPokePart(
    downstream: Queue<unknown>,
    timeoutMs = 10000,
  ): Promise<Record<string, any>> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const msg = (await downstream.dequeue('timeout' as any, timeoutMs)) as any
      if (msg === 'timeout') throw new Error('timed out waiting for pokePart')
      if (Array.isArray(msg) && msg[0] === 'pokePart' && msg[1]?.rowsPatch) {
        return msg[1]
      }
    }
    throw new Error('timed out waiting for pokePart')
  }

  async function collectPokeRows(
    downstream: Queue<unknown>,
    windowMs = 5000,
  ): Promise<any[]> {
    const rows: any[] = []
    const deadline = Date.now() + windowMs
    while (Date.now() < deadline) {
      const msg = (await downstream.dequeue('timeout' as any, 2000)) as any
      if (msg === 'timeout') break
      if (Array.isArray(msg) && msg[0] === 'pokePart' && msg[1]?.rowsPatch) {
        rows.push(...msg[1].rowsPatch)
      }
    }
    return rows
  }
})

async function waitForZero(port: number, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://localhost:${port}/`)
      if (res.ok || res.status === 404) return
    } catch {}
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`zero-cache not ready on port ${port} after ${timeoutMs}ms`)
}
