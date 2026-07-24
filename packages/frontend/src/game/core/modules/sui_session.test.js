// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #708 — aa123037 stopped embed.js's OWN redundant reselect (select_active_character) from ever reaching
// action/select_character a second time for the same id, but the observer that dispatch feeds stayed
// vulnerable to EVERY OTHER caller (PartyFrame.jsx's onClick, CharacterSwitcher, boot_roster, a raw
// context.dispatch, ...): it re-derived + republished the world binding from the roster's CACHED world_id
// on every dispatch, so a redundant reselect of the SAME character through any of those doors could still
// clobber a fresher chain-truth binding a manual write (join success) already published. This suite drives
// the observer DIRECTLY via context.dispatch — bypassing embed.js's own guard entirely — to prove the class
// is dead at its root (sui_session.js's own last-published-id closure), not just patched at one call site.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { context } from '../game.js'
import { publish_world_binding, reset_world_binding, use_world_binding } from '../../../world-shell/session_gate.js'

// Ids distinct from every other fixture in this suite (embed.test.js / character_selection.test.js /
// follow_gate.test.js) so a stray leftover value from an earlier file can never coincidentally collide with
// this observer's own closure-tracked last-published id and mask (or fake) this test's outcome.
const CHAR_ID = '0xd708-select-delta-observer'
const STALE_WORLD = '0xd708-world-stale' // the roster's cached (pre-travel) world_id
const FRESH_WORLD = '0xd708-world-fresh' // the just-settled join tx's chain-truth world

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

/** Dispatch + wait for the engine to actually PROCESS the action (dispatch only enqueues) before asserting —
 *  the event always fires regardless of the fix (only the internal world-binding publish is conditional). */
async function select_and_settle(character_id) {
  const processed = new Promise((resolve) => context.events.once('action/select_character', resolve))
  context.dispatch('action/select_character', character_id)
  await processed
}

afterEach(async () => {
  reset_world_binding()
  context.dispatch('action/sui_data', { characters: prior_characters, loaded: true })
  context.dispatch('action/select_character', prior_selected_character_id)
})

describe('sui_session observer — action/select_character publishes the world binding on a genuine DELTA only (#708)', () => {
  test('a redundant reselect of the SAME character must not clobber a fresher chain-truth binding', async () => {
    context.dispatch('action/sui_data', { characters: [{ id: CHAR_ID, world_id: STALE_WORLD }], loaded: true })
    await wait_for_roster([CHAR_ID])

    // Genuine first selection: no prior binding for this character exists yet, so deriving + publishing the
    // roster's (currently accurate) cached world_id IS a real delta — it must go through unchanged.
    await select_and_settle(CHAR_ID)
    expect(use_world_binding.getState().world).toBe(STALE_WORLD)

    // The travel's own join tx settles and publishes fresh chain truth directly — join_world_action's
    // publish_world_binding (world_join.js), fired the instant run_tx resolves, BEFORE the roster has
    // re-indexed the new world (exactly aa123037's scenario, one layer under embed.js).
    publish_world_binding(CHAR_ID, FRESH_WORLD, 'manual')
    expect(use_world_binding.getState().world).toBe(FRESH_WORLD)

    // A caller OTHER than embed.js's own now-guarded call site redispatches the SAME character id — a raw
    // context.dispatch, exactly what PartyFrame.jsx's onClick does with no reselect guard of its own. The
    // roster is still the stale snapshot dispatched above. The observer must recognize the SELECTION carries
    // no new fact (same id as last published) and skip re-deriving + republishing it.
    await select_and_settle(CHAR_ID)

    // The fresh join publish must survive the redundant reselect — never silently fall back to the stale
    // pre-travel world (owner field report: "had to refresh the page" to see the real one).
    expect(use_world_binding.getState().world).toBe(FRESH_WORLD)
  })

  test('a genuine switch to a DIFFERENT character still publishes its own world (the guard is per-id, not a latch)', async () => {
    // Fresh ids, never touched by the test above: the observer's closure lives for the whole file (the
    // engine singleton boots once per process), so reusing CHAR_ID here would find it already
    // last-published and silently prove nothing.
    const FIRST_ID = '0xd708-select-delta-solo-a'
    const FIRST_WORLD = '0xd708-world-solo-a'
    const SECOND_ID = '0xd708-select-delta-solo-b'
    const SECOND_WORLD = '0xd708-world-solo-b'
    context.dispatch('action/sui_data', {
      characters: [
        { id: FIRST_ID, world_id: FIRST_WORLD },
        { id: SECOND_ID, world_id: SECOND_WORLD },
      ],
      loaded: true,
    })
    await wait_for_roster([FIRST_ID, SECOND_ID])

    await select_and_settle(FIRST_ID)
    expect(use_world_binding.getState().world).toBe(FIRST_WORLD)

    // A DIFFERENT id is a genuine delta even though FIRST_ID was already published above — must publish
    // SECOND's own world, not get suppressed by the same guard that protects against a same-id redundant
    // reselect (the guard tracks the LAST published id, not "has this observer ever published anything").
    await select_and_settle(SECOND_ID)
    expect(use_world_binding.getState().world).toBe(SECOND_WORLD)
  })
})
