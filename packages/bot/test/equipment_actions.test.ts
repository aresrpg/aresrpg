// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import { equip_refusal } from '@aresrpg/protocol/equipment'

import items from '../../../seed/content/items.json'
import { validate_equip_item, validate_consumable, equipment_projected } from '../src/equipment_actions.ts'
import type { GameplayContext } from '../src/gameplay_context.ts'
import { select_owned_item } from '../src/behavior_items.ts'

import { profession_context, character, item } from './helpers/profession_fixture.ts'

const hat = { ...item('fixture_hat', 1, 70), category: 'hat' }
const heal = items.find((row) => row.consumable?.type === 'heal')!
const potion = { ...item(heal.item_type, 2, 71), category: 'consumable' }
const context_for = (kind: GameplayContext['command']['kind'], payload: Record<string, unknown>) => {
  const context = profession_context()
  return {
    ...context,
    command: { ...context.command, kind, payload },
    snapshot: { ...context.snapshot, inventory: { ...context.snapshot.inventory!, items: [hat, potion] } },
  }
}
test('general equipment preserves canonical slot, level, duplicate relic and encumbrance refusals', () => {
  const base = {
    item: hat,
    slot: 'hat' as const,
    character_level: character.level,
    equipment: {},
    listed_ids: new Set<string>(),
  }
  expect(equip_refusal(base)).toBeNull()
  expect(equip_refusal({ ...base, slot: 'boots' })).toBe('wrong_slot')
  expect(equip_refusal({ ...base, character_level: 0 })).toBe('level_too_low')
  expect(equip_refusal({ ...base, listed_ids: new Set([hat.id]) })).toBe('item_listed')
  const relic = { ...hat, category: 'relic' }
  expect(
    equip_refusal({ ...base, item: relic, slot: 'relic_2', equipment: { relic_1: { ...relic, slot: 'relic_1' } } })
  ).toBe('relic_duplicate')
})
test('dynamic equipment resolves current item identity and ordinary validator constructs atomic replacement', () => {
  const payload = { character_id: character.id, item_id: hat.id, slot: 'hat' as const }
  const context = context_for('equip_item', payload)
  const selected = select_owned_item(
    { type: 'equip_owned', character_id: character.id, item_type: hat.item_type, slot: 'hat', order: 'lowest_id' },
    context
  )
  expect(selected).toEqual({ status: 'action', action: { kind: 'equip_item', payload } })
  expect(validate_equip_item(context).input.to_equip).toEqual([{ item_id: hat.id, slot: 'hat' }])
  const equipped = { ...character, equipment: [...character.equipment, { ...hat, slot: 'hat' }] }
  expect(equipment_projected(payload, equipped)).toBe(true)
  expect(
    select_owned_item(
      { type: 'equip_owned', character_id: character.id, item_type: hat.item_type, slot: 'hat', order: 'lowest_id' },
      { ...context, snapshot: { ...context.snapshot, characters: [equipped] } }
    )
  ).toEqual({ status: 'success' })
})
test('one-unit consumable refuses batches and listed/traded source identities', () => {
  const context = context_for('use_consumable', { character_id: character.id, item_id: potion.id, amount: 1 })
  expect(validate_consumable(context).input).toMatchObject({ item_id: potion.id, amount: 1 })
  expect(() =>
    validate_consumable({
      ...context,
      command: { ...context.command, payload: { ...context.command.payload, amount: 3 } },
    })
  ).toThrow('invalid_gameplay_payload')
  for (const locked of [
    { listings: [{ id: potion.id }], trades: [] },
    { listings: [], trades: [{ caps_a: [{ object: potion.id }], caps_b: [] }] },
  ]) {
    expect(() =>
      validate_consumable({
        ...context,
        snapshot: { ...context.snapshot, inventory: { ...context.snapshot.inventory, ...locked } as never },
      })
    ).toThrow('item_unavailable')
  }
  expect(
    select_owned_item(
      {
        type: 'consume_owned',
        character_id: character.id,
        item_type: potion.item_type,
        amount: 1,
        order: 'largest_stack',
      },
      context
    )
  ).toMatchObject({ status: 'action', action: { kind: 'use_consumable' } })
})
test('consumable refusal covers rooted characters, unsupported effects and invalid quantities', () => {
  const context = context_for('use_consumable', { character_id: character.id, item_id: potion.id, amount: 1 })
  expect(() =>
    validate_consumable({
      ...context,
      snapshot: { ...context.snapshot, characters: [{ ...character, at_ms: context.now + 1 }] },
    })
  ).toThrow('character_not_available')
  expect(() =>
    validate_consumable({
      ...context,
      command: { ...context.command, payload: { ...context.command.payload, amount: 0 } },
    })
  ).toThrow()
  expect(() =>
    validate_consumable({
      ...context,
      snapshot: {
        ...context.snapshot,
        inventory: { ...context.snapshot.inventory, items: [{ ...potion, item_type: 'missing' }] },
      },
    })
  ).toThrow('unsupported_consumable')
})
