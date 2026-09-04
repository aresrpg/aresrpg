// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'
import type { PresenceRow, ServerPacket } from '@aresrpg/protocol'

import world, {
  engage_sword_markers,
  dungeon_portal_markers,
  initial_world_state,
  live_spawns,
  spawn_markers,
  zone_key,
} from '../../src/modules/world.ts'
import { engage_conflict_refusal, new_pending_engages, sword_fights } from '../../src/modules/world_engage.ts'
import {
  automatic_authoritative_ambush_input,
  automatic_ambush_input,
  selected_world_action_lock,
  selected_world_ambush,
} from '../../src/modules/world_gather.ts'
import { initial_app_state } from '../../src/store.ts'
import type { GameSettings } from '../../src/game/core/settings.ts'

const settings: GameSettings = Object.freeze({
  quality: 'medium',
  flat_mode: false,
  music_enabled: true,
  render_distance: null,
  fight_access: 0,
})
const app_state = (): ReturnType<typeof initial_app_state> => {
  const state = initial_app_state(settings)
  return Object.freeze({
    ...state,
    session: Object.freeze({ ...state.session, selected_character_id: '0xc' }),
  })
}

const fold = (packets: readonly ServerPacket[]) =>
  packets.reduce((state, packet) => world.reduce!(state, { type: 'server/packet', packet }), app_state()).world

const presence = (character_id: string, x: number, z: number): PresenceRow => ({
  character_id,
  world: 'overworld',
  owner: '0xowner',
  name: 'Yogan',
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
const tracked = (world: string, zones: readonly { zx: number; zz: number }[]): ServerPacket => ({
  type: 'packet/tracked_zones',
  character_id: '0xc',
  world,
  zones: [...zones],
})

test('packet/zones is the ONE door for a zone changing — rows merge and land whole', () => {
  // a spiral push, a discovery and a consumption all arrive the same way: the projected row.
  // Nothing is carried forward by hand — a re-roll ZEROES consumption on chain, and the client
  // that used to preserve the old bitmaps was inventing state the chain had already discarded.
  const state = fold([
    tracked('overworld', [
      { zx: 3, zz: 4 },
      { zx: 9, zz: 9 },
    ]),
    {
      type: 'packet/zones',
      zones: [
        { world: 'overworld', zx: 3, zz: 4, seed: '7', searched_at_ms: 1, mob_taken: '5', res_taken: [1] },
        { world: 'overworld', zx: 9, zz: 9, seed: '1', searched_at_ms: 2, mob_taken: '0', res_taken: [] },
      ],
    },
    {
      type: 'packet/zones',
      zones: [{ world: 'overworld', zx: 3, zz: 4, seed: '9', searched_at_ms: 500, mob_taken: '0', res_taken: [] }],
    },
  ])

  expect(state.zones[zone_key('overworld', 3, 4)]).toEqual({
    world: 'overworld',
    zx: 3,
    zz: 4,
    seed: '9',
    searched_at_ms: 500,
    mob_taken: '0',
    res_taken: [],
  })
  // the single-row update MERGES — the other tracked zone is untouched
  expect(state.zones[zone_key('overworld', 9, 9)]?.seed).toBe('1')
})

test('gathering stays locked through its receipt and adopts the chain checkpoint deadline', () => {
  let state = app_state()
  state = world.reduce!(state, {
    type: 'world/gather_started',
    gathering: {
      character_id: '0xc',
      item_type: 'ivory_shrooms',
      protector: 'protector_ivory_gaia',
      started_at_ms: 1_000,
      duration_ms: 12_000,
      ends_at_ms: 13_000,
      confirmed: false,
      authoritative: false,
      ambushed: false,
      quantity: null,
    },
  })
  expect(
    selected_world_action_lock({
      ...state,
      session: { ...state.session, characters: [{ id: '0xc' }] },
    } as never)
  ).toEqual({ character_id: '0xc', animation: 'gather' })
  state = world.reduce!(state, {
    type: 'world/gather_confirmed',
    character_id: '0xc',
    fallback_ends_at_ms: 14_500,
    ambushed: false,
    quantity: 7,
  })
  expect(state.world.gathering).toMatchObject({ confirmed: true, ends_at_ms: 14_500, authoritative: false })

  state = world.reduce!(state, {
    type: 'server/packet',
    packet: { type: 'packet/characters', characters: [{ id: '0xc', at_ms: 13_420 }] } as never,
  })
  expect(state.world.gathering).toMatchObject({ ends_at_ms: 13_420, authoritative: true })

  state = world.reduce!(state, { type: 'world/gather_finished', character_id: '0xc', ends_at_ms: 14_500 })
  expect(state.world.gathering).not.toBeNull()
  state = world.reduce!(state, { type: 'world/gather_finished', character_id: '0xc', ends_at_ms: 13_420 })
  expect(state.world.gathering).toBeNull()
})

test('an ambush receipt replaces gathering animation and automatically resolves the protector', () => {
  let state = app_state()
  state = world.reduce!(state, {
    type: 'world/gather_started',
    gathering: {
      character_id: '0xc',
      item_type: 'wheat',
      protector: 'protector_wheat_bricheton',
      started_at_ms: 1_000,
      duration_ms: 12_000,
      ends_at_ms: 13_000,
      confirmed: false,
      authoritative: false,
      ambushed: false,
      quantity: null,
    },
  })
  state = world.reduce!(state, {
    type: 'server/packet',
    packet: {
      type: 'packet/characters',
      characters: [{ id: '0xc', ambush: { protector: 'protector_wheat_bricheton' } }],
    } as never,
  })
  expect(state.world.gathering).toMatchObject({ ambushed: true, quantity: null })
  state = world.reduce!(state, {
    type: 'world/gather_confirmed',
    character_id: '0xc',
    fallback_ends_at_ms: 14_000,
    ambushed: true,
    quantity: 1,
  })
  const selected = {
    ...state,
    session: { ...state.session, characters: [{ id: '0xc' }] },
  } as never

  expect(selected_world_ambush(selected)).toBe('protector_wheat_bricheton')
  expect(selected_world_action_lock(selected)).toEqual({ character_id: '0xc', animation: null })
  expect(automatic_ambush_input(state.world.gathering)).toEqual({ type: 'world/resolve_ambush' })

  const refreshed = {
    ...state,
    world: { ...state.world, gathering: null },
    session: {
      ...state.session,
      characters: [{ id: '0xc', ambush: { protector: 'protector_wheat_bricheton' } }],
    },
  } as never
  expect(automatic_authoritative_ambush_input(refreshed)).toEqual({ type: 'world/resolve_ambush' })
})

test('players appear, move by id, and leave — a move for an unknown player is dropped', () => {
  const state = fold([
    tracked('overworld', [{ zx: 0, zz: 0 }]),
    { type: 'packet/player_appeared', player: presence('0xc1', 10, 10) },
    { type: 'packet/player_moved', character_id: '0xc1', x: 11, y: 64, z: 12, riding: false },
    { type: 'packet/player_moved', character_id: '0xghost', x: 1, y: 1, z: 1, riding: false },
    { type: 'packet/player_appeared', player: presence('0xc2', 5, 5) },
    { type: 'packet/player_left', character_id: '0xc2' },
  ])

  expect(state.players['0xc1']).toMatchObject({ x: 11, z: 12, name: 'Yogan' })
  expect(state.players['0xghost']).toBeUndefined()
  expect(state.players['0xc2']).toBeUndefined()
})

test('mounting rides the position stream — the riding flag folds onto the presence row', () => {
  // owner 2026-08-21: mount/dismount forwards through the EXISTING position packet, never its
  // own packet or a sync timer — a toggle is one flag arriving with the next position fact
  const state = fold([
    tracked('overworld', [{ zx: 0, zz: 0 }]),
    { type: 'packet/player_appeared', player: presence('0xc1', 10, 10) },
    { type: 'packet/player_moved', character_id: '0xc1', x: 10, y: 64, z: 10, riding: true },
  ])
  const dismounted = fold([
    tracked('overworld', [{ zx: 0, zz: 0 }]),
    { type: 'packet/player_appeared', player: presence('0xc1', 10, 10) },
    { type: 'packet/player_moved', character_id: '0xc1', x: 10, y: 64, z: 10, riding: true },
    { type: 'packet/player_moved', character_id: '0xc1', x: 10, y: 64, z: 10, riding: false },
  ])

  expect(state.players['0xc1']).toMatchObject({ riding: true })
  expect(dismounted.players['0xc1']).toMatchObject({ riding: false })
})

test('a visible slot change folds onto the known presence row — unknown ids are dropped', () => {
  const state = fold([
    tracked('overworld', [{ zx: 0, zz: 0 }]),
    { type: 'packet/player_appeared', player: presence('0xc1', 10, 10) },
    { type: 'packet/player_equipment', character_id: '0xc1', slot: 'hat', item_type: 'straw_hat' },
    { type: 'packet/player_equipment', character_id: '0xc1', slot: 'pet', item_type: 'tofu' },
    { type: 'packet/player_equipment', character_id: '0xghost', slot: 'hat', item_type: 'straw_hat' },
  ])

  expect(state.players['0xc1']).toMatchObject({ hat: 'straw_hat', pet: 'tofu' })
  expect(state.players['0xghost']).toBeUndefined()
})

const POPULATED_ZONE: readonly ServerPacket[] = [
  { type: 'packet/tracked_zones', character_id: '0xc', world: 'overworld', zones: [{ zx: 97, zz: 98 }] },
  {
    type: 'packet/zones',
    zones: [{ world: 'overworld', zx: 97, zz: 98, seed: '7', searched_at_ms: 1, mob_taken: '0', res_taken: [] }],
  },
  {
    type: 'packet/zone_spawns',
    world: 'overworld',
    zx: 97,
    zz: 98,
    mobs: [
      { index: 2, x: 49_700, z: 50_200, members: [{ mob_type: 'wooling', level_scalar: 40 }] },
      { index: 3, x: 49_710, z: 50_210, members: [{ mob_type: 'razkin', level_scalar: 60 }] },
    ],
    resources: [{ index: 0, x: 49_800, z: 50_180, item_type: 'green_mushroom', nodes: 3 }],
  },
]

test('zone spawns fold by zone and project to client-space markers', () => {
  const state = fold(POPULATED_ZONE)

  const markers = spawn_markers(state)
  expect(markers).toHaveLength(3)
  const mob = markers.find(({ spawn_id }) => spawn_id.endsWith('m2'))!
  expect(mob).toMatchObject({ x: -300, z: 200, zx: 97, zz: 98, size: 1 })
  const resource = markers.find(({ kind }) => kind === 'resource')!
  expect(resource).toMatchObject({ x: -200, z: 180, item_type: 'green_mushroom' })
})

test('spawn markers never leak retained discoveries from another world', () => {
  const overworld = fold(POPULATED_ZONE)
  const stale_key = zone_key('nauvis', 97, 98)
  const current_key = zone_key('yakutia', 97, 98)
  const retained = {
    ...overworld,
    tracked_world: 'yakutia',
    zones: {
      [stale_key]: { ...overworld.zones[zone_key('overworld', 97, 98)]!, world: 'nauvis' },
      [current_key]: { ...overworld.zones[zone_key('overworld', 97, 98)]!, world: 'yakutia' },
    },
    spawns: {
      [stale_key]: overworld.spawns[zone_key('overworld', 97, 98)]!,
      [current_key]: overworld.spawns[zone_key('overworld', 97, 98)]!,
    },
  }

  expect(spawn_markers(retained, 'yakutia')).toHaveLength(3)
  expect(spawn_markers(retained, 'yakutia').every(({ spawn_id }) => spawn_id.startsWith('yakutia:'))).toBeTrue()
})

test('only the matching reveal timer may clear the current zone discovery', () => {
  const first = { id: 'first', zx: 97, zz: 98, biome: 'plains', mobs: 2, resources: 3 }
  const second = { id: 'second', zx: 98, zz: 98, biome: 'forest', mobs: 4, resources: 5 }
  const revealed = world.reduce!(app_state(), { type: 'world/zone_revealed', reveal: first })
  const replaced = world.reduce!(revealed, { type: 'world/zone_revealed', reveal: second })

  expect(world.reduce!(replaced, { type: 'world/zone_reveal_cleared', id: first.id }).world.zone_reveal).toEqual(second)
  expect(world.reduce!(replaced, { type: 'world/zone_reveal_cleared', id: second.id }).world.zone_reveal).toBeNull()
})

test('dungeon portals project directly from authored cities without zone discovery', () => {
  expect(dungeon_portal_markers('nauvis')).toEqual([
    {
      id: 'dungeon:nauvis:thebes:gilded_lorito',
      world: 'nauvis',
      city: 'thebes',
      dungeon: 'gilded_lorito',
      x: 512,
      z: 0,
      zx: 98,
      zz: 97,
    },
    {
      id: 'dungeon:nauvis:the_ruins:tangled_aftermath',
      world: 'nauvis',
      city: 'the_ruins',
      dungeon: 'tangled_aftermath',
      x: -13_936,
      z: -1_328,
      zx: 70,
      zz: 95,
    },
    {
      id: 'dungeon:nauvis:fuwage:ivory_rampart',
      world: 'nauvis',
      city: 'fuwage',
      dungeon: 'ivory_rampart',
      x: -35_760,
      z: -27_312,
      zx: 27,
      zz: 44,
    },
  ])
})

test('engage hides the mob and plants a reversible sword before the transaction settles', () => {
  const loaded = POPULATED_ZONE.reduce(
    (state, packet) => world.reduce!(state, { type: 'server/packet', packet }),
    app_state()
  )
  const group = 'overworld:97:98:s7:m2'
  const pending = world.reduce!(loaded, { type: 'world/engage', group, access: 0, started_at_ms: 12_345 })
  const duplicate = world.reduce!(pending, { type: 'world/engage', group, access: 1, started_at_ms: 12_346 })

  expect(spawn_markers(pending.world).some(({ spawn_id }) => spawn_id === group)).toBe(false)
  expect(new_pending_engages(pending.world, loaded.world).map(({ group }) => group)).toEqual([group])
  expect(pending.world.pending_engages[group]?.access).toBe(0)
  expect(new_pending_engages(duplicate.world, pending.world)).toEqual([])
  expect(engage_sword_markers(pending.world)).toEqual([
    { id: `engage:${group}`, x: -300, z: 200, placement_ms: 12_345 },
  ])

  const submitted = world.reduce!(pending, {
    type: 'world/engage_submitted',
    group,
    fight: '0xfight',
    character_id: '0xcharacter',
  })
  expect(engage_sword_markers(submitted.world)).toHaveLength(1)
  const consumed = world.reduce!(submitted, {
    type: 'server/packet',
    packet: {
      type: 'packet/zones',
      zones: [{ world: 'overworld', zx: 97, zz: 98, seed: '7', searched_at_ms: 2, mob_taken: '4', res_taken: [] }],
    },
  })
  expect(consumed.world.pending_engages).toEqual({})
  expect(spawn_markers(consumed.world).some(({ spawn_id }) => spawn_id === group)).toBe(false)
  const mounted = world.reduce!(submitted, { type: 'world/engage_confirmed', group })
  expect(engage_sword_markers(mounted.world)).toEqual([])

  const rejected = world.reduce!(pending, { type: 'world/engage_failed', group })
  expect(spawn_markers(rejected.world).some(({ spawn_id }) => spawn_id === group)).toBe(true)
  expect(engage_sword_markers(rejected.world)).toEqual([])
})

test('an encoded stale-object engage race becomes a clean conflict', () => {
  expect(
    engage_conflict_refusal(
      new Error(
        'Transaction%20is%20rejected%20as%20invalid.%20Transaction%20needs%20to%20be%20rebuilt%20because%20object%200xf00%20is%20unavailable%20for%20consumption,%20current%20version:%200x2'
      )
    )
  ).toBeTrue()
  expect(engage_conflict_refusal(new Error('MoveAbort abort code: 1724'))).toBeFalse()
})

test('consumption arrives as the zone row alone and retires what it took', () => {
  // the population is worth ~15KB and never changes for a seed; a group being engaged is one
  // bit. The wire ships the bit, and the join happens here.
  const state = fold([
    ...POPULATED_ZONE,
    {
      type: 'packet/zones',
      zones: [{ world: 'overworld', zx: 97, zz: 98, seed: '7', searched_at_ms: 1, mob_taken: '4', res_taken: [2] }],
    },
  ])

  const markers = spawn_markers(state)
  // group 2 was engaged (bit 2 set); group 3 still stands
  expect(markers.map(({ spawn_id }) => spawn_id.split(':').at(-1))).toEqual(['m3', 'r0'])
  // the population itself was never re-sent — the pack simply reports what it has left
  expect(state.spawns[zone_key('overworld', 97, 98)]?.resources[0]?.nodes).toBe(3)
  expect(live_spawns(state, zone_key('overworld', 97, 98)).resources[0]?.nodes).toBe(1)
})

test('a reroll flushes the old population before the replacement seed arrives', () => {
  const rerolled = fold([
    ...POPULATED_ZONE,
    {
      type: 'packet/zones',
      zones: [{ world: 'overworld', zx: 97, zz: 98, seed: '8', searched_at_ms: 2, mob_taken: '0', res_taken: [] }],
    },
  ])
  expect(spawn_markers(rerolled)).toEqual([])

  const replaced = fold([
    ...POPULATED_ZONE,
    {
      type: 'packet/zones',
      zones: [{ world: 'overworld', zx: 97, zz: 98, seed: '8', searched_at_ms: 2, mob_taken: '0', res_taken: [] }],
    },
    POPULATED_ZONE[2]!,
  ])
  expect(spawn_markers(replaced).every(({ spawn_id }) => spawn_id.includes(':s8:'))).toBe(true)
})

test('the tracked window prunes departed rows and a world change clears presence', () => {
  const old = fold([
    { type: 'packet/tracked_zones', character_id: '0xc', world: 'overworld', zones: [{ zx: 97, zz: 98 }] },
    ...POPULATED_ZONE.slice(1),
    { type: 'packet/player_appeared', player: presence('0xc1', 49_700, 50_200) },
  ])
  const moved = world.reduce!(
    { ...app_state(), world: old },
    {
      type: 'server/packet',
      packet: { type: 'packet/tracked_zones', character_id: '0xc', world: 'overworld', zones: [{ zx: 98, zz: 98 }] },
    }
  ).world
  expect(moved.zones).toEqual({})
  expect(moved.spawns).toEqual({})
  expect(moved.all_zones).toEqual({})
  expect(moved.all_spawns).toEqual({})

  const changed = world.reduce!(
    { ...app_state(), world: moved },
    {
      type: 'server/packet',
      packet: { type: 'packet/tracked_zones', character_id: '0xc', world: 'verdant', zones: [] },
    }
  ).world
  expect(changed.players).toEqual({})
})

test('character selection projects an already-cached independent zone window', () => {
  const packets: readonly ServerPacket[] = [
    { type: 'packet/tracked_zones', character_id: '0xc', world: 'overworld', zones: [{ zx: 1, zz: 1 }] },
    { type: 'packet/tracked_zones', character_id: '0xd', world: 'verdant', zones: [{ zx: 2, zz: 2 }] },
    {
      type: 'packet/zones',
      zones: [
        { world: 'overworld', zx: 1, zz: 1, seed: '1', searched_at_ms: 1, mob_taken: '0', res_taken: [] },
        { world: 'verdant', zx: 2, zz: 2, seed: '2', searched_at_ms: 1, mob_taken: '0', res_taken: [] },
      ],
    },
  ]
  const before = packets.reduce((state, packet) => world.reduce!(state, { type: 'server/packet', packet }), app_state())
  const selected = world.reduce!(
    { ...before, session: { ...before.session, selected_character_id: '0xd' } },
    { type: 'character/select', character_id: '0xd' }
  )

  expect(Object.keys(before.world.zones)).toEqual(['overworld:1:1'])
  expect(Object.keys(selected.world.zones)).toEqual(['verdant:2:2'])
  expect(Object.keys(selected.world.all_zones).sort()).toEqual(['overworld:1:1', 'verdant:2:2'])
})

test('a population with no zone row states nothing about consumption and renders nothing', () => {
  // the seed only ever reaches the client alongside its row; the reverse is a torn moment, and
  // rendering it as "nothing taken" would republish every consumed group as live truth
  const state = fold([POPULATED_ZONE[2]!])

  expect(spawn_markers(state)).toHaveLength(0)
})

test('a disconnect clears the whole surrounding', () => {
  const populated = app_state()
  const with_player = world.reduce!(populated, {
    type: 'server/packet',
    packet: { type: 'packet/player_appeared', player: presence('0xc1', 0, 0) },
  })
  const cleared = world.reduce!(with_player, { type: 'auth/disconnected' })

  expect(cleared.world).toEqual(initial_world_state())
})

test('fight markers fold: tracked batches merge, creations upsert, phases flip and despawn', () => {
  const row = {
    id: '0xfight1',
    world: 'zenith',
    x: 100,
    z: 200,
    phase: 'placement',
    access_a: 0,
    access_b: 255,
    opener_a: null,
    opener_b: null,
    managed: false,
    wagered: false,
    placement_ms: '1000',
  }
  // the initial tracked batch seeds the marker set; later batches may contain only fresh zones
  const snapshotted = fold([tracked('zenith', [{ zx: 0, zz: 0 }]), { type: 'packet/fights', fights: [row] }])
  expect(Object.keys(snapshotted.fights)).toEqual(['0xfight1'])

  // A CREATION SHIPS THE PROJECTED ROW (2026-08-21): the fold stores what the wire carried and
  // never fills a missing field — a guessed `managed` used to plant a sword on a fight that
  // must never wear one, until the next snapshot happened to correct it.
  const born = { ...row, id: '0xf2', x: 5, z: 6, managed: true, access_a: 1, placement_ms: '2000' }
  const created = fold([
    tracked('zenith', [{ zx: 0, zz: 0 }]),
    { type: 'packet/fights', fights: [] },
    { type: 'packet/fight_created', fight: born },
  ])
  expect(created.fights['0xf2']).toEqual(born)

  const active = fold([
    tracked('zenith', [{ zx: 0, zz: 0 }]),
    { type: 'packet/fights', fights: [row] },
    { type: 'packet/fight_phase', fight: '0xfight1', phase: 'active' },
  ])
  expect(active.fights['0xfight1']?.phase).toBe('active')
  expect(sword_fights(active.fights, 'zenith').map(({ id }) => id)).toEqual(['0xfight1'])
  expect(sword_fights(snapshotted.fights, 'zenith').map(({ id }) => id)).toEqual(['0xfight1'])

  const ended = fold([
    tracked('zenith', [{ zx: 0, zz: 0 }]),
    { type: 'packet/fights', fights: [row] },
    { type: 'packet/fight_phase', fight: '0xfight1', phase: 'ended' },
  ])
  expect(ended.fights['0xfight1']).toBeUndefined()

  // a phase fact for an untracked fight is noise — folded as nothing
  const unknown = fold([{ type: 'packet/fight_phase', fight: '0xghost', phase: 'active' }])
  expect(unknown.fights).toEqual({})
})
