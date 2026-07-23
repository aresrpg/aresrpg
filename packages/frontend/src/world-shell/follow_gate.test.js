// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #509 field defect — when an auto-following character completes its world-join, the player's active window
// used to SWITCH to that follower (a programmatic focus-steal). An auto-follower is APP-MANAGED: it can never
// become the driven character, by sidebar click (already folded to a non-button, 673bcf56) OR programmatically.
// The invariant is enforced at the ONE selection write door — `action/select_character` in sui_session.js,
// both its reduce (selected_character_id) and its observe (the session-gate re-key) — which consults the
// follow gate group_wiring publishes. These drive the REAL game store (the singleton in game/core/game.js),
// mirroring character_selection.test.js's real-store pattern; the follow gate stands in for group_wiring's
// live publish (source-text-proven below), so the guard is exercised without booting the Vite-only group loop.

import { readFileSync } from 'node:fs'

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { context } from '../game/core/game.js'

import { set_app_managed_followers, is_app_managed_follower } from './follow_gate.js'
import { reset_world_binding, use_world_binding } from './session_gate.js'

const LEADER = '0xleader'
const FOLLOWER = '0xfollower'
const WORLD = '0xfirst-shore'

const settle = () => new Promise((resolve) => setTimeout(resolve, 25))

async function wait_for_selected(expected, attempts = 100) {
  for (let i = 0; i < attempts; i++) {
    if (context.get_state().selected_character_id === expected) return
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  throw new Error(`selection store did not settle on ${expected ?? 'null'}`)
}

async function select_in_real_store(character_id) {
  context.dispatch('action/select_character', character_id)
  await wait_for_selected(character_id)
}

let prior_selected = null

beforeEach(() => {
  prior_selected = context.get_state().selected_character_id
  set_app_managed_followers([])
  reset_world_binding()
})

afterEach(async () => {
  set_app_managed_followers([])
  await select_in_real_store(prior_selected)
  reset_world_binding()
})

describe('the selection door refuses an app-managed follower (#509)', () => {
  test('a programmatic select of a following character is refused — selection STAYS on the leader', async () => {
    await select_in_real_store(LEADER)

    // FOLLOWER enters the app-managed follow set (exactly what group_wiring publishes on follow-enable).
    set_app_managed_followers([FOLLOWER])
    expect(is_app_managed_follower(FOLLOWER)).toBe(true)

    // The world-join flow's programmatic auto-select fires for the follower — the door MUST refuse it.
    context.dispatch('action/select_character', FOLLOWER)
    await settle()
    expect(context.get_state().selected_character_id).toBe(LEADER)
  })

  test('the session scene never re-keys to a follower (the observe half of the door)', async () => {
    // Seed a roster so the observe path (which re-keys the session gate off character.world_id) is live.
    context.dispatch('action/sui_data', {
      kind: 'snapshot',
      characters: [
        { id: LEADER, world_id: WORLD },
        { id: FOLLOWER, world_id: WORLD },
      ],
    })
    await select_in_real_store(LEADER)
    expect(use_world_binding.getState().character_id).toBe(LEADER)

    set_app_managed_followers([FOLLOWER])
    context.dispatch('action/select_character', FOLLOWER)
    await settle()
    // Without the observe guard, character_selected(FOLLOWER) would re-key the world scene to the follower.
    expect(use_world_binding.getState().character_id).toBe(LEADER)

    context.dispatch('action/sui_data', { kind: 'snapshot', characters: [] })
    await settle()
  })

  test('the × unfollow path restores selectability', async () => {
    await select_in_real_store(LEADER)
    set_app_managed_followers([FOLLOWER])

    // The × on the folded row unfollows FIRST (clears the gate) — the restored ordinary row then selects.
    set_app_managed_followers([])
    expect(is_app_managed_follower(FOLLOWER)).toBe(false)
    await select_in_real_store(FOLLOWER)
    expect(context.get_state().selected_character_id).toBe(FOLLOWER)
  })
})

describe('group_wiring publishes the follow set to the gate (wiring)', () => {
  // Source-text proof (house pattern — PlayerActionMenu.wiring.test.js): group_wiring.js's own module graph
  // (fight/party/world_join → SDK/auth/Vite) has no business booting in a unit test just to prove one call
  // site. This asserts the ONE wire: notify_follow feeds the follower set into the selection door's gate.
  const source = readFileSync(new URL('./group_wiring.js', import.meta.url), 'utf8')

  test('notify_follow feeds follower_character_ids into set_app_managed_followers', () => {
    expect(source).toContain("import { set_app_managed_followers } from './follow_gate.js'")
    expect(source).toContain('set_app_managed_followers(get_group_follow_snapshot().follower_character_ids)')
  })
})
