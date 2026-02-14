import { createRequire } from 'node:module'

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
