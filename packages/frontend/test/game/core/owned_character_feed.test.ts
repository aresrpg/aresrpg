// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import {
  clear_owned_character_positions,
  owned_character_position,
  owned_character_presence_rows,
  record_owned_character_position,
  reset_owned_character_positions_for_testing,
} from '../../../src/game/core/owned_character_feed.ts'

const character = (id: string, world: string, extra: Readonly<Record<string, unknown>> = {}) => ({
  id,
  name: id,
  classe: 'senshi',
  sex: 'male',
  level: 1,
  color_1: 0,
  color_2: 0,
  color_3: 0,
  world,
  checkpoint_world: world,
  x: 10,
  z: 12,
  custody: 'kiosk',
  equipment: [],
  ...extra,
})

test('owned presence uses live positions, falls back to chain anchors, and stays world scoped', () => {
  reset_owned_character_positions_for_testing()
  record_owned_character_position('0xb', 'nauvis', { checkpoint: 'nauvis:10:12:0', x: 5, y: 2, z: 6 })
  expect(owned_character_position('0xb', 'nauvis', 'nauvis:10:12:0')).toMatchObject({ x: 5, y: 2, z: 6 })

  const rows = owned_character_presence_rows(
    [
      character('0xb', 'nauvis'),
      character('0xc', 'nauvis'),
      character('0xd', 'yakutia'),
      character('0xe', 'nauvis', { custody: 'fight', active_fight: { id: '0xf', seat: 1 } }),
    ] as never,
    '0xowner',
    'nauvis',
    () => 42
  )

  expect(Object.keys(rows)).toEqual(['0xb', '0xc'])
  expect(rows['0xb']).toMatchObject({ x: 5, y: 2, z: 6 })
  expect(rows['0xc']).toMatchObject({ x: 10, y: 42, z: 12 })

  clear_owned_character_positions()
  expect(owned_character_position('0xb', 'nauvis', 'nauvis:10:12:0')).toBeNull()
})

test('recall makes a stale live pose ineligible for selection and other owned-character rendering', async () => {
  const { selected_position } = await import('../../../src/modules/engine_selection.ts')
  reset_owned_character_positions_for_testing()
  const before = character('0xb', 'nauvis', { x: 53_196, z: 50_000, at_ms: 1 })
  record_owned_character_position('0xb', 'nauvis', { checkpoint: 'nauvis:53196:50000:1', x: 53_197, y: 4, z: 50_000 })
  const recalled = { ...before, x: 50_000, z: 50_000, at_ms: 2 }
  const state = (row: unknown) => ({ session: { characters: [row], selected_character_id: '0xb' } }) as never
  expect(selected_position(state(before))).toEqual({ x: 3197, z: 0 })
  expect(selected_position(state(recalled))).toEqual({ x: 0, z: 0 })
  expect(owned_character_presence_rows([recalled] as never, '0xowner', 'nauvis', () => 7)['0xb']).toMatchObject({
    x: 50_000,
    y: 7,
    z: 50_000,
  })
  // The same checkpoint may arrive redundantly without erasing later local walking.
  record_owned_character_position('0xb', 'nauvis', { checkpoint: 'nauvis:50000:50000:2', x: 50_002, y: 7, z: 50_000 })
  expect(selected_position(state({ ...recalled }))).toEqual({ x: 2, z: 0 })
})
