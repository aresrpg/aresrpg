// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import { item_stat_center, stat_names, type StatName } from '@aresrpg/immutable'
import type { CharacterRow, ItemRow } from '@aresrpg/protocol'
import { basic_build } from '@aresrpg/protocol/strategies'

import seed_items from '../../../seed/content/items.json'
import { id } from '../../sdk/test/helpers/transport.ts'
import { select_owned_item, type EquipOwnedAction } from '../src/behavior_items.ts'
import { validate_gameplay, type GameplayContext } from '../src/gameplay.ts'

import { character, profession_context } from './helpers/profession_fixture.ts'

const priority = basic_build('yogan').equipment as readonly StatName[]
const best = (slot: EquipOwnedAction['slot'] = 'hat', stats = priority): EquipOwnedAction => ({
  type: 'equip_owned',
  character_id: character.id,
  slot,
  order: 'best_stats',
  stats,
})
/** A real seed item as the bot observes it once owned: its best authored roll, or the given bonuses. */
const owned = (item_type: string, number: number, bonuses?: Partial<Record<StatName, number>>): ItemRow => {
  const seed = seed_items.find((row) => row.item_type === item_type)!
  const rolled = { ...(seed.stats!.max as Record<StatName, number>), ...bonuses }
  return {
    id: id(number),
    item_type,
    name: seed.name,
    category: seed.category,
    level: seed.level,
    amount: 1,
    kiosk: character.kiosk,
    version: '1',
    stats: Object.fromEntries(stat_names.map((stat) => [stat, item_stat_center + rolled[stat]])),
  }
}
const context_of = (items: readonly ItemRow[], hero: Partial<CharacterRow> = {}, bag: object = {}): GameplayContext => {
  const base = profession_context()
  const inventory = { ...base.snapshot.inventory!, items, ...bag }
  return { ...base, snapshot: { ...base.snapshot, characters: [{ ...character, level: 12, ...hero }], inventory } }
}
const chosen = (context: GameplayContext, action = best()) => {
  const selection = select_owned_item(action, context)
  if (selection.status !== 'action') return selection
  // Every choice is one the bot's own equip validator accepts as a command.
  validate_gameplay({ ...context, command: { ...context.command, ...selection.action } })
  return selection.action.payload.item_id
}
const NOTHING = { status: 'failure', code: 'item_unavailable' } as const

// Real seed hats: intelligence 20, vitality 60, wisdom 20, strength 20, then intelligence 40 with strength.
const [smart, sturdy, wise, strong, white] = [
  owned('lorito_hat__intelligence', 41),
  owned('lorito_hat__vitality', 42),
  owned('lorito_hat__wisdom', 43),
  owned('lorito_hat__strength', 44),
  owned('coiffe_fuwa__white', 45),
]

test('the best owned item of a slot is ranked by the authored stats, intelligence first', () => {
  expect(chosen(context_of([strong, wise, sturdy, smart, white]))).toBe(white.id)
  // One point of intelligence outweighs any amount of a later stat.
  expect(chosen(context_of([wise, sturdy, owned('lorito_hat__intelligence', 46, { intelligence: 1 })]))).toBe(id(46))
  expect(chosen(context_of([strong, wise, sturdy]))).toBe(sturdy.id)
  expect(chosen(context_of([strong, wise]))).toBe(wise.id)
  // Equal on the first stat: the next listed stat decides, then the lowest id.
  const golden = owned('lorito_hat__golden', 47, { intelligence: 20, vitality: 30 })
  expect(chosen(context_of([smart, golden], { level: 16 }))).toBe(golden.id)
  expect(chosen(context_of([owned('lorito_hat__intelligence', 49), smart]))).toBe(smart.id)
  // An item with none of the listed stats, or one that lowers the first, never beats an empty slot.
  expect(chosen(context_of([strong]))).toEqual(NOTHING)
  expect(chosen(context_of([owned('drakar', 48)], { level: 30 }))).toEqual(NOTHING)
})

test('the existing equip refusals apply: level, slot, a listed item and an uncertified one', () => {
  const golden = owned('lorito_hat__golden', 47)
  // Level 16 is required: at level 12 the next best hat is worn instead.
  expect(chosen(context_of([golden, smart]))).toBe(smart.id)
  expect(chosen(context_of([golden, smart], { level: 16 }))).toBe(golden.id)
  const locket = owned('emberweb_locket', 50)
  expect(chosen(context_of([locket]))).toEqual(NOTHING)
  expect(chosen(context_of([locket]), best('amulet'))).toBe(locket.id)
  const listings = [{ id: white.id }]
  expect(chosen(context_of([white, smart], {}, { listings }))).toBe(smart.id)
  expect(chosen(context_of([{ ...white, version: undefined }, smart]))).toBe(smart.id)
  expect(chosen(context_of([{ ...white, kiosk: id(90) }, smart]))).toBe(smart.id)
})

test('a worn item is replaced only by a strictly better one: never a downgrade, never a swap of equals', () => {
  const wearing = (item: ItemRow) => ({ equipment: [{ ...item, slot: 'hat' }] })
  expect(chosen(context_of([white, sturdy], wearing(smart)))).toBe(white.id)
  expect(chosen(context_of([smart, sturdy, wise, strong], wearing(white)))).toEqual(NOTHING)
  expect(chosen(context_of([owned('lorito_hat__intelligence', 49)], wearing(smart)))).toEqual(NOTHING)
  // The same hat already worn in the slot is success for an exact order and nothing better for a ranked one.
  expect(chosen(context_of([], wearing(smart)))).toEqual(NOTHING)
})

test('a ranked order never blocks its tree: a busy hero and an empty priority wear nothing', () => {
  const stocked = context_of([white])
  for (const busy of [
    { custody: 'fight' as const, active_fight: { id: id(70), seat: 0 } },
    { ambush: { protector: 'p', x: 0, z: 0, scalar: 0, board_seed: '1', hp: '1' } },
  ])
    expect(chosen(context_of([white], busy))).toEqual(NOTHING)
  // Bound without a build the leaf lists nothing: it fails before reading any inventory.
  const unread = { ...stocked, snapshot: { ...stocked.snapshot, inventory: undefined } }
  expect(select_owned_item(best('hat', []), unread)).toEqual(NOTHING)
  expect(select_owned_item(best(), unread)).toEqual({ status: 'waiting', code: 'inventory_unavailable' })
  expect(chosen(stocked, best('hat', []))).toEqual(NOTHING)
})
