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

## the deadlock scenario

the `app.migrate` zero mutator (`test-chat/src/data/models/app.ts:62-64`):

```typescript
migrate: async ({ server }) => {
  await server?.actions.app.migrateInitialApps()
}
```

this runs **inside PushProcessor's transaction**. PushProcessor (from
@rocicorp/zero) wraps mutations in a BEGIN...COMMIT on Connection A.

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

additionally:

- interleaved connections can confuse pglite's protocol state
- any connection closing triggers ROLLBACK which kills the shared transaction

## key files

| file                                       | role                                                     |
| ------------------------------------------ | -------------------------------------------------------- |
| `src/pg-proxy.ts:696-714`                  | socket close → ROLLBACK + RESET (kills shared tx!)       |
| `src/replication/handler.ts:482-548`       | replication poll loop (mutex per poll)                   |
| `src/mutex.ts`                             | simple queue-based mutex, per-message serialization      |
| `test-chat/src/data/models/app.ts:62-64`   | app.migrate mutator (calls migrateInitialApps inside tx) |
| `test-chat/src/apps/migrateInitialApps.ts` | opens separate DB connections for direct SQL             |
| `test-chat/src/apps/publish.ts`            | uses getDb() Drizzle singleton for INSERT                |
| `test-chat/src/database/index.ts:11-33`    | getDb() creates pg.Pool singleton                        |

## connection flow during the bug

```
zero-cache → POST /api/zero/push
  → PushProcessor opens Connection A → BEGIN
  → runs mutation queries via Connection A
  → calls app.migrate mutator
    → migrateInitialApps()
      → opens Connection B (getDBClient)
      → SELECT via Connection B (runs in A's tx - pglite single session)
      → publishApp()
        → opens Connection C (getDb pool)
        → INSERT via Connection C (runs in A's tx)
      → client.release() → pool may close Connection B
      → socket.on('close') → ROLLBACK ← KILLS CONNECTION A'S TX
  → PushProcessor tries COMMIT → fails or confused state
```

## fix options

1. **move migrateInitialApps to asyncTask** (chat-side fix):

   ```typescript
   migrate: async ({ server }) => {
     server?.asyncTasks.push(async () => {
       await server?.actions.app.migrateInitialApps()
     })
   }
   ```

   asyncTasks run AFTER the transaction commits, with their own connections.

2. **don't ROLLBACK on connection close if another tx is active** (orez-side fix):
   the socket.on('close') handler in pg-proxy.ts blindly ROLLBACKs, which kills
   any active transaction from other connections. need to track whether this
   connection actually started a transaction.

3. **track per-connection transaction state** (orez-side fix):
   since pglite is single-session, we need to understand that BEGIN from one
   connection means ALL connections are in that transaction. only the connection
   that started the tx should ROLLBACK on close.

## investigation log

### session 1 (from compaction summary)

- replication handler confirmed working (11 changes streamed wm 3781→3792)
- only 1 handler active (no concurrent handler race)
- watermark type is `number` throughout
- SQLITE_CORRUPT from `PRAGMA optimize` crashes zero-cache
- first login 401 then succeeds on retry

### session 2 (current)

- mapped all mutex usage across codebase
- identified socket.on('close') ROLLBACK as potential transaction killer
- identified migrateInitialApps opening separate connections inside PushProcessor tx
- added diagnostic logging: connection tracking, BEGIN/COMMIT/ROLLBACK, cross-tx writes
- **diagnostic run 1** (partial, port conflict killed it early):
  - migration phase: conn#1 BEGIN→ROLLBACK→COMMIT (normal)
  - migrateInitialApps: conn#2 opens, admin NOT FOUND (no admin user yet), closes
  - zero-cache initial sync: conn#3-#48 open, MANY concurrent BEGINs on single-session
  - the txOwner tracking shows constant overwriting: `txOwner was 34` → `txOwner was 35` etc
  - pglite single-session means all these BEGINs share one tx context
  - initial sync somehow works despite this chaos (completes in prior runs)
- user confirmed: direct SQL inside server-only mutator is valid pattern that works
  in real postgres and regular zero. orez needs to handle it too.
- **diagnostic run 2** in progress — waiting for actual test setup phase

## next steps

1. run test with logging to confirm the actual failure sequence
2. determine which fix path to take (orez-side vs chat-side vs both)
3. implement fix
4. verify test passes
