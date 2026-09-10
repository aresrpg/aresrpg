// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'
import type { CharacterRow, ItemRow } from '@aresrpg/protocol'

import { consumable_plan } from '../../src/characters/consumable_plan.ts'
import { character_max_hp } from '../../src/game/character_stats.ts'

const now = 100_000
const character = { level: 1, vitality: 0, kiosk: 'kiosk', hp: '1', hp_ms: now } as CharacterRow
const bread = { id: 'bread', item_type: 'barley_bread', category: 'consumable', amount: 1, kiosk: 'kiosk' } as ItemRow

test('full healing rounds up, counts mergeable fragments, and ignores unavailable stock', () => {
  const inventory = [
    bread,
    { ...bread, id: 'fragment', amount: 2 },
    { ...bread, id: 'listed', amount: 50 },
    { ...bread, id: 'other', kiosk: 'other', amount: 50 },
  ]
  const plan = consumable_plan(character, bread, inventory, new Set(['listed']), now)
  expect(plan).toMatchObject({ needed: 3, available: 3, heal: 25, merge_sources: ['fragment'] })
  expect(consumable_plan(character, bread, inventory, new Set(['bread']), now).available).toBe(0)
  expect(consumable_plan(character, bread, [], new Set(), now).available).toBe(0)
})

test('passive regeneration reduces the needed batch and full HP consumes nothing', () => {
  expect(consumable_plan(character, bread, [bread], new Set(), now + 5_000).needed).toBe(2)
  expect(
    consumable_plan({ ...character, hp: String(character_max_hp(character)) }, bread, [bread], new Set(), now).needed
  ).toBe(0)
  expect(consumable_plan(character, bread, [bread], new Set(), now + 100_000).needed).toBe(0)
})

test('a stale displayed stack uses its current amount and reports insufficient stock honestly', () => {
  expect(consumable_plan(character, { ...bread, amount: 100 }, [bread], new Set(), now)).toMatchObject({
    needed: 3,
    available: 1,
  })
})
