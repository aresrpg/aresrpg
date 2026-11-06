// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import { character_checkpoint } from '@aresrpg/protocol'

import {
  selected_position,
  resolve_selected_position,
  world_presence_rows,
  selected_dungeon_position,
} from '../../src/modules/engine_selection.ts'
import {
  record_owned_character_position,
  clear_owned_character_positions,
} from '../../src/game/core/owned_character_feed.ts'
import { reduce_app_state, type AppState } from '../../src/store.ts'
import { selected_character } from '../../src/modules/session.ts'
import { displayed_character } from '../../src/agents/observation.ts'
import { sync_world_activity } from '../../src/modules/engine_activity.ts'
import { remote_input_context } from '../../src/modules/fight_chain.ts'
import { automation_fixture, character } from '../modules/automation_fixture.ts'

const begin = (state: AppState) =>
  reduce_app_state(state, {
    type: 'agent/watch',
    observation: {
      pairing: { address: 'paired', multisig_public_key: 'public', signer_mode: 'disposable' },
      public_identifier: 'google',
      character_id: null,
    },
  })
const received = (state: AppState) =>
  reduce_app_state(state, {
    type: 'server/packet',
    packet: {
      type: 'packet/agent_observed',
      id: state.session.agent_view.serial,
      characters: [{ ...character(), id: 'remote', name: 'Agent' }],
      selected_character_id: 'remote',
      failed: false,
    },
  })
test('observed selection remains separate through owned roster refreshes and restores normal selection', () => {
  const own = automation_fixture()
  let state = received(begin(own))
  expect(selected_character(state.session)).toBeNull()
  expect(displayed_character(state.session)?.id).toBe('remote')
  expect(state.session.characters).toBe(own.session.characters)
  state = reduce_app_state(state, {
    type: 'server/packet',
    packet: { type: 'packet/characters', characters: own.session.characters.slice() },
  })
  expect(state.session.selected_character_id).toBe('remote')
  const stopped = reduce_app_state(state, { type: 'agent/watch', observation: null })
  expect(selected_character(stopped.session)?.id).toBe('alice')
  expect(stopped.session.agent_view.request).toBeNull()
  const stale = reduce_app_state(stopped, {
    type: 'server/packet',
    packet: {
      type: 'packet/agent_observed',
      id: state.session.agent_view.serial,
      characters: state.session.agent_view.characters,
      selected_character_id: 'remote',
      failed: false,
    },
  })
  expect(stale.session.selected_character_id).toBe('alice')
})
test('empty human roster does not reopen welcome, and camera remains interactive without movement authority', () => {
  const base = automation_fixture()
  let state = received(begin({ ...base, session: { ...base.session, characters: [], selected_character_id: null } }))
  state = reduce_app_state(state, { type: 'server/packet', packet: { type: 'packet/characters', characters: [] } })
  expect(state.navigation.dialog).toBeNull()
  const calls: unknown[] = []
  const world = {
    set_active: () => {},
    set_action_lock: () => {},
    set_interactive: (...args: unknown[]) => {
      calls.push(args)
    },
  }
  sync_world_activity(world, state)
  sync_world_activity(world, base)
  expect(calls).toEqual([
    [true, false],
    [true, true],
  ])
  expect(remote_input_context(state, 'fight', 'local')).toBeNull()
})
test('watching stops automatic travel and refuses local fight latches while accepting authoritative updates', () => {
  const running = reduce_app_state(automation_fixture(), {
    type: 'run_to/position',
    world: 'nauvis',
    x: 50010,
    z: 50000,
    source: 'map',
  })
  const state = received(begin(running))
  expect(state.run_to.run).toBeNull()
  expect(state.automation.run).toBeNull()
  const attempted = reduce_app_state(state, {
    type: 'fight/input',
    fight: 'fight',
    origin: 'local',
    input: { type: 'end_turn', fighter: 0n },
  })
  expect(attempted.fight).toBe(state.fight)
  const packet = reduce_app_state(state, {
    type: 'server/packet',
    packet: { type: 'packet/tracked_zones', character_id: 'remote', world: 'nauvis', zones: [{ zx: 97, zz: 97 }] },
  })
  expect(packet.world.tracked_world).toBe('nauvis')
})

test('clicked owned tab exits observation to that character, unknown selections leave it intact', () => {
  const base = automation_fixture()
  const state = received(
    begin({
      ...base,
      session: { ...base.session, characters: [...base.session.characters, { ...character(), id: 'bob' }] },
    })
  )
  expect(
    reduce_app_state(state, { type: 'character/select', character_id: 'unknown' }).session.selected_character_id
  ).toBe('remote')
  const switched = reduce_app_state(state, { type: 'character/select', character_id: 'bob' })
  expect(switched.session.selected_character_id).toBe('bob')
  expect(switched.session.agent_view.request).toBeNull()
})
test('observed presentation ignores formerly owned predicted positions and retains the dungeon actor', () => {
  const state = received(begin(automation_fixture()))
  const remote = displayed_character(state.session)!
  record_owned_character_position(remote.id, remote.world!, {
    checkpoint: character_checkpoint(remote)!,
    x: 55000,
    y: 80,
    z: 55000,
  })
  try {
    expect(selected_position(state)).toEqual({ x: 0, z: 0 })
    expect(world_presence_rows(state, () => 4).remote).toMatchObject({ x: 50000, y: 4, z: 50000 })
    const in_dungeon = {
      ...state,
      session: {
        ...state.session,
        agent_view: {
          ...state.session.agent_view,
          characters: [{ ...remote, dungeon_run: { dungeon: 'unknown', room: 0 } } as typeof remote],
        },
      },
    }
    const stage = selected_dungeon_position(in_dungeon)!
    expect(selected_position(in_dungeon)).toMatchObject({ x: stage.x, z: stage.z })
    expect(world_presence_rows(in_dungeon, () => 4).remote).toMatchObject({ x: stage.chain_x, y: 4, z: stage.chain_z })
  } finally {
    clear_owned_character_positions()
  }
})

test('account changes invalidate old observation responses even after watching again', () => {
  const first = received(begin(automation_fixture()))
  const reset = reduce_app_state(first, { type: 'auth/disconnected' })
  const next = begin(reset)
  const stale = reduce_app_state(next, {
    type: 'server/packet',
    packet: {
      type: 'packet/agent_observed',
      id: first.session.agent_view.serial,
      characters: first.session.agent_view.characters,
      selected_character_id: 'remote',
      failed: false,
    },
  })
  expect(stale.session.agent_view.characters).toEqual([])
  expect(stale.session.agent_view.serial).toBeGreaterThan(first.session.agent_view.serial)
})

test('observer boot never reads the saved owned pose while normal owned boot still does', async () => {
  const state = automation_fixture()
  let reads = 0
  const storage = {
    load: async () => {
      reads += 1
      return null
    },
    save: async () => {},
    remove: async () => {},
  }
  expect(await resolve_selected_position(received(begin(state)), storage)).toEqual({ x: 0, z: 0 })
  expect(reads).toBe(0)
  expect(await resolve_selected_position(state, storage)).toEqual({ x: 0, z: 0 })
  expect(reads).toBe(1)
})
