// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { cosmetic_slots, equipment_slot_accepts, worn_appearance } from '../src/equipment.ts'
import { is_cosmetic_category, is_item_category, item_is_stackable } from '../src/item.ts'

test('cosmetic categories equip only in their own unique slots', () => {
  for (const slot of cosmetic_slots) {
    expect(is_item_category(slot)).toBe(true)
    expect(is_cosmetic_category(slot)).toBe(true)
    expect(item_is_stackable(slot)).toBe(false)
    expect(equipment_slot_accepts(slot, slot)).toBe(true)
    expect(equipment_slot_accepts(slot, 'hat')).toBe(false)
    expect(equipment_slot_accepts(slot, 'cloak')).toBe(false)
    expect(equipment_slot_accepts('hat', slot)).toBe(false)
    expect(equipment_slot_accepts('cloak', slot)).toBe(false)
  }
  expect(equipment_slot_accepts('cosmetic_hat', 'cosmetic_cloak')).toBe(false)
  expect(equipment_slot_accepts('cosmetic_cloak', 'cosmetic_hat')).toBe(false)
})

test('cosmetics override appearance independently and removal reveals current equipment', () => {
  const equipped = Object.freeze({ hat: 'stat_hat', cloak: 'stat_cloak', cosmetic_hat: 'pepe', cosmetic_cloak: 'cape' })
  expect(worn_appearance(equipped)).toEqual({ hat: 'pepe', cloak: 'cape' })
  expect(worn_appearance({ ...equipped, hat: 'new_hat', cosmetic_hat: null })).toEqual({
    hat: 'new_hat',
    cloak: 'cape',
  })
  expect(worn_appearance({ ...equipped, cosmetic_cloak: null })).toEqual({ hat: 'pepe', cloak: 'stat_cloak' })
  expect(worn_appearance({ cosmetic_hat: 'pepe' })).toEqual({ hat: 'pepe', cloak: null })
  expect(worn_appearance({})).toEqual({ hat: null, cloak: null })
})
