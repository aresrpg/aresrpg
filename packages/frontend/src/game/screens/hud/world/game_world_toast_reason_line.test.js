// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// PRE-FLIGHT "MUST SAY WHY" — a decoded refusal reason now rides as a second \n-separated
// line (abort_copy.js humanize_tx_error's `errors.tx_refusal_reason` template) into EVERY toast surface that
// shows a humanized tx error, including the in-game event-toast stack (GameWorldHud.jsx's local Toasts(),
// fed by world_spawns.js's `push_event_toast({ title: use_party.getState().error })` on a failed group-fight
// engage). Its `<span>{t.title}</span>` had no `white-space` rule, so a browser's default `normal` mode
// collapses an embedded newline to a single space — the reason text survives, but the intended visual line
// break silently vanishes. `white-space` is inherited, so a single declaration on the `.gw-toast` row (rather
// than a new class on the unclassed inner span) fixes every consumer at once.
import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'bun:test'

const read_fixture = (relative_path) => readFileSync(new URL(relative_path, import.meta.url), 'utf8')

describe('game-world-hud.css · .gw-toast renders an embedded \\n reason line as an actual break', () => {
  test('.gw-toast sets white-space: pre-wrap (inherited onto the title/message span below it)', () => {
    const css = read_fixture('./game-world-hud.css')
    const toast_rule = css.match(/(?:^|\n)\.gw-toast\s*\{([^}]*)\}/)?.[1] ?? ''
    expect(toast_rule).toMatch(/white-space:\s*pre-wrap/)
  })
})

describe('world toast minimap overlay', () => {
  test('insets the absolute layer over the minimap area without changing the minimap flush rule', () => {
    const hud_source = read_fixture('./GameWorldHud.jsx')
    const base_css = read_fixture('./game-world-hud.css')
    const overlay_css = read_fixture('./world_toast_overlay.css')
    const mobile_css = read_fixture('../mobile-hud.css')
    const base_layer_rule = base_css.match(/(?:^|\n)\.gw-toasts\s*\{([^}]*)\}/)?.[1] ?? ''
    const overlay_layer_rule = overlay_css.match(/(?:^|\n)\.gw-toasts\s*\{([^}]*)\}/)?.[1] ?? ''
    const mobile_layer_rule = mobile_css.match(/\.gw-hud--mobile \.gw-toasts\s*\{([^}]*)\}/)?.[1] ?? ''

    expect(hud_source).toContain("import './world_toast_overlay.css'")
    expect(base_layer_rule).toMatch(/position:\s*absolute/)
    expect(base_layer_rule).toMatch(/z-index:\s*7/)
    expect(overlay_layer_rule).toMatch(/top:\s*8px/)
    expect(overlay_layer_rule).toMatch(/right:\s*8px/)
    expect(overlay_layer_rule).toMatch(/overflow:\s*(?:clip|hidden)/)
    // #242 owner report (v1.12.43 "still jumping when a toast appears"): a stack with no height cap could
    // grow past its bounds as toasts pile up. max-height (world_toast_overlay.css) is the ONE thing standing
    // between an absolutely-positioned-but-unbounded box and a real page-scrollbar reflow — assert it stays.
    expect(overlay_layer_rule).toMatch(/max-height:\s*calc\(100% - 16px\)/)
    expect(mobile_layer_rule).toMatch(/top:\s*8px/)
    expect(mobile_layer_rule).toMatch(/right:\s*8px/)
  })

  // #242 owner report (v1.12.43): "a toast appearing still reflows the page layout" while roaming. A live
  // Playwright reconstruction of the real GameWorldHost → GameWorldHud → .gw-hud → .gw-toasts ancestor chain
  // (exact inline styles copied from GameWorldHost.tsx) found ZERO measurable reflow from mounting 1 or 16
  // toasts — canvas/HUD/sibling-layout rects and document.scrollHeight were byte-identical before/after, in
  // both the desktop card frame and the mobile frame. That result rests entirely on TWO invariants staying
  // true; this locks them in so a future edit can't silently reintroduce the reported jump:
  //   1. the toast stack renders NOTHING (not even an empty flex box) while there are no toasts — an
  //      always-mounted container would still be out-of-flow here, but "never mount when empty" is the
  //      cheapest possible guarantee and costs nothing to keep.
  //   2. EVERY GameWorldHost frame variant (mobile / desktop card / spectate full-bleed) that hosts the toast
  //      stack's positioned ancestor stays position:fixed — the moment one of these becomes `relative` (or
  //      loses an edge), `.gw-hud`'s inset:0 box stops being content-independent and the whole HUD (toasts
  //      included) re-enters the page's flow/scroll calculation.
  test('the toast layer never re-enters the page flow: null when empty, fixed-framed ancestor always', () => {
    const hud_source = read_fixture('./GameWorldHud.jsx')
    const host_source = read_fixture('../../../../GameWorldHost.tsx')

    expect(hud_source).toContain('if (toasts.length === 0) return null')

    // mobile_frame + the card/spectate ternary's two branches — three frame literals, three position:fixed.
    const frame_block = host_source.slice(
      host_source.indexOf('const mobile_frame'),
      host_source.indexOf('return (', host_source.indexOf('const mobile_frame'))
    )
    expect(frame_block.match(/position:\s*'fixed'/g)?.length ?? 0).toBe(3)
    // The HUD wrapper (line hosting <GameWorldHud/>) spreads that SAME frame — never a bespoke position.
    expect(host_source).toContain('<GameWorldHud />')
    expect(host_source).toMatch(/style=\{\{\s*\.\.\.frame,\s*zIndex:\s*12,\s*pointerEvents:\s*'none'\s*\}\}/)
  })

  test('all toast variants use comfortable translucent glass panels with slight rounding', () => {
    const css = read_fixture('./world_toast_overlay.css')
    const mobile_css = read_fixture('../mobile-hud.css')
    const toast_rule = css.match(/(?:^|\n)\.gw-toast\s*\{([^}]*)\}/)?.[1] ?? ''
    const progress_rule = css.match(/(?:^|\n)\.gw-toast--progress\s*\{([^}]*)\}/)?.[1] ?? ''
    const mobile_toast_rule = mobile_css.match(/\.gw-hud--mobile \.gw-toast\s*\{([^}]*)\}/)?.[1] ?? ''

    expect(toast_rule).toMatch(/background:\s*rgba\(10,\s*10,\s*15,\s*0\.72\)/)
    expect(toast_rule).toMatch(/border:\s*1px solid rgba\(255,\s*255,\s*255,\s*0\.1\)/)
    expect(toast_rule).toMatch(/backdrop-filter:\s*blur\(10px\)/)
    expect(toast_rule).toMatch(/border-radius:\s*7px/)
    expect(toast_rule).not.toMatch(/border-radius:\s*0/)
    expect(toast_rule).toMatch(/padding:\s*12px 16px/)
    expect(toast_rule).not.toMatch(/padding:\s*9px 13px/)
    expect(progress_rule).toMatch(/background:\s*rgba\(10,\s*10,\s*15,\s*0\.72\)/)
    expect(progress_rule).toMatch(/backdrop-filter:\s*blur\(10px\)/)
    expect(mobile_toast_rule).toMatch(/border-radius:\s*7px/)
    expect(mobile_toast_rule).not.toMatch(/border-radius:\s*0/)
  })
})
