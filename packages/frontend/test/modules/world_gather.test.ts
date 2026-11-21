// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'
import type { CharacterRow } from '@aresrpg/protocol'

import { selected_world_action_lock, type PendingGather } from '../../src/modules/world_gather.ts'
import { reduce_app_state, type AppState } from '../../src/store.ts'

import { automation_fixture, character } from './automation_fixture.ts'

const CHAIN_MS = 100_000
const ROOTED_MS = CHAIN_MS + 4_000

const watching = (state: AppState): AppState =>
  reduce_app_state(state, {
    type: 'agent/watch',
    observation: {
      pairing: { address: 'paired', multisig_public_key: 'public', signer_mode: 'disposable' },
      public_identifier: 'google',
      character_id: null,
    },
  })
const observed = (state: AppState, hero: Partial<CharacterRow>): AppState =>
  reduce_app_state(state, {
    type: 'server/packet',
    packet: {
      type: 'packet/agent_observed',
      id: state.session.agent_view.serial,
      characters: [{ ...character(), id: 'remote', name: 'Agent', ...hero }],
      selected_character_id: 'remote',
      failed: false,
    },
  })
const watched = (hero: Partial<CharacterRow>): AppState => observed(watching(automation_fixture()), hero)
const own = (hero: Partial<CharacterRow>, gathering?: PendingGather): AppState => {
  const state = automation_fixture()
  return {
    ...state,
    session: { ...state.session, characters: [{ ...character(), ...hero }] },
    world: { ...state.world, gathering: gathering ? { alice: gathering } : {} },
  }
}
const attempt: PendingGather = Object.freeze({
  attempt_id: 'first',
  character_id: 'alice',
  item_type: 'ivory_shrooms',
  protector: 'protector_ivory_gaia',
  started_at_ms: 1_000,
  duration_ms: 12_000,
  ends_at_ms: 13_000,
  confirmed: false,
  authoritative: false,
  ambushed: false,
  quantity: null,
})
const gather = (character_id: string) => ({ character_id, animation: 'gather' as const })
const held = (character_id: string) => ({ character_id, animation: null })

test('a watched hero rooted ahead of chain time shows the gather, and stops once chain time reaches the root', () => {
  const state = watched({ at_ms: ROOTED_MS })
  expect(selected_world_action_lock(state, CHAIN_MS)).toEqual(gather('remote'))
  expect(selected_world_action_lock(state, ROOTED_MS - 1)).toEqual(gather('remote'))
  expect(selected_world_action_lock(state, ROOTED_MS)).toBeNull()
  expect(selected_world_action_lock(state, ROOTED_MS + 1)).toBeNull()
})

test('a watched hero that only moved its checkpoint, or whose chain time is unknown, shows no gather', () => {
  expect(selected_world_action_lock(watched({ at_ms: CHAIN_MS - 1 }), CHAIN_MS)).toBeNull()
  expect(selected_world_action_lock(watched({ at_ms: undefined }), CHAIN_MS)).toBeNull()
  expect(selected_world_action_lock(watched({ at_ms: ROOTED_MS }), null)).toBeNull()
  expect(selected_world_action_lock(watched({ at_ms: ROOTED_MS }))).toBeNull()
})

test('a future checkpoint that another system owns is never a gather for a watched hero', () => {
  const ambush = { protector: 'protector_ivory_gaia' } as NonNullable<CharacterRow['ambush']>
  expect(selected_world_action_lock(watched({ at_ms: ROOTED_MS, ambush }), CHAIN_MS)).toEqual(held('remote'))
  expect(
    selected_world_action_lock(watched({ at_ms: ROOTED_MS, dungeon_run: { dungeon: 'crypt', room: 1 } }), CHAIN_MS)
  ).toEqual(held('remote'))
  expect(
    selected_world_action_lock(watched({ at_ms: ROOTED_MS, active_fight: { id: '0xf', seat: 0 } }), CHAIN_MS)
  ).toBeNull()
})

test("the player's own lock still comes from the local attempt, never from the chain root", () => {
  expect(selected_world_action_lock(own({ at_ms: ROOTED_MS }), CHAIN_MS)).toBeNull()
  expect(selected_world_action_lock(own({}, attempt), CHAIN_MS)).toEqual(gather('alice'))
  expect(selected_world_action_lock(own({}, { ...attempt, ambushed: true }), CHAIN_MS)).toEqual(held('alice'))
  expect(selected_world_action_lock(own({ dungeon_run: { dungeon: 'crypt', room: 1 } }), CHAIN_MS)).toEqual(
    held('alice')
  )
  expect(
    selected_world_action_lock(own({ ambush: { protector: 'p' } as NonNullable<CharacterRow['ambush']> }), CHAIN_MS)
  ).toEqual(held('alice'))
  expect(selected_world_action_lock(own({}), CHAIN_MS)).toBeNull()
})

test('the same observed row delivered twice yields the same lock', () => {
  const first = watched({ at_ms: ROOTED_MS })
  const replayed = observed(first, { at_ms: ROOTED_MS })
  expect(replayed.session.agent_view.characters).not.toBe(first.session.agent_view.characters)
  expect(selected_world_action_lock(first, CHAIN_MS)).toEqual(gather('remote'))
  expect(selected_world_action_lock(replayed, CHAIN_MS)).toEqual(gather('remote'))
})
