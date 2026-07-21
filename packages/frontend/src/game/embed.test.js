// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// GAP (#221 — sidebar character switch never re-anchors the world): GameWorldHost's mount effect resolves
// WHICH character to hand to mount_scene() by calling select_active_character(), which re-derives the
// answer from the PERSISTED last-played preference (core/draft.js's IndexedDB round-trip) + a roster-order
// fallback — a mechanism entirely SEPARATE from the session-gate's bound character id
// (world-shell/session_gate.js's `character_id`), which a live switch already sets correctly and
// synchronously through the tested reducer door (character_selection.test.js / character_switch.test.js
// both prove that seam). GameWorldHost had no way to tell select_active_character() "we already know who's
// active" — so its remount silently re-derived the SAME stale answer instead of trusting the switch's own
// outcome, leaving the mounted scene pinned on the previously-embodied character. select_active_character
// now accepts the already-bound character id and trusts it directly when present; the persisted-preference
// path stays exactly as-is for the BOOT case (no active binding yet).

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { context } from './core/game.js'
import { select_active_character } from './embed.js'

// color_1 present so hydrate_appearance() treats these as already chain-hydrated and skips its chain-direct
// read (no live RPC/gRPC in this test env) — mirrors read fixtures elsewhere in this suite.
const CHAR_A = { id: `0x${'a'.repeat(64)}`, name: 'A', classe: 'senshi', experience: 0, color_1: 0 }
const CHAR_B = { id: `0x${'b'.repeat(64)}`, name: 'B', classe: 'senshi', experience: 0, color_1: 0 }

const prior_characters = context.get_state().sui.characters
const prior_selected_character_id = context.get_state().selected_character_id

async function wait_for_roster(ids, attempts = 200) {
  for (let i = 0; i < attempts; i++) {
    const chars = context.get_state().sui.characters
    if (ids.every((id) => chars.some((c) => c.id === id))) return
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  throw new Error('roster did not settle')
}

beforeEach(async () => {
  context.dispatch('action/sui_data', { characters: [CHAR_A, CHAR_B], loaded: true })
  await wait_for_roster([CHAR_A.id, CHAR_B.id])
})

afterEach(async () => {
  context.dispatch('action/sui_data', { characters: prior_characters, loaded: true })
  context.dispatch('action/select_character', prior_selected_character_id)
})

describe('select_active_character — the world-mount character resolver (issue #221)', () => {
  test('with no bound character (fresh boot), falls back to the persisted/roster pick unchanged', async () => {
    const chosen = await select_active_character()
    expect(chosen?.id).toBe(CHAR_A.id) // roster[0] fallback — no persisted preference in this test env
  })

  test('a live switch to B must resolve B, not the stale persisted/roster fallback (red before the fix)', async () => {
    // The switch already selected + bound B through the session-gate reducer BEFORE GameWorldHost's mount
    // effect re-runs (character_selection.js's select_character_session order, proven by
    // character_selection.test.js). The world-mount resolver must trust that outcome directly.
    const chosen = await select_active_character(CHAR_B.id)
    expect(chosen?.id).toBe(CHAR_B.id)
  })

  test('switching back to A resolves A again — symmetric with the B switch', async () => {
    await select_active_character(CHAR_B.id)
    const chosen = await select_active_character(CHAR_A.id)
    expect(chosen?.id).toBe(CHAR_A.id)
  })

  test('a bound id absent from the roster falls back to the persisted/roster pick (defensive)', async () => {
    const chosen = await select_active_character(`0x${'9'.repeat(64)}`)
    expect(chosen?.id).toBe(CHAR_A.id)
  })
})
