#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { existsSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { defineCommand, runMain } from 'citty'

import { startZeroLite } from './index.js'
import { log } from './log.js'

const s3Command = defineCommand({
  meta: {
    name: 's3',
    description: 'start a local s3-compatible server',
  },
  args: {
    port: {
      type: 'string',
      description: 'port to listen on',
      default: '9200',
    },
    'data-dir': {
      type: 'string',
      description: 'data directory for stored files',
      default: '.orez',
    },
  },
  async run({ args }) {
    const { startS3Local } = await import('./s3-local.js')
    const server = await startS3Local({
      port: Number(args.port),
      dataDir: args['data-dir'],
    })

    process.on('SIGINT', () => {
      server.close()
      process.exit(0)
    })
    process.on('SIGTERM', () => {
      server.close()
      process.exit(0)
    })
  },
})

const pgDumpCommand = defineCommand({
  meta: {
    name: 'pg_dump',
    description: 'dump the pglite postgres database to a SQL file',
  },
  args: {
    'data-dir': {
      type: 'string',
      description: 'data directory',
      default: '.orez',
    },
    output: {
      type: 'string',
      description: 'output file path (default: stdout)',
      alias: 'o',
    },
  },
  async run({ args }) {
    const { PGlite } = await import('@electric-sql/pglite')
    const { vector } = await import('@electric-sql/pglite/vector')
    const { pg_trgm } = await import('@electric-sql/pglite/contrib/pg_trgm')
    const { pgDump } = await import('@electric-sql/pglite-tools/pg_dump')

    const dataPath = resolve(args['data-dir'], 'pgdata-postgres')
    if (!existsSync(dataPath)) {
      console.error(`error: no database found at ${dataPath}`)
      process.exit(1)
    }

    let db: InstanceType<typeof PGlite> | undefined
    try {
      db = new PGlite({
        dataDir: dataPath,
        extensions: { vector, pg_trgm },
      })
      await db.waitReady

      const file = await pgDump({ pg: db })
      const sql = await file.text()

      if (args.output) {
        writeFileSync(args.output, sql)
        log.orez(`dump written to ${args.output}`)
      } else {
        process.stdout.write(sql)
      }
    } catch (err: any) {
      if (err?.message?.includes('lock')) {
        console.error(
          'error: database is locked — stop orez first before running pg_dump'
        )
      } else {
        console.error(`error: ${err?.message ?? err}`)
      }
      process.exit(1)
    } finally {
      await db?.close()
    }
  },
})

// extensions that don't exist in pglite — skip during restore
const UNSUPPORTED_EXTENSIONS = new Set([
  'pg_stat_statements',
  'pg_buffercache',
  'pg_freespacemap',
  'pg_prewarm',
  'pg_stat_kcache',
  'pg_wait_sampling',
  'auto_explain',
  'pg_cron',
])

// check if a statement should be skipped during restore
function shouldSkipStatement(stmt: string): boolean {
  const trimmed = stmt.trimStart()
  // skip psql meta-commands like \restrict
  if (trimmed.startsWith('\\')) return true
  // skip SET transaction_timeout (pg 18+ artifact)
  if (/^SET\s+transaction_timeout\b/i.test(trimmed)) return true
  // skip CREATE/DROP/COMMENT ON unsupported extensions
  const extMatch = trimmed.match(
    /^(?:CREATE\s+EXTENSION|DROP\s+EXTENSION|COMMENT\s+ON\s+EXTENSION)\b.*?\b(\w+)/i
  )
  if (extMatch && UNSUPPORTED_EXTENSIONS.has(extMatch[1])) return true
  return false
}

// stream a sql dump file statement-by-statement, skipping unsupported ones
async function execDumpFile(
  db: { exec: (sql: string) => Promise<unknown> },
  filePath: string
): Promise<{ executed: number; skipped: number }> {
  const { createReadStream } = await import('node:fs')
  const { createInterface } = await import('node:readline')

  const rl = createInterface({
    input: createReadStream(filePath, 'utf-8'),
    crlfDelay: Infinity,
  })

  let buf = ''
  let executed = 0
  let skipped = 0

  for await (const line of rl) {
    // skip empty lines and sql comments
    if (line === '' || line.startsWith('--')) continue

    buf += (buf ? '\n' : '') + line

    // statements end with ; at end of line (pg_dump always formats this way)
    if (!line.trimEnd().endsWith(';')) continue

    const stmt = buf
    buf = ''

    if (shouldSkipStatement(stmt)) {
      skipped++
      continue
    }

    await db.exec(stmt)
    executed++
  }

  // flush any remaining buffer
  if (buf.trim()) {
    if (!shouldSkipStatement(buf)) {
      await db.exec(buf)
      executed++
    } else {
      skipped++
    }
  }

  return { executed, skipped }
}

const pgRestoreCommand = defineCommand({
  meta: {
    name: 'pg_restore',
    description: 'restore a SQL dump into the pglite postgres database',
  },
  args: {
    file: {
      type: 'positional',
      description: 'SQL file to restore',
      required: true,
    },
    'data-dir': {
      type: 'string',
      description: 'data directory',
      default: '.orez',
    },
    clean: {
      type: 'boolean',
      description: 'drop and recreate public schema before restoring',
      default: false,
    },
  },
  async run({ args }) {
    const { PGlite } = await import('@electric-sql/pglite')
    const { vector } = await import('@electric-sql/pglite/vector')
    const { pg_trgm } = await import('@electric-sql/pglite/contrib/pg_trgm')

    const sqlFile = args.file
    if (!existsSync(sqlFile)) {
      console.error(`error: file not found: ${sqlFile}`)
      process.exit(1)
    }

    const dataPath = resolve(args['data-dir'], 'pgdata-postgres')

    let db: InstanceType<typeof PGlite> | undefined
    try {
      db = new PGlite({
        dataDir: dataPath,
        extensions: { vector, pg_trgm },
      })
      await db.waitReady

      if (args.clean) {
        log.orez('dropping and recreating public schema')
        await db.exec('DROP SCHEMA public CASCADE')
        await db.exec('CREATE SCHEMA public')
      }

      const { executed, skipped } = await execDumpFile(db, sqlFile)
      log.orez(
        `restored ${sqlFile} into ${dataPath} (${executed} statements, ${skipped} skipped)`
      )
    } catch (err: any) {
      if (err?.message?.includes('lock')) {
        console.error(
          'error: database is locked — stop orez first before running pg_restore'
        )
      } else {
        console.error(`error: ${err?.message ?? err}`)
      }
      process.exit(1)
    } finally {
      await db?.close()
    }
  },
})

const main = defineCommand({
  meta: {
    name: 'orez',
    description: 'pglite-powered zero-sync development backend',
  },
  args: {
    'pg-port': {
      type: 'string',
      description: 'postgresql proxy port',
      default: '6434',
    },
    'zero-port': {
      type: 'string',
      description: 'zero-cache port',
      default: '5849',
    },
    'data-dir': {
      type: 'string',
      description: 'data directory',
      default: '.orez',
    },
    migrations: {
      type: 'string',
      description: 'migrations directory',
      default: '',
    },
    seed: {
      type: 'string',
      description: 'seed file path',
      default: '',
    },
    'pg-user': {
      type: 'string',
      description: 'postgresql user',
      default: 'user',
    },
    'pg-password': {
      type: 'string',
      description: 'postgresql password',
      default: 'password',
    },
    'skip-zero-cache': {
      type: 'boolean',
      description: 'run pglite + proxy only, skip zero-cache',
      default: false,
    },
    'log-level': {
      type: 'string',
      description: 'log level: error, warn, info, debug (default: warn)',
    },
    s3: {
      type: 'boolean',
      description: 'also start a local s3-compatible server',
      default: false,
    },
    's3-port': {
      type: 'string',
      description: 's3 server port',
      default: '9200',
    },
    'disable-wasm-sqlite': {
      type: 'boolean',
      description: 'use native @rocicorp/zero-sqlite3 instead of wasm bedrock-sqlite',
      default: true,
    },
    'on-db-ready': {
      type: 'string',
      description: 'command to run after db+proxy are ready, before zero-cache starts',
      default: '',
    },
    'on-healthy': {
      type: 'string',
      description: 'command to run once all services are healthy',
      default: '',
    },
  },
  subCommands: {
    s3: s3Command,
    pg_dump: pgDumpCommand,
    pg_restore: pgRestoreCommand,
  },
  async run({ args }) {
    const { config, stop } = await startZeroLite({
      pgPort: Number(args['pg-port']),
      zeroPort: Number(args['zero-port']),
      dataDir: args['data-dir'],
      migrationsDir: args.migrations,
      seedFile: args.seed,
      pgUser: args['pg-user'],
      pgPassword: args['pg-password'],
      skipZeroCache: args['skip-zero-cache'],
      disableWasmSqlite: args['disable-wasm-sqlite'],
      logLevel: (args['log-level'] as 'error' | 'warn' | 'info' | 'debug') || undefined,
      onDbReady: args['on-db-ready'],
    })

    let s3Server: import('node:http').Server | null = null
    if (args.s3) {
      const { startS3Local } = await import('./s3-local.js')
      s3Server = await startS3Local({
        port: Number(args['s3-port']),
        dataDir: args['data-dir'],
      })
    }

    log.orez('ready')
    log.orez(
      `pg: postgresql://${config.pgUser}:${config.pgPassword}@127.0.0.1:${config.pgPort}/postgres`
    )
    if (!config.skipZeroCache) {
      log.zero(`http://localhost:${config.zeroPort}`)
    }

    if (args['on-healthy']) {
      log.orez(`running on-healthy: ${args['on-healthy']}`)
      const child = spawn(args['on-healthy'], {
        shell: true,
        stdio: 'inherit',
        env: {
          ...process.env,
          OREZ_PG_PORT: String(config.pgPort),
          OREZ_ZERO_PORT: String(config.zeroPort),
        },
      })
      child.on('exit', (code) => {
        if (code !== 0 && code !== null) {
          log.orez(`on-healthy command exited with code ${code}`)
        }
      })
    }

    process.on('SIGINT', async () => {
      s3Server?.close()
      await stop()
      process.exit(0)
    })
    process.on('SIGTERM', async () => {
      s3Server?.close()
      await stop()
      process.exit(0)
    })
  },
})

runMain(main)
