// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'
import { item_stat_center, worn_appearance } from '@aresrpg/immutable'
import type { ItemRow } from '@aresrpg/protocol'

import {
  equipment_change_set,
  natural_slot_for,
  stage_equip,
  stage_unequip,
} from '../../src/characters/equipment_stage.ts'
import { fold_equipment_stats } from '../../src/game/character_stats.ts'

const item = (category: string, stats?: Record<string, number>): ItemRow => ({
  id: `0x${category}`,
  name: category,
  item_type: category,
  category,
  level: 1,
  amount: 1,
  kiosk: '0xkiosk',
  ...(stats ? { stats } : {}),
})

test('staging cosmetics preserves normal equipment, stat totals, and the existing transaction diff', () => {
  const hat = item('hat', { vitality: item_stat_center + 10 })
  const cloak = item('cloak', { vitality: item_stat_center + 20 })
  const cosmetic_hat = item('cosmetic_hat')
  const cosmetic_cloak = item('cosmetic_cloak')
  const real = stage_equip(stage_equip({}, hat, 'hat'), cloak, 'cloak')
  expect(natural_slot_for(cosmetic_hat, real)).toBe('cosmetic_hat')
  expect(natural_slot_for(cosmetic_cloak, real)).toBe('cosmetic_cloak')
  const staged = stage_equip(stage_equip(real, cosmetic_hat, 'cosmetic_hat'), cosmetic_cloak, 'cosmetic_cloak')
  expect(fold_equipment_stats(Object.values(staged))).toEqual(fold_equipment_stats(Object.values(real)))
  expect(equipment_change_set(staged, real)).toEqual({
    to_equip: [
      { slot: 'cosmetic_hat', item_id: cosmetic_hat.id },
      { slot: 'cosmetic_cloak', item_id: cosmetic_cloak.id },
    ],
    to_unequip: [],
  })
  const unmasked = stage_unequip(staged, 'cosmetic_hat')
  expect(
    worn_appearance(Object.fromEntries(Object.entries(unmasked).map(([slot, row]) => [slot, row.item_type])))
  ).toEqual({ hat: 'hat', cloak: 'cosmetic_cloak' })
  expect(equipment_change_set(unmasked, staged)).toEqual({
    to_equip: [],
    to_unequip: [{ slot: 'cosmetic_hat', item_id: cosmetic_hat.id }],
  })
})
