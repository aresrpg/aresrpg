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
import { use_world_binding, publish_world_binding, reset_world_binding } from '../world-shell/session_gate.js'

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

// OLD_WORLD / NEW_WORLD — world ids distinct from anything above so a stray earlier binding can never
// coincidentally match and mask the clobber this suite proves.
const OLD_WORLD = `0x${'d'.repeat(64)}`
const NEW_WORLD = `0x${'e'.repeat(64)}`
// The roster row's world_id mirrors the pre-travel world — exactly what boot_roster/load_roster last indexed,
// NOT what the just-settled join tx proved (that fact lives ONLY in session_gate.js until the next roster read).
const CHAR_TRAVELER = {
  id: `0x${'f'.repeat(64)}`,
  name: 'Traveler',
  classe: 'senshi',
  experience: 0,
  color_1: 0,
  world_id: OLD_WORLD,
}

const settle_engine = () => new Promise((resolve) => setTimeout(resolve, 0))
/** Resolves once `type` is processed by the engine's reduce loop (context.dispatch only enqueues), or after
 *  one engine tick if `type` never fires — the fix under test makes a redundant reselect dispatch NOTHING,
 *  so this must resolve either way instead of hanging on an event that correctly never arrives post-fix. */
const wait_action = (type) => Promise.race([new Promise((resolve) => context.events.once(type, resolve)), settle_engine()])

describe('select_active_character — travel remount must not clobber a fresher world binding (owner field report 2026-07-24)', () => {
  beforeEach(async () => {
    context.dispatch('action/sui_data', { characters: [CHAR_TRAVELER], loaded: true })
    await wait_for_roster([CHAR_TRAVELER.id])
  })

  afterEach(() => reset_world_binding())

  test('a same-character remount after the join publish must not fall back to the stale roster world_id (red before the fix)', async () => {
    // Pre-travel: the character is already selected and bound to OLD_WORLD (mirrors a resident session
    // before the player travels — the exact state GameWorldHost's FIRST mount of this character leaves).
    const selected_once = wait_action('action/select_character')
    await select_active_character(CHAR_TRAVELER.id)
    await selected_once
    expect(use_world_binding.getState().world).toBe(OLD_WORLD)

    // The travel's OWN join tx settles and publishes chain truth — join_world_action's publish_world_binding
    // (world_join.js:117), fired the instant run_tx resolves, BEFORE the roster has re-indexed the new world.
    publish_world_binding(CHAR_TRAVELER.id, NEW_WORLD, 'manual')
    expect(use_world_binding.getState().world).toBe(NEW_WORLD)

    // GameWorldHost's mount effect re-runs (bound_world changed → scene_key changed) and re-resolves the
    // SAME already-active character through select_active_character(bound_char_id) — exactly GameWorldHost's
    // own resolve_character() call. The roster is still the stale one dispatched above.
    const reselected = wait_action('action/select_character')
    await select_active_character(CHAR_TRAVELER.id)
    await reselected

    // The fresh join publish must survive the redundant reselect — the client must stay switched to the new
    // world, never silently fall back to the pre-travel one (owner: "had to refresh the page" to see it).
    expect(use_world_binding.getState().world).toBe(NEW_WORLD)
  })
})
