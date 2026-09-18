// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'
import type { CharacterRow, PresenceRow, ServerPacket } from '@aresrpg/protocol'

import { initial_app_state, reduce_app_state } from '../../src/store.ts'

const app_state = (): ReturnType<typeof initial_app_state> => {
  const state = initial_app_state({
    quality: 'medium',
    flat_mode: false,
    music_enabled: true,
    render_distance: null,
    fight_access: 0,
  })
  return {
    ...state,
    session: {
      ...state.session,
      selected_character_id: '0xc',
      characters: [{ id: '0xc', world: 'overworld' }] as CharacterRow[],
    },
  }
}
const presence = (character_id: string, x: number, z: number): PresenceRow => ({
  character_id,
  x,
  z,
  y: 0,
  world: 'overworld',
  owner: 'other',
  name: 'Other player',
  classe: 'senshi',
  sex: 'male',
  level: 1,
  color_1: 0,
  color_2: 0,
  color_3: 0,
  hat: null,
  cloak: null,
  cosmetic_hat: null,
  cosmetic_cloak: null,
  title: null,
  pet: null,
  riding: false,
})
const tracked = (world: string, zones: { zx: number; zz: number }[]): ServerPacket => ({
  type: 'packet/tracked_zones',
  character_id: '0xc',
  world,
  zones,
})

test('a travel receipt immediately hides the old world while destination tracking catches up', () => {
  const before = app_state()
  let state = before
  state = reduce_app_state(state, { type: 'server/packet', packet: tracked('overworld', [{ zx: 0, zz: 0 }]) })
  state = reduce_app_state(state, {
    type: 'server/packet',
    packet: { type: 'packet/player_appeared', player: presence('old-world-player', 100, 100) },
  })
  expect(Object.keys(state.world.players)).toEqual(['old-world-player'])
  state = reduce_app_state(state, {
    type: 'character/world_joined',
    character_id: '0xc',
    joined: { world: 'yakutia', x: 100, z: 100, first_join: true },
  })
  expect(state.world.players).toEqual({})
  expect(state.world.tracked_world).toBeNull()
  state = reduce_app_state(state, {
    type: 'server/packet',
    packet: { type: 'packet/player_appeared', player: presence('late-old-world-player', 100, 100) },
  })
  expect(state.world.players).toEqual({})
  state = reduce_app_state(state, { type: 'server/packet', packet: tracked('yakutia', [{ zx: 0, zz: 0 }]) })
  expect(state.world.tracked_world).toBe('yakutia')
})

test('destination packets received before the travel receipt stay cached until that world is selected', () => {
  let state = reduce_app_state(app_state(), {
    type: 'server/packet',
    packet: tracked('yakutia', [{ zx: 0, zz: 0 }]),
  })
  state = reduce_app_state(state, {
    type: 'server/packet',
    packet: {
      type: 'packet/zones',
      zones: [{ world: 'yakutia', zx: 0, zz: 0, seed: '8', searched_at_ms: 100, mob_taken: '0', res_taken: [] }],
    },
  })
  expect(state.world.zones).toEqual({})
  state = reduce_app_state(state, {
    type: 'character/world_joined',
    character_id: '0xc',
    joined: { world: 'yakutia', x: 100, z: 100, first_join: true },
  })
  expect(state.world.zones['yakutia:0:0']?.seed).toBe('8')
})
