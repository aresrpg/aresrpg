// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// editor_token_bridge.test.js — the simulator's character editor borrows the GAME's components (the paper
// doll, the stat rows, the spell rows) and those are styled in hud-panels.css against the GAME tokens, which
// exist on `.gw-tab` and NOWHERE else. The editor is a body-portalled dialog, outside every `.gw-tab` on the
// page, so `var(--s-2)` resolved to nothing: `padding: var(--s-2) var(--s-3)` is invalid at computed-value
// time and falls back to zero, which is exactly the reported #883 ⑥ — stat rows cramped against the icon
// column and a paper doll whose gaps had collapsed into one solid grid.
//
// This pins the fix mechanically because the failure is INVISIBLE to a render test: the markup is identical
// either way, only the cascade differs. Three facts, each of which alone breaks it again:
//   1. the shared rules genuinely depend on the tokens (so the bridge is load-bearing, not decoration);
//   2. the carrier rule lives with `.gw-tab` itself — it used to sit in the world HUD's own stylesheet, which
//      no other page loads, so the class was reachable and the rule behind it was not;
//   3. the dialog wears the carrier, and the carrier stays a bare wrapper (it is `display:contents`, so any
//      layout class on that same element would be silently dropped).

import { readFileSync } from 'node:fs'

import { describe, expect, test } from 'bun:test'

const read_source = (relative_path) => readFileSync(new URL(relative_path, import.meta.url), 'utf8')

const HUD_PANELS = read_source('../game/screens/hud/hud-panels.css')
const GAME_TAB = read_source('../game-tab.css')
const MODAL = read_source('./CharacterModal.tsx')

const rule_of = (css, selector) => css.match(new RegExp(`(?:^|\\n)${selector}\\s*\\{([^}]*)\\}`))?.[1] ?? ''

describe('the shared editor components are token-dependent', () => {
  test('a stat row spends the token scale on its padding and its gap — no tokens, no spacing', () => {
    const row = rule_of(HUD_PANELS, '\\.stats__prow')
    expect(row).toMatch(/padding:\s*var\(--s-\d/)
    expect(row).toMatch(/gap:\s*var\(--s-\d/)
  })

  test("the paper doll's own grids spend it too — that is why a token-less doll reads as one brick", () => {
    expect(rule_of(HUD_PANELS, '\\.inv__rig')).toMatch(/gap:\s*var\(--s-\d/)
    expect(rule_of(HUD_PANELS, '\\.inv__doll-body')).toMatch(/gap:\s*var\(--s-\d/)
  })
})

describe('the bridge lives with the tokens it carries', () => {
  test('.gw-tab defines the spacing scale those rules read', () => {
    const bridge = rule_of(GAME_TAB, '\\.gw-tab')
    expect(bridge).toMatch(/--s-2:\s*8px/)
    expect(bridge).toMatch(/--s-3:\s*12px/)
  })

  test('the display:contents CARRIER is defined in the SAME stylesheet — reachable from any page', () => {
    expect(rule_of(GAME_TAB, '\\.gw-tab\\.gw-tab--carrier')).toMatch(/display:\s*contents/)
  })
})

describe('the simulator editor wears it', () => {
  test('the dialog wraps its content in the carrier', () => {
    expect(MODAL).toContain('gw-tab gw-tab--carrier')
  })

  test('the carrier element carries NO layout classes — display:contents would drop them', () => {
    const carrier = MODAL.match(/className="([^"]*gw-tab--carrier[^"]*)"/)?.[1] ?? ''
    expect(carrier.trim()).toBe('gw-tab gw-tab--carrier')
  })
})
