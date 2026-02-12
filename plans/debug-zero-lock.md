0.0.37 WORKING!!!!!!!!!!

0.0.38 BROKEN!

we fixed pg_restore in 0.38+ but it broke something basic

# debug: pglite deadlock during zero mutation + direct sql

## problem

test-chat integration test fails during setup. the user identified this as a
deadlock caused by running direct SQL mutations during an active zero mutation.
NOT a login failure, NOT primarily the SQLITE_CORRUPT issue.

## architecture context

- pglite is **single-session**: all TCP connections share one postgres backend
- a `Mutex` serializes all pglite access (per-message, not per-transaction)
- the mutex releases between each wire protocol message
- three independent mutexes for three pglite instances (postgres, cvr, cdb)

## the deadlock scenario (original bug, FIXED)

the `app.migrate` zero mutator (`test-chat/src/data/models/app.ts:62-66`):

```typescript
migrate: async ({ server }) => {
  server?.asyncTasks.push(async () => {
    await server?.actions.app.migrateInitialApps()
  })
}
```

note: code now uses asyncTasks correctly (heavy work runs after tx commit).

`migrateInitialApps()` (`test-chat/src/apps/migrateInitialApps.ts:33-83`):

1. opens Connection B via `getDBClient({ connectionString: ZERO_UPSTREAM_DB })`
2. runs `SELECT * FROM userPublic` (Connection B, through proxy)
3. calls `publishApp()` which uses `getDb()` (Connection C, Drizzle singleton)
4. `publishApp()` does INSERT/UPDATE on `app` table (Connection C, through proxy)

because pglite is single-session:

- Connection A has an open BEGIN (PushProcessor's transaction)
- Connection B's queries run inside Connection A's transaction
- Connection C's INSERT also runs inside Connection A's transaction
- when Connection B releases (client.release()), the pool may send cleanup
- the socket.on('close') handler runs ROLLBACK + RESET on pglite
- this ROLLBACK kills Connection A's transaction!
