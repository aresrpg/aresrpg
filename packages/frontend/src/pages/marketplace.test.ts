// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

import { describe, expect, test } from 'bun:test'

const PAGE_PATH = new URL('./marketplace.tsx', import.meta.url)
const CSS_PATH = new URL('../index.css', import.meta.url)
const MODE_SWITCH_SHA = 'e93c7e44649df600857476390310c920d722297ba5f7d6e1ec8349d471425d4c'
const MODE_CSS_SHA = '33ea969eb39a63c45af2dc02e42dd0fcd4df9667a9b8b448628372ab49a2524c'

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
