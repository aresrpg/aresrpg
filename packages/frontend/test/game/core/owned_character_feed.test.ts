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
  record_owned_character_position('0xb', 'nauvis', { x: 5, y: 2, z: 6 })
  expect(owned_character_position('0xb', 'nauvis')).toMatchObject({ x: 5, y: 2, z: 6 })

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
  expect(owned_character_position('0xb', 'nauvis')).toBeNull()
})
