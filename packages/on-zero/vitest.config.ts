import { orezSyncCfHostWasm } from 'orez-lite/cloudflare/vite-wasm-loader'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [orezSyncCfHostWasm()],
  test: {
    exclude: ['dist/**', 'node_modules/**'],
    setupFiles: ['./src/testSetup.ts'],
  },
})
