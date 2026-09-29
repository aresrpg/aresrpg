// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import { item_stat_center } from '@aresrpg/immutable'
import type { ItemRow } from '@aresrpg/protocol'

import { equipment_comparison } from '../../src/characters/equipment_comparison.ts'
import { stage_equip } from '../../src/characters/equipment_stage.ts'

const item = (id: string, category: string, stats: Record<string, number> = {}): ItemRow => ({
  id,
  category,
  name: id,
  item_type: id,
  level: 1,
  amount: 1,
  kiosk: 'kiosk',
  stats: Object.fromEntries(Object.entries(stats).map(([stat, value]) => [stat, item_stat_center + value])),
})
test('replacement shows gains, lost stats, and improvements to negative rolls', () => {
  const old = item('old', 'hat', { vitality: 20, raw_damage: 8, intelligence: -10 })
  const next = item('next', 'hat', { vitality: 50, intelligence: -5 })
  expect(equipment_comparison(next, stage_equip({}, old, 'hat'))?.rows).toEqual([
    { stat: 'vitality', delta: 30 },
    { stat: 'intelligence', delta: 5 },
    { stat: 'raw_damage', delta: -8 },
  ])
})
test('rings use the same free-slot and replacement rules as Equip', () => {
  const first = item('first', 'ring', { vitality: 10 })
  const second = item('second', 'ring', { vitality: 100 })
  const next = item('next', 'ring', { vitality: 20 })
  const single = stage_equip({}, first, 'left_ring')
  expect(equipment_comparison(next, single)).toBeNull()
  expect(equipment_comparison(next, stage_equip(single, second, 'right_ring'))?.previous.id).toBe('first')
  expect(equipment_comparison(first, single)).toBeNull()
  expect(equipment_comparison(second, stage_equip(single, second, 'right_ring'))).toBeNull()
  expect(equipment_comparison(item('resource', 'resource'), single)).toBeNull()
})
test('pet comparison uses current power rather than full authored bonuses', () => {
  const old = { ...item('old', 'pet', { vitality: 60 }), pet_power: 30 }
  const next = { ...item('next', 'pet', { vitality: 90 }), pet_power: 10 }
  expect(equipment_comparison(next, stage_equip({}, old, 'pet'))?.rows).toEqual([{ stat: 'vitality', delta: -15 }])
})
