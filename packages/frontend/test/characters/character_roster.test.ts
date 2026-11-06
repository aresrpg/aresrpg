// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import type { CharacterRow } from '@aresrpg/protocol'

import { initial_app_state, reduce_app_state } from '../../src/store.ts'

const rows = Array.from(
  { length: 100 },
  (_, index) =>
    ({
      id: '0x' + index.toString(16).padStart(64, '0'),
      name: 'Fixture',
      classe: 'senshi',
      sex: 'male',
      level: 1,
      experience: '0',
      color_1: 0,
      color_2: 0,
      color_3: 0,
      vitality: 0,
      wisdom: 0,
      strength: 0,
      intelligence: 0,
      chance: 0,
      agility: 0,
      available_points: 0,
      spells: {},
      available_spell_points: 0,
      jobs: {},
      kiosk: '0xk',
      equipment: [],
      custody: 'kiosk',
    }) satisfies CharacterRow
)
const initial = () => initial_app_state({ quality: 'medium', music_enabled: true, render_distance: null })
const packet = { type: 'server/packet', packet: { type: 'packet/characters', characters: rows } } as const

test('a hundred server characters project six frontend characters and retire hidden selection and crafting', () => {
  const base = initial()
  const state = reduce_app_state(
    {
      ...base,
      session: { ...base.session, selected_character_id: rows[99].id },
      settings: { ...base.settings, always_craft_from_character_id: rows[99].id },
      world: { ...base.world, windows: Object.fromEntries(rows.map(({ id }) => [id, { world: 'nauvis', zones: [] }])) },
    },
    packet
  )
  expect(state.session.characters.map(({ id }) => id)).toEqual(rows.slice(0, 6).map(({ id }) => id))
  expect(state.session.selected_character_id).toBe(rows[0].id)
  expect(state.settings.always_craft_from_character_id).toBeNull()
  expect(Object.keys(state.world.windows)).toEqual(rows.map(({ id }) => id))
})

test('tombstones filter before the six-character projection and a retained selection survives', () => {
  const base = initial()
  const state = reduce_app_state(
    {
      ...base,
      session: {
        ...base.session,
        deleted_character_ids: [rows[0].id, rows[1].id],
        selected_character_id: rows[5].id,
      },
    },
    packet
  )
  expect(state.session.characters.map(({ id }) => id)).toEqual(rows.slice(2, 8).map(({ id }) => id))
  expect(state.session.selected_character_id).toBe(rows[5].id)
})

test('a fully tombstoned raw roster cannot hide the empty-roster welcome', () => {
  const base = initial()
  const state = reduce_app_state(
    {
      ...base,
      session: {
        ...base.session,
        deleted_character_ids: rows.map(({ id }) => id),
      },
    },
    packet
  )
  expect(state.session.characters).toEqual([])
  expect(state.navigation.dialog).toBe('welcome')
})

test('a formerly hidden character retains its known window and zone data when promoted into the visible six', () => {
  const owned = rows.slice(0, 7).map((row) => ({ ...row, world: 'nauvis' }))
  const bootstrap = owned.reduce(
    (state, { id }, index) =>
      reduce_app_state(state, {
        type: 'server/packet',
        packet: {
          type: 'packet/tracked_zones',
          character_id: id,
          world: 'nauvis',
          zones: [{ zx: index, zz: 0 }],
        },
      }),
    initial()
  )
  const zone = { world: 'nauvis', zx: 6, zz: 0, seed: '7', searched_at_ms: 1, mob_taken: '0', res_taken: [] }
  const populated = reduce_app_state(bootstrap, {
    type: 'server/packet',
    packet: { type: 'packet/zones', zones: [zone] },
  })
  const admitted = reduce_app_state(populated, {
    type: 'server/packet',
    packet: { type: 'packet/characters', characters: owned },
  })
  expect(admitted.session.characters).toHaveLength(6)
  expect(admitted.session.characters.some(({ id }) => id === owned[6].id)).toBeFalse()
  const promoted = reduce_app_state(admitted, {
    type: 'server/packet',
    packet: { type: 'packet/characters', characters: owned.slice(1) },
  })
  const selected = reduce_app_state(promoted, { type: 'character/select', character_id: owned[6].id })
  expect(selected.session.characters).toHaveLength(6)
  expect(selected.session.selected_character_id).toBe(owned[6].id)
  expect(selected.world.windows[owned[6].id]).toEqual(bootstrap.world.windows[owned[6].id])
  expect(selected.world.zones['nauvis:6:0']).toEqual(zone)
  expect(selected.world.windows[owned[0].id]).toBeUndefined()
})
