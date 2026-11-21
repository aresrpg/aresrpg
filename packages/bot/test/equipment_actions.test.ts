// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import { equip_refusal } from '@aresrpg/protocol/equipment'

import items from '../../../seed/content/items.json'
import { validate_equip_item, validate_consumable, equipment_projected } from '../src/equipment_actions.ts'
import type { GameplayContext } from '../src/gameplay_context.ts'
import { execute_gameplay_actions, parse_gameplay_action } from '../src/gameplay.ts'
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
test('an equip without an item empties the slot with one unequip, and an empty slot is refused', async () => {
  const worn = { ...character, equipment: [...character.equipment, { ...hat, slot: 'hat' }] }
  const payload = { character_id: character.id, slot: 'hat' as const }
  expect(parse_gameplay_action('equip_item', payload)).toEqual(payload)
  expect(() => parse_gameplay_action('equip_item', { character_id: character.id })).toThrow('invalid_gameplay_payload')
  expect(() => parse_gameplay_action('equip_item', { ...payload, item_id: null })).toThrow('invalid_gameplay_payload')
  const base = context_for('equip_item', payload)
  const context = { ...base, snapshot: { ...base.snapshot, characters: [worn] } }
  expect(validate_equip_item(context).input).toEqual({
    character_id: character.id,
    custody: { kiosk: character.kiosk, kiosk_cap: character.kiosk_cap! },
    to_equip: [],
    to_unequip: [{ slot: 'hat', item_id: hat.id }],
  })
  const calls: unknown[] = []
  await execute_gameplay_actions(context, {
    equip: async (input: unknown) => {
      calls[calls.length] = input
      return { digest: 'fixture' }
    },
  } as unknown as Parameters<typeof execute_gameplay_actions>[1])
  expect(calls).toEqual([validate_equip_item(context).input])
  // The certified effect: the slot is empty. A worn slot is not yet the projection.
  expect(equipment_projected(payload, worn)).toBe(false)
  expect(equipment_projected(payload, character)).toBe(true)
  expect(() => validate_equip_item(base)).toThrow('slot_empty')
  for (const busy of [{ custody: 'fight' as const }, { ambush: { fired: true } as never }])
    expect(() =>
      validate_equip_item({ ...context, snapshot: { ...context.snapshot, characters: [{ ...worn, ...busy }] } })
    ).toThrow('character_not_available')
  expect(() => validate_equip_item({ ...context, snapshot: { ...context.snapshot, characters: [] } })).toThrow(
    'character_authority_mismatch'
  )
})
test('an equip with an item still swaps the occupant out in the same change', () => {
  const second = { ...hat, id: item('fixture_hat', 1, 72).id }
  const worn = { ...character, equipment: [...character.equipment, { ...hat, slot: 'hat' }] }
  const base = context_for('equip_item', { character_id: character.id, item_id: second.id, slot: 'hat' })
  const context = {
    ...base,
    snapshot: {
      ...base.snapshot,
      characters: [worn],
      inventory: { ...base.snapshot.inventory, items: [second] },
    },
  }
  expect(validate_equip_item(context).input).toMatchObject({
    to_equip: [{ slot: 'hat', item_id: second.id }],
    to_unequip: [{ slot: 'hat', item_id: hat.id }],
  })
})
