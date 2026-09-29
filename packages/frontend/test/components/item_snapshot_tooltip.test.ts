// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import { item_stat_center } from '@aresrpg/immutable'

import { item_snapshot_detail } from '../../src/components/ItemSnapshotTooltip.tsx'

const pet = {
  id: 'pet',
  name: 'Pet',
  item_type: 'pet',
  category: 'pet',
  level: 1,
  stats: { strength: item_stat_center + 61, wisdom: item_stat_center - 11 },
}

test('linked pet stats use current power with the same signed rounding as equipment', () => {
  expect(item_snapshot_detail({ ...pet, pet_power: 30 }).stats?.min).toEqual({ strength: 30, wisdom: -5 })
  expect(item_snapshot_detail({ ...pet, pet_power: 60 }).stats?.min).toEqual({ strength: 61, wisdom: -11 })
  expect(item_snapshot_detail({ ...pet, pet_power: 0 }).stats?.min).toEqual({})
  expect(item_snapshot_detail(pet).stats?.min).toEqual({})
  expect(item_snapshot_detail({ ...pet, category: 'hat' }).stats?.min).toEqual({ strength: 61, wisdom: -11 })
})
