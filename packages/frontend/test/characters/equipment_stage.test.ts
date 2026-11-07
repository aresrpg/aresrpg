// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import type { CharacterRow, ItemRow } from '@aresrpg/protocol'

import { equipment_commit_refusal, stage_equip } from '../../src/characters/equipment_stage.ts'

const item: ItemRow = {
  id: 'item',
  name: 'Hat',
  item_type: 'hat',
  category: 'hat',
  level: 1,
  amount: 1,
  kiosk: 'kiosk',
  version: '1',
}
const character = { id: 'hero', kiosk: 'kiosk', custody: 'kiosk', level: 10, equipment: [] } as unknown as CharacterRow
const equipment = stage_equip({}, item, 'hat')
const check = (
  current: CharacterRow | null = character,
  inventory: readonly ItemRow[] = [item],
  blocked: ReadonlySet<string> = new Set()
) => equipment_commit_refusal({ character, current, equipment, inventory, blocked })

test('immediate equipment refuses missing or changed custody before entering the SDK', () => {
  expect(check(null)).toBe('unavailable')
  expect(check({ ...character, custody: 'fight' })).toBe('unavailable')
  expect(check({ ...character, kiosk: 'another' })).toBe('unavailable')
  expect(check(character, [])).toBe('unavailable')
  expect(check(character, [{ ...item, kiosk: 'another' }])).toBe('unavailable')
})

test('immediate equipment revalidates the exact item revision and all encumbrances', () => {
  expect(check(character, [{ ...item, version: '2' }])).toBe('unavailable')
  expect(check(character, [item], new Set([item.id]))).toBe('item_listed')
  expect(check(character, [item], new Set([character.id]))).toBe('unavailable')
})

test('a changed loadout cannot silently replace gear that was never targeted', () => {
  expect(check({ ...character, equipment: Object.values(stage_equip({}, { ...item, id: 'new' }, 'hat')) })).toBe(
    'unavailable'
  )
})

test('current level and slot rules remain authoritative; a valid single change is accepted', () => {
  expect(check({ ...character, level: 0 })).toBe('level_too_low')
  expect(check()).toBeNull()
})
