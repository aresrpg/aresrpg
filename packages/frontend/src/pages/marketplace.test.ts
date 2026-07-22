// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

import { describe, expect, test } from 'bun:test'

const PAGE_PATH = new URL('./marketplace.tsx', import.meta.url)
const CSS_PATH = new URL('../index.css', import.meta.url)
// Re-pinned (BUILD #180): the HISTORY tab grew a red proceeds-dot (kiosk_profits_mist > 0, house danger-red
// #f87171, decorative aria-hidden) — a deliberate, reviewed change to ModeSwitch itself, not drift. The CSS
// pin (.mkt-switch*) is UNCHANGED — the dot is styled inline, no new rule — so only MODE_SWITCH_SHA moves.
const MODE_SWITCH_SHA = '4cfde591feba53a1ac33c60d3c5a2db3def5ac775d6f66a0b27a93aca4852453'
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
