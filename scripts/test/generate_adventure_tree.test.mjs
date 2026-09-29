import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { expect, test } from 'bun:test'

test('the generated adventure landmark matches its authored crown and source tree', () => {
  const script = fileURLToPath(new URL('../generate_adventure_tree.mjs', import.meta.url))
  expect(execFileSync(process.execPath, [script, '--check'], { encoding: 'utf8' })).toContain(
    'matches its authored recipe'
  )
})
