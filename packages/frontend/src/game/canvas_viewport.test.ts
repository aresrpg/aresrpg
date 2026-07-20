import { readFileSync } from 'node:fs'

import { describe, expect, test } from 'bun:test'

const read_fixture = (relative_path: string) => readFileSync(new URL(relative_path, import.meta.url), 'utf8')

describe('iOS game canvas viewport chain', () => {
  test('document, host, mount, and canvas fill the dynamic viewport with a standalone fallback', () => {
    const global_css = read_fixture('../index.css')
    const viewport_css = read_fixture('./canvas-viewport.css')
    const host = read_fixture('../GameWorldHost.tsx')
    const embed = read_fixture('./embed_voxel.js')

    const html_rule = viewport_css.match(/html\s*\{([^}]*)\}/)?.[1] ?? ''
    const root_chain = viewport_css.match(/body,\s*#root\s*\{([^}]*)\}/)?.[1] ?? ''
    expect(html_rule).toMatch(/height:\s*100%/)
    expect(html_rule).toMatch(/height:\s*-webkit-fill-available/)
    expect(html_rule).toMatch(/height:\s*100dvh/)
    expect(root_chain).toMatch(/height:\s*100%/)
    expect(root_chain).toMatch(/min-height:\s*100%/)
    expect(`${global_css}\n${viewport_css}`).not.toMatch(/(?:min-)?height:\s*100vh\s*;/)
    // SELECTOR-ROT REGRESSION (2ea13bb7 deleted data-game-world-viewport with ZERO replacement hook —
    // prod-smoke + gold specs all keyed on it). The host now carries a stable, semantic testid instead
    // of the old CSS-var-driven attribute; this line is the guard against losing the hook again.
    // EXPECTED RED until the GameWorldHost.tsx one-line testid lands (phase-gated behind the anchor suite).
    expect(host).toContain('data-testid="game-world-viewport"')
    // The mobile frame now sizes the host literally off the dynamic-viewport unit — no CSS-var indirection.
    // The old measure-and-bleed apparatus (--game-viewport-*, bind_mobile_viewport) is deleted for good.
    expect(host).toContain("height: '100dvh'")
    expect(host).not.toMatch(/100vh(?![a-z])/)
    expect(embed).toContain("container.style.cssText = 'position:absolute;inset:0'")
    expect(embed).toContain("canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block'")
  })

  test('bottom chrome stays clear of the home indicator; the dead viewport-attribute hook never returns to mobile-hud.css', () => {
    const lazy_hud_css = read_fixture('./screens/hud/mobile-hud.css')
    const touch_css = read_fixture('./touch/touch-controls.css')

    // The measure-and-bleed clawback rule (keyed off [data-game-world-viewport='visual']) is deleted for
    // good (2ea13bb7) — mobile-hud.css must never grow a rule keyed off it again.
    expect(lazy_hud_css).not.toContain("[data-game-world-viewport='visual']")
    expect(touch_css).toMatch(/padding-bottom:\s*var\(--safe-bottom\)/)
  })
})
