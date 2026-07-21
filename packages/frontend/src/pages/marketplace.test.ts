// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

import { describe, expect, test } from 'bun:test'

const PAGE_PATH = new URL('./marketplace.tsx', import.meta.url)
const CSS_PATH = new URL('../index.css', import.meta.url)
// Re-pinned (#117): the public-repo extraction pass (v1.12.36, "AresRPG — fresh public root") shifted bytes
// in both pinned sections with no functional change — verified against this file's own content assertions
// (test 3 below, unaffected) plus a manual read of the current source: a complete, correct 4-tab ARIA
// tablist + its sliding-thumb CSS, no truncation, no leftover private-tree references.
const MODE_SWITCH_SHA = '288d044e952588fa60f5c83c1bb9104ebb67664a2c14e27ac6dfb5268f89d086'
const MODE_CSS_SHA = '6e94419f3f069dc49f399dff0e5b7db08e36c254f16da34214fa5f9e6dc87141'

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

describe('MarketplacePage D750 shell', () => {
  test('keeps the four-mode switch implementation byte-for-byte', () => {
    const source = readFileSync(PAGE_PATH, 'utf8')
    const switch_source = source.slice(source.indexOf('type Tab ='), source.indexOf('export function MarketplacePage'))
    expect(sha256(switch_source)).toBe(MODE_SWITCH_SHA)
  })

  test('keeps the existing switch animation CSS byte-for-byte', () => {
    const source = readFileSync(CSS_PATH, 'utf8')
    const switch_css = source.slice(
      source.indexOf('/* Marketplace primary MODE switch'),
      source.indexOf('/* static KPI/stat chip')
    )
    expect(sha256(switch_css)).toBe(MODE_CSS_SHA)
  })

  test('mounts the ornamental frame around the full tab panel', () => {
    const source = readFileSync(PAGE_PATH, 'utf8')
    expect(source).toContain('<MarketplaceFrameCorners />')
    expect(source).toContain('<MarketplaceFrameOrnament />')
    expect(source).toContain('<ModeSwitch tab={tab} on_change={set_tab} />')
    expect(source).toContain('shrink-0 overflow-x-auto overscroll-x-contain')
    expect(source).not.toContain('maxWidth')
  })
})
