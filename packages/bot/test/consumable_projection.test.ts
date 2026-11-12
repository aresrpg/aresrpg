// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import { action_projected } from '../src/action_reconciliation.ts'
import { consumable_noop } from '../src/consumable_projection.ts'
import { parse_gameplay_action } from '../src/gameplay.ts'
import { parse_behavior_script } from '../src/behavior_script.ts'

import { profession_context, character, item } from './helpers/profession_fixture.ts'

test('certified consumption cannot complete from inventory alone or an equal HP timestamp', () => {
  const context = profession_context()
  const consumed = { ...item('potion', 1, 88), version: '9' }
  const receipt = {
    Transaction: {
      digest: 'receipt',
      effects: { lamportVersion: '9', changedObjects: [{ objectId: consumed.id, outputVersion: '9' }] },
      objectTypes: { [consumed.id]: 'fixture::item::Item' },
      events: [{ type: 'fixture::item::AmountChanged', json: { item: consumed.id, amount: 1 } }],
    },
  }
  const command = {
    ...context.command,
    kind: 'use_consumable' as const,
    status: 'completed' as const,
    payload: { character_id: character.id, item_id: consumed.id, amount: 1 },
    result: { digest: 'receipt' },
    action_baseline: {
      checkpoint_ms: 0,
      consumable: { effect: 'heal', hp_ms: 10, checkpoint_ms: 0, available_points: 0, available_spell_points: 0 },
    },
  }
  const projected = {
    ...context,
    snapshot: {
      ...context.snapshot,
      inventory: { ...context.snapshot.inventory!, items: [consumed] },
      characters: [{ ...character, hp_ms: 10 }],
    },
  }
  expect(action_projected(command, receipt, projected)).toBe(false)
  expect(
    action_projected(command, receipt, {
      ...projected,
      snapshot: { ...projected.snapshot, characters: [{ ...character, hp_ms: 11 }] },
    })
  ).toBe(true)
  expect(
    action_projected(command, receipt, {
      ...projected,
      snapshot: {
        ...projected.snapshot,
        characters: [{ ...character, hp_ms: 11 }],
        inventory: { ...projected.snapshot.inventory, items: [{ ...consumed, version: '8' }] },
      },
    })
  ).toBe(false)
})
test('one-unit contract is enforced by both gameplay and authored behavior schema', () => {
  const action = {
    type: 'consume_owned',
    character_id: character.id,
    item_type: 'potion',
    amount: 1,
    order: 'largest_stack',
  }
  const script = { version: '1', objective: { title: 'Use authored item' }, tree: { type: 'action', action } }
  expect(() => parse_behavior_script(script)).not.toThrow()
  expect(() =>
    parse_behavior_script({ ...script, tree: { type: 'action', action: { ...action, amount: 2 } } })
  ).toThrow()
  expect(() =>
    parse_gameplay_action('use_consumable', { character_id: character.id, item_id: item('potion', 1).id, amount: 2 })
  ).toThrow()
  expect(consumable_noop('reset_stats', character)).toBe(true)
  expect(consumable_noop('reset_spells', character)).toBe(true)
})
