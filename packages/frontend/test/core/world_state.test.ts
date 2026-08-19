// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'
import type { PresenceRow, ServerPacket } from '@aresrpg/protocol'

import world, { initial_world_state, spawn_markers, zone_key } from '../../src/modules/world.ts'
import { initial_app_state } from '../../src/store.ts'
import type { GameSettings } from '../../src/game/core/settings.ts'

const settings: GameSettings = Object.freeze({
  quality: 'medium',
  flat_mode: false,
  music_enabled: true,
  render_distance: null,
})

const fold = (packets: readonly ServerPacket[]) =>
  packets.reduce(
    (state, packet) => world.reduce!(state, { type: 'server/packet', packet }),
    initial_app_state(settings)
  ).world

const presence = (character_id: string, x: number, z: number): PresenceRow => ({
  character_id,
  name: 'Cra',
  classe: 'senshi',
  sex: 'male',
  level: 3,
  color_1: 0,
  color_2: 0,
  color_3: 0,
  hat: null,
  cloak: null,
  title: null,
  pet: null,
  x,
  y: 64,
  z,
})

test('zones fold by key and a search stamps the fresh seed without losing consumption', () => {
  const state = fold([
    {
      type: 'packet/zones',
      zones: [{ world: 'overworld', zx: 3, zz: 4, seed: '7', searched_at_ms: 1, mob_taken: '5', res_taken: [1] }],
    },
    { type: 'packet/zone_searched', world: 'overworld', zx: 3, zz: 4, seed: '9' },
  ])

  const row = state.zones[zone_key('overworld', 3, 4)]!
  expect(row.seed).toBe('9')
  expect(row.mob_taken).toBe('5')
})

test('players appear, move by id, and leave — a move for an unknown player is dropped', () => {
  const state = fold([
    { type: 'packet/player_appeared', player: presence('0xc1', 10, 10) },
    { type: 'packet/player_moved', character_id: '0xc1', x: 11, y: 64, z: 12 },
    { type: 'packet/player_moved', character_id: '0xghost', x: 1, y: 1, z: 1 },
    { type: 'packet/player_appeared', player: presence('0xc2', 5, 5) },
    { type: 'packet/player_left', character_id: '0xc2' },
  ])

  expect(state.players['0xc1']).toMatchObject({ x: 11, z: 12, name: 'Cra' })
  expect(state.players['0xghost']).toBeUndefined()
  expect(state.players['0xc2']).toBeUndefined()
})

test('zone spawns fold by zone and project to client-space markers', () => {
  const state = fold([
    {
      type: 'packet/zone_spawns',
      world: 'overworld',
      zx: 97,
      zz: 98,
      mobs: [{ index: 2, x: 49_700, z: 50_200, members: [{ mob_type: 'wooling', level_scalar: 40 }] }],
      resources: [{ index: 0, x: 49_800, z: 50_180, item_type: 'green_mushroom', job: 'HERBALIST', tier: 1, nodes: 3 }],
    },
  ])

  const markers = spawn_markers(state)
  expect(markers).toHaveLength(2)
  const mob = markers.find(({ kind }) => kind === 'mob')!
  expect(mob).toMatchObject({ x: -300, z: 200, zx: 97, zz: 98, size: 1 })
  const resource = markers.find(({ kind }) => kind === 'resource')!
  expect(resource).toMatchObject({ x: -200, z: 180, job: 'HERBALIST', tier: 1 })
})

test('a disconnect clears the whole surrounding', () => {
  const populated = initial_app_state(settings)
  const with_player = world.reduce!(populated, {
    type: 'server/packet',
    packet: { type: 'packet/player_appeared', player: presence('0xc1', 0, 0) },
  })
  const cleared = world.reduce!(with_player, { type: 'auth/disconnected' })

  expect(cleared.world).toEqual(initial_world_state())
})
