// require hook: intercepts @rocicorp/zero-sqlite3 to use native if available,
// falling back to bedrock-sqlite (wasm) seamlessly.
// loaded via NODE_OPTIONS='--require ./sqlite-loader.cjs'.
// avoids patching files in node_modules — module resolution is intercepted in-process.
'use strict'

const Module = require('module')
const path = require('path')

const shimPath = path.resolve(__dirname, 'sqlite-shim.cjs')
const originalResolveFilename = Module._resolveFilename

// check once at startup whether native bindings work
let nativeWorks = false
try {
  const nativePath = originalResolveFilename.call(
    Module,
    '@rocicorp/zero-sqlite3',
    module,
    false
  )
  // actually load it to confirm native addon binds
  const native = require(nativePath)
  const testDb = new native(':memory:')
  testDb.close()
  nativeWorks = true
} catch {}

if (!nativeWorks) {
  Module._resolveFilename = function (request, parent, isMain, options) {
    // intercept any require of @rocicorp/zero-sqlite3 (main or subpaths)
    if (
      request === '@rocicorp/zero-sqlite3' ||
      request.startsWith('@rocicorp/zero-sqlite3/')
    ) {
      return shimPath
    }
    return originalResolveFilename.call(this, request, parent, isMain, options)
  }
}
