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
    expect(mobile_layer_rule).toMatch(/top:\s*8px/)
    expect(mobile_layer_rule).toMatch(/right:\s*8px/)
  })

  test('all toast variants retain translucent near-black glass, white/10 border, blur, and sharp corners', () => {
    const css = read_fixture('./world_toast_overlay.css')
    const mobile_css = read_fixture('../mobile-hud.css')
    const toast_rule = css.match(/(?:^|\n)\.gw-toast\s*\{([^}]*)\}/)?.[1] ?? ''
    const progress_rule = css.match(/(?:^|\n)\.gw-toast--progress\s*\{([^}]*)\}/)?.[1] ?? ''
    const mobile_toast_rule = mobile_css.match(/\.gw-hud--mobile \.gw-toast\s*\{([^}]*)\}/)?.[1] ?? ''

    expect(toast_rule).toMatch(/background:\s*rgba\(10,\s*10,\s*15,\s*0\.72\)/)
    expect(toast_rule).toMatch(/border:\s*1px solid rgba\(255,\s*255,\s*255,\s*0\.1\)/)
    expect(toast_rule).toMatch(/backdrop-filter:\s*blur\(10px\)/)
    expect(toast_rule).toMatch(/border-radius:\s*0/)
    expect(toast_rule).toMatch(/padding:\s*9px 13px/)
    expect(progress_rule).toMatch(/background:\s*rgba\(10,\s*10,\s*15,\s*0\.72\)/)
    expect(progress_rule).toMatch(/backdrop-filter:\s*blur\(10px\)/)
    expect(mobile_toast_rule).toMatch(/border-radius:\s*0/)
  })
})
