// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// TREE-FREEZE pure-core unit (RED-FIRST) — the fingerprint filter must (a) exclude every
// suite-written artifact path so the freeze never self-triggers, and (b) still move on ANY
// product-file line. Pure: porcelain text in → filtered text + sha256 out; no git, no fs.
//   run: bun test test/gold/tree_freeze_fingerprint.test.ts
import { describe, expect, it } from 'bun:test'

import { filter_porcelain, fingerprint, porcelain_diff } from './tree_freeze_fingerprint'

const PRODUCT_LINES = [
  ' M packages/frontend/src/world-shell/kiosk_resolve.js',
  '?? packages/move/aresrpg/sources/new_module.move',
]
const ARTIFACT_LINES = [
  '?? test/gold/out/pw-anchor/trace-1.zip', // playwright outputDir artifact
  '?? test/gold/out/.tree-freeze-fingerprint', // the freeze state file itself
  ' M packages/frontend/node_modules/.vite/deps/chunk-ABC.js', // primary vite optimizer cache
  '?? packages/frontend/node_modules/.vite-lagged/deps/chunk-DEF.js', // lagged-lane vite cache
  '?? test/gold/.playwright-artifacts-0/screenshot.png', // playwright temp staging dir
  '?? "test/gold/out/quoted name.png"', // git-quoted artifact path
]

describe('tree-freeze fingerprint (pure core: porcelain → suite-artifact filter → sha256)', () => {
  it('(a) excludes every suite-artifact line — artifacts never move the hash', () => {
    expect(filter_porcelain(ARTIFACT_LINES.join('\n'))).toBe('')
    const clean = fingerprint(PRODUCT_LINES.join('\n'))
    const noisy = fingerprint(
      [ARTIFACT_LINES[0], PRODUCT_LINES[0], ...ARTIFACT_LINES.slice(1), PRODUCT_LINES[1]].join('\n')
    )
    expect(noisy.hash).toBe(clean.hash)
    expect(noisy.filtered).toBe(clean.filtered)
  })

  it('(b) a product-file line CHANGES the hash', () => {
    const before = fingerprint(PRODUCT_LINES[0])
    const after = fingerprint([PRODUCT_LINES[0], ' M packages/frontend/src/app.jsx'].join('\n'))
    expect(after.hash).not.toBe(before.hash)
  })

  it('a status transition on the SAME path changes the hash (worktree-M → staged-M)', () => {
    expect(fingerprint(' M packages/frontend/src/app.jsx').hash).not.toBe(
      fingerprint('M  packages/frontend/src/app.jsx').hash
    )
  })

  it('a rename is KEPT when EITHER side is product source (unknown → trip, never silence)', () => {
    const line = 'R  packages/frontend/src/a.js -> test/gold/out/a.js'
    expect(filter_porcelain(line)).toBe(line)
    // …and dropped only when every side is suite-owned.
    expect(filter_porcelain('R  test/gold/out/a.zip -> test/gold/out/b.zip')).toBe('')
  })

  it('porcelain_diff names the drift as +/- lines', () => {
    const before = [PRODUCT_LINES[0], PRODUCT_LINES[1]].join('\n')
    const after = [PRODUCT_LINES[0], ' M packages/sim/src/reduce.js'].join('\n')
    const diff = porcelain_diff(before, after)
    expect(diff).toContain(`- ${PRODUCT_LINES[1]}`)
    expect(diff).toContain('+  M packages/sim/src/reduce.js')
  })

  it('empty tree → stable empty fingerprint', () => {
    expect(fingerprint('').filtered).toBe('')
    expect(fingerprint('\n').hash).toBe(fingerprint('').hash)
  })

  it('the ambient session prompt-log file is excluded from the fingerprint — any OTHER docs file still trips', () => {
    // The session's UserPromptSubmit hook appends to this ONE file on every prompt event, suites
    // included (fired the freeze in production 07-17) — outside any lane's control, app-benign.
    expect(filter_porcelain(' M docs/OWNER_PROMPTS.md')).toBe('')
    expect(filter_porcelain('MM docs/OWNER_PROMPTS.md')).toBe('')
    const base = fingerprint(PRODUCT_LINES.join('\n'))
    expect(fingerprint([...PRODUCT_LINES, 'MM docs/OWNER_PROMPTS.md'].join('\n')).hash).toBe(base.hash)
    // Sibling docs files are NOT ambient — they must keep moving the hash.
    const other_docs = ' M docs/GOLD_STANDARD_SUITE.md'
    expect(filter_porcelain(other_docs)).toBe(other_docs)
    expect(fingerprint([...PRODUCT_LINES, other_docs].join('\n')).hash).not.toBe(base.hash)
  })
})
