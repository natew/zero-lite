/**
 * mode resolution - canonical place to determine sqlite mode from config/env
 *
 * priority:
 * 1. explicit --disable-wasm-sqlite flag → native
 * 2. explicit --force-wasm-sqlite flag → wasm
 * 3. native binary available → native (auto-detect)
 * 4. fallback → wasm
 */

import { createRequire } from 'node:module'

import { inspectNativeSqliteBinary } from './native-binary.js'
import type { SqliteMode, SqliteModeConfig } from './types.js'

/**
 * resolve a package entry path
 * import.meta.resolve doesn't work in vitest, so we fall back to require.resolve
 */
export function resolvePackage(pkg: string): string {
  try {
    const resolved = import.meta.resolve(pkg)
    if (resolved) return resolved.replace('file://', '')
  } catch {}
  try {
    const require = createRequire(import.meta.url)
    return require.resolve(pkg)
  } catch {}
  return ''
}

/**
 * resolve sqlite mode from config
 * single source of truth for mode selection
 *
 * @param disableWasmSqlite - explicit flag to force native mode
 * @param forceWasmSqlite - explicit flag to force wasm mode (overrides auto-detect)
 */
export function resolveSqliteMode(
  disableWasmSqlite: boolean,
  forceWasmSqlite: boolean = false
): SqliteMode {
  // explicit native request
  if (disableWasmSqlite) return 'native'

  // explicit wasm request
  if (forceWasmSqlite) return 'wasm'

  // auto-detect: prefer native if binary is available
  const nativeCheck = inspectNativeSqliteBinary()
  if (nativeCheck.found) return 'native'

  // fallback to wasm
  return 'wasm'
}

/**
 * resolve full sqlite mode config including paths
 * returns null if required packages aren't installed
 */
export function resolveSqliteModeConfig(
  disableWasmSqlite: boolean,
  forceWasmSqlite: boolean = false
): SqliteModeConfig | null {
  const mode = resolveSqliteMode(disableWasmSqlite, forceWasmSqlite)
  const zeroSqlitePath = resolvePackage('@rocicorp/zero-sqlite3') || undefined

  // native mode may still need zero-sqlite3 path for restoring from a prior shim
  if (mode === 'native') {
    return { mode, zeroSqlitePath }
  }

  // wasm mode needs bedrock-sqlite and zero-sqlite3 paths
  const bedrockPath = resolvePackage('bedrock-sqlite')

  if (!bedrockPath) {
    return null // bedrock-sqlite not installed
  }

  if (!zeroSqlitePath) {
    return null // zero-sqlite3 not installed
  }

  return {
    mode,
    bedrockPath,
    zeroSqlitePath,
  }
}

/**
 * get mode display string for logging
 */
export function getModeDisplayString(mode: SqliteMode): string {
  return mode
}
