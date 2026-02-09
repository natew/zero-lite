#!/usr/bin/env bun

import { resolve } from 'node:path'
import { startZeroLite } from '../../src/index'

const root = resolve(import.meta.dirname, '..')

const { config, stop } = await startZeroLite({
  dataDir: resolve(root, '.zero-lite'),
  migrationsDir: resolve(root, 'src/database/migrations'),
  seedFile: resolve(root, 'src/database/seed.sql'),
  webPort: 3456,
  zeroPort: 4849,
  pgPort: 6435,
  s3Port: 10202,
})

console.info(`\nzerolite demo backend ready:`)
console.info(`  postgres: postgresql://user:password@127.0.0.1:${config.pgPort}/postgres`)
console.info(`  zero-cache: http://127.0.0.1:${config.zeroPort}`)
console.info(`  s3: http://127.0.0.1:${config.s3Port}`)
console.info(`\npress ctrl+c to stop\n`)

process.on('SIGINT', async () => {
  await stop()
  process.exit(0)
})

process.on('SIGTERM', async () => {
  await stop()
  process.exit(0)
})
