import { expect, test } from 'bun:test'

import { adventure_inventory, adventure_character_row, ADVENTURE_INVENTORY } from '../../src/adventure/projection.ts'
import { adventure_character } from '../../src/adventure/character.ts'
import { ADVENTURE_ITEMS } from '../../src/adventure/content.ts'

test('local inventory fixtures accept items without stat rolls and preserve supplied equipment identities', () => {
  const items = adventure_inventory([{ ...ADVENTURE_ITEMS[0]!, item_type: 'workshop_hat', stats: undefined }])
  expect(items[0]!.stats).toEqual({})
  const character = { ...adventure_character(200), loadout: { hat: 'workshop_hat' } }
  expect(adventure_character_row(character, items).equipment[0]!.item_type).toBe('workshop_hat')
  expect(ADVENTURE_INVENTORY.some(({ item_type }) => item_type === 'workshop_hat')).toBeFalse()
})
