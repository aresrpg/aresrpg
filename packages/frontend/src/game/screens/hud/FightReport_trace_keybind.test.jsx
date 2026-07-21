// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// issue #256 — the bare "R" export-replay keybind used to die with FightControls.jsx, which unmounts the
// instant a fight ends (`if (!fight) return null`), so it went dead for exactly the post-fight beat the result
// card owns. FightReport.jsx now mounts use_fight_trace_keybind() itself too, so the chord stays armed while
// the card is up. This file proves the WIRING FACT (FightReport calls the hook) via mock.module — own file, own
// mock, per the codebase's "never double-mock a shared module" law (no other test file touches
// use_fight_trace_keybind.js, so this is collision-free); FightReport.test.jsx keeps importing the REAL hook
// for its own (unrelated) coverage.
import { describe, expect, mock, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

let keybind_mount_count = 0
mock.module('./use_fight_trace_keybind.js', () => ({
  use_fight_trace_keybind: () => {
    keybind_mount_count += 1
  },
}))

const { FightReport } = await import('./FightReport.jsx')

const t = (key) => key

const base = {
  verdict: 'Victory',
  party: [{ id: 'me', name: 'Hero', level: 12, is_me: true, alive: true, hp_pct: 100 }],
  enemies: [],
  spoils: { xp: 50, tokens: 0, loot: [] },
  items: [],
  cost: null,
  t,
  on_close: () => {},
}

describe('FightReport — arms the post-fight export keybind (issue #256)', () => {
  test('RED-FIRST: rendering the result card calls use_fight_trace_keybind (pre-fix: only FightControls.jsx called it, and that component is already unmounted by the time this card is up)', () => {
    keybind_mount_count = 0
    renderToStaticMarkup(<FightReport {...base} />)
    expect(keybind_mount_count).toBe(1)
  })

  test('a defeat card arms it identically — shared shell chrome, not a victory-only affordance', () => {
    keybind_mount_count = 0
    renderToStaticMarkup(<FightReport {...base} verdict="Defeat" spoils={null} />)
    expect(keybind_mount_count).toBe(1)
  })
})
