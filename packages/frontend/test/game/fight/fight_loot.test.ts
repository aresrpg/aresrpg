import { expect, test } from 'bun:test'
import type { ItemRow } from '@aresrpg/protocol'

import { fight_loot_inventory } from '../../../src/game/fight/FightLoot.tsx'

const item = (id: string, item_type = 'gravebrand'): ItemRow => ({
  id,
  item_type,
  name: item_type,
  category: 'sword',
  level: 1,
  amount: 1,
  kiosk: 'kiosk',
})
const loot = { item_type: 'gravebrand', qty: 2 }

test('complete received copies never wait for another loot type in the settlement', () => {
  const a = item('a'),
    b = item('b')
  expect(fight_loot_inventory(loot, ['a', 'b', 'unrelated'], [item('old'), a, b], {})).toEqual({
    received: [a, b],
    missing: false,
    pending: false,
  })
})

test('an exact missing copy waits for its inventory projection without substituting older gear', () => {
  const a = item('a')
  expect(fight_loot_inventory(loot, ['a', 'b'], [item('old'), a], {})).toEqual({
    received: [a],
    missing: true,
    pending: true,
  })
})

test('removed copies and fully projected unrelated items are unavailable, never pending forever', () => {
  const a = item('a')
  expect(fight_loot_inventory(loot, ['a', 'b'], [a], { b: '5' })).toEqual({
    received: [a],
    missing: true,
    pending: false,
  })
  expect(fight_loot_inventory(loot, ['resin'], [item('resin', 'tree_resin')], {})).toEqual({
    received: [],
    missing: true,
    pending: false,
  })
})
