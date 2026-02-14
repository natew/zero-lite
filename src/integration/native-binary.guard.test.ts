import { describe, expect, test } from 'vitest'

import {
  formatNativeBootstrapInstructions,
  inspectNativeSqliteBinary,
} from '../sqlite-mode/native-binary.js'

describe('native sqlite binary guard', () => {
  test('better_sqlite3.node is present before native integration tests', () => {
    const check = inspectNativeSqliteBinary()
    expect(check.found, formatNativeBootstrapInstructions(check)).toBe(true)
  })
})
