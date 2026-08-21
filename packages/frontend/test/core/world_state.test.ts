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
  owner: '0xowner',
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
  riding: false,
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
    { type: 'packet/player_moved', character_id: '0xc1', x: 11, y: 64, z: 12, riding: false },
    { type: 'packet/player_moved', character_id: '0xghost', x: 1, y: 1, z: 1, riding: false },
    { type: 'packet/player_appeared', player: presence('0xc2', 5, 5) },
    { type: 'packet/player_left', character_id: '0xc2' },
  ])

  expect(state.players['0xc1']).toMatchObject({ x: 11, z: 12, name: 'Cra' })
  expect(state.players['0xghost']).toBeUndefined()
  expect(state.players['0xc2']).toBeUndefined()
})

test('mounting rides the position stream — the riding flag folds onto the presence row', () => {
  // owner 2026-08-21: mount/dismount forwards through the EXISTING position packet, never its
  // own packet or a sync timer — a toggle is one flag arriving with the next position fact
  const state = fold([
    { type: 'packet/player_appeared', player: presence('0xc1', 10, 10) },
    { type: 'packet/player_moved', character_id: '0xc1', x: 10, y: 64, z: 10, riding: true },
  ])
  const dismounted = fold([
    { type: 'packet/player_appeared', player: presence('0xc1', 10, 10) },
    { type: 'packet/player_moved', character_id: '0xc1', x: 10, y: 64, z: 10, riding: true },
    { type: 'packet/player_moved', character_id: '0xc1', x: 10, y: 64, z: 10, riding: false },
  ])

  expect(state.players['0xc1']).toMatchObject({ riding: true })
  expect(dismounted.players['0xc1']).toMatchObject({ riding: false })
})

test('a visible slot change folds onto the known presence row — unknown ids are dropped', () => {
  const state = fold([
    { type: 'packet/player_appeared', player: presence('0xc1', 10, 10) },
    { type: 'packet/player_equipment', character_id: '0xc1', slot: 'hat', item_type: 'straw_hat' },
    { type: 'packet/player_equipment', character_id: '0xc1', slot: 'pet', item_type: 'tofu' },
    { type: 'packet/player_equipment', character_id: '0xghost', slot: 'hat', item_type: 'straw_hat' },
  ])

  expect(state.players['0xc1']).toMatchObject({ hat: 'straw_hat', pet: 'tofu' })
  expect(state.players['0xghost']).toBeUndefined()
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

test('fight markers fold: snapshots replace, creations upsert, phases flip and despawn', () => {
  const row = {
    id: '0xfight1',
    world: 'zenith',
    x: 100,
    z: 200,
    phase: 'placement',
    access_a: 0,
    access_b: 255,
    managed: false,
    wagered: false,
    placement_ms: '1000',
  }
  // the snapshot IS the tracked zones' truth: a stale marker outside it is dropped
  const snapshotted = fold([{ type: 'packet/fights', fights: [row] }])
  expect(Object.keys(snapshotted.fights)).toEqual(['0xfight1'])

  // A CREATION SHIPS THE PROJECTED ROW (2026-08-21): the fold stores what the wire carried and
  // never fills a missing field — a guessed `managed` used to plant a sword on a fight that
  // must never wear one, until the next snapshot happened to correct it.
  const born = { ...row, id: '0xf2', x: 5, z: 6, managed: true, access_a: 1, placement_ms: '2000' }
  const created = fold([
    { type: 'packet/fights', fights: [] },
    { type: 'packet/fight_created', fight: born },
  ])
  expect(created.fights['0xf2']).toEqual(born)

  const active = fold([
    { type: 'packet/fights', fights: [row] },
    { type: 'packet/fight_phase', fight: '0xfight1', phase: 'active' },
  ])
  expect(active.fights['0xfight1']?.phase).toBe('active')

  const ended = fold([
    { type: 'packet/fights', fights: [row] },
    { type: 'packet/fight_phase', fight: '0xfight1', phase: 'ended' },
  ])
  expect(ended.fights['0xfight1']).toBeUndefined()

  // a phase fact for an untracked fight is noise — folded as nothing
  const unknown = fold([{ type: 'packet/fight_phase', fight: '0xghost', phase: 'active' }])
  expect(unknown.fights).toEqual({})
})
