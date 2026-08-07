// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #708 — aa123037 stopped embed.js's OWN redundant reselect (select_active_character) from ever reaching
// action/select_character a second time for the same id, but the observer that dispatch feeds stayed
// vulnerable to EVERY OTHER caller (PartyFrame.jsx's onClick, CharacterSwitcher, boot_roster, a raw
// context.dispatch, ...): it re-derived + republished the world binding from the roster's CACHED world_id
// on every dispatch, so a redundant reselect of the SAME character through any of those doors could still
// clobber a fresher chain-truth binding a manual write (join success) already published. This suite drives
// the observer DIRECTLY via context.dispatch — bypassing embed.js's own guard entirely — to prove the class
// is dead at its root. #2007 moved that root from the observer's own last-published-id closure into the
// binding book itself: the card's world is roster-grade evidence and can never lower an unconfirmed
// chain-truth row, so the class stays dead with one home instead of a per-observer memory.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { context } from '../game.js'
import { INITIAL_SUI_STATE } from '../initial_sui_state.js'
import { publish_world_binding, reset_world_binding, use_world_binding } from '../../../world-shell/session_gate.js'
import sui_session from './sui_session.js'

// Ids distinct from every other fixture in this suite (embed.test.js / character_selection.test.js /
// follow_gate.test.js) so a stray leftover row in the shared binding book can never coincidentally satisfy
// (or fake) this test's outcome.
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

describe('sui_session observer — the roster card can never lower a fresher chain-truth binding (#708)', () => {
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
    // roster is still the stale snapshot dispatched above, so the card enters the book as roster-grade
    // evidence and is floored behind the unconfirmed chain-truth row.
    await select_and_settle(CHAR_ID)

    // The fresh join publish must survive the redundant reselect — never silently fall back to the stale
    // pre-travel world (owner field report: "had to refresh the page" to see the real one).
    expect(use_world_binding.getState().world).toBe(FRESH_WORLD)
  })

  test('a genuine switch to a DIFFERENT character still publishes its own world (the guard is per-id, not a latch)', async () => {
    // Fresh ids, never touched by the test above: the binding book lives for the whole file (the engine
    // singleton boots once per process), so reusing CHAR_ID here would find its row already settled and
    // silently prove nothing.
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

    // A DIFFERENT id is a genuine delta even though FIRST_ID was already published above — the selection
    // must re-key to SECOND and read SECOND's own world out of the book, never stay on the first.
    await select_and_settle(SECOND_ID)
    expect(use_world_binding.getState().world).toBe(SECOND_WORLD)
  })
})

describe('sui_session wallet teardown', () => {
  test('resets the complete Sui slice from its one boot shape', () => {
    const state = {
      selected_character_id: '0xaccount-a-character',
      sui: {
        ...INITIAL_SUI_STATE,
        loaded: true,
        has_claimed_free_character: true,
        character_price_sui: 10,
        characters: [{ id: '0xaccount-a-character' }],
        items_for_sale: [{ id: '0xaccount-a-listing' }],
        balance: 42n,
        tokens: [{ id: '0xaccount-a-token' }],
        admin_caps: [{ id: '0xaccount-a-cap' }],
        finished_crafts: [{ id: '0xaccount-a-craft' }],
        recipes: [{ id: '0xaccount-a-recipe' }],
        xp_floor: { '0xaccount-a-character': 99 },
        deleted_ids: { '0xaccount-a-deleted': true },
      },
    }

    const reset = sui_session().reduce(state, { type: 'action/sui_logout' })

    expect(reset.selected_character_id).toBeNull()
    expect(reset.sui).toEqual(INITIAL_SUI_STATE)
    expect(Object.keys(reset.sui).sort()).toEqual(Object.keys(INITIAL_SUI_STATE).sort())
    expect(reset.sui).not.toBe(INITIAL_SUI_STATE)
  })
})
