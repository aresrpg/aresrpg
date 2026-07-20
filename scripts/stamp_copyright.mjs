#!/usr/bin/env node
// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// stamp_copyright.mjs — per-file SPDX license headers, idempotent.
//
// Every SOURCE file carries the license identity so snippets travel with their terms (per-file
// marking survives separation from the LICENSE file). Comment syntax per class; JSON/lockfiles/
// markdown/binaries are skipped (no comment channel or not source). Running twice is a no-op;
// check-constraints' SPDX leg enforces presence on every new file.
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

const SPDX = 'SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available'
const OWNER = '© 2026 Sceat — All rights reserved. See LICENSE.'

const CLASSES = [
  { exts: ['js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'move', 'rs'], open: '// ', close: '' },
  { exts: ['css'], open: '/* ', close: ' */' },
  { exts: ['sh', 'yml', 'yaml'], open: '# ', close: '' },
]

const class_of = file => {
  const ext = file.split('.').pop()
  return CLASSES.find(c => c.exts.includes(ext))
}

const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
  .split('\0')
  .filter(Boolean)
  .filter(f => class_of(f) !== undefined)

const stamped = files.filter(file => {
  const text = readFileSync(file, 'utf8')
  const head = text.split('\n').slice(0, 3).join('\n')
  if (head.includes('SPDX-License-Identifier')) return false // idempotent
  const { open, close } = class_of(file)
  const header = `${open}${SPDX}${close}\n${open}${OWNER}${close}\n`
  // shebang stays line 1
  const out = text.startsWith('#!')
    ? text.replace(/^(#![^\n]*\n)/, `$1${header}`)
    : header + text
  writeFileSync(file, out)
  return true
})
console.log(`stamped ${stamped.length}/${files.length} files (${files.length - stamped.length} already carried the header)`)
