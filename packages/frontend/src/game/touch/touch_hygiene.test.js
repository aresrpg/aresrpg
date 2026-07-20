// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'

const read = (relative) => readFileSync(new URL(relative, import.meta.url), 'utf8')

describe('mobile game touch hygiene', () => {
  it('keeps a zoom-neutral safe-area viewport without disabling accessibility zoom globally', () => {
    const html = read('../../../index.html')
    const viewport = html.match(/<meta\s+name="viewport"\s+content="([^"]+)"/s)?.[1] ?? ''

    expect(viewport).toContain('width=device-width')
    expect(viewport).toContain('initial-scale=1.0')
    expect(viewport).toContain('viewport-fit=cover')
    expect(viewport).not.toContain('user-scalable=no')
    expect(viewport).not.toContain('maximum-scale=1')
  })

  it('owns canvas gestures, suppresses root overscroll/selection, and leaves HUD panning usable', () => {
    const css = read('./touch-hygiene.css')

    expect(css).toContain('.mobile-game-input-active body')
    expect(css).toContain('overscroll-behavior: none')
    expect(css).toContain('touch-action: none')
    expect(css).toContain('touch-action: pan-x pan-y')
    expect(css).toContain('touch-action: manipulation')
    expect(css).toContain('-webkit-user-select: none')
  })

  it('keeps broad controls below the HUD so panels and buttons win hit testing', () => {
    const controls = read('./touch-controls.css')
    const host = read('../../GameWorldHost.tsx')

    expect(controls).toMatch(/\.touch-controls\s*\{[\s\S]*?z-index:\s*11/)
    expect(host).toContain("style={{ ...frame, zIndex: 12, pointerEvents: 'none' }}")
  })
})
