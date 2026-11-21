// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import type { Receipt } from '@aresrpg/sdk/cache'

import { action_projected } from '../src/action_reconciliation.ts'
import type { Command } from '../src/control.ts'

import { profession_context, character, item, resource } from './helpers/profession_fixture.ts'

test('settlement waits for receipt-proven loot inventory; certified zero-loot settlement also completes', () => {
  const context = profession_context()
  const loot = { ...item(resource.item_type, 2, 99), version: '9' }
  const command = {
    ...context.command,
    kind: 'fight_settle' as const,
    status: 'completed' as const,
    payload: { character_id: character.id, fight: 'old' },
    result: { digest: 'receipt' },
    action_baseline: { checkpoint_ms: 0 },
  }
  const receipt = {
    Transaction: {
      digest: 'receipt',
      effects: { lamportVersion: '9', changedObjects: [{ objectId: loot.id, outputVersion: '9' }] },
      objectTypes: { [loot.id]: 'fixture::item::Item' },
      events: [{ type: 'fixture::item::AmountChanged', json: { item: loot.id, amount: 2 } }],
    },
  }
  expect(action_projected(command, receipt, context)).toBe(false)
  const projected = (version: string) => ({
    ...context,
    snapshot: {
      ...context.snapshot,
      inventory: {
        ...context.snapshot.inventory!,
        items: [...context.snapshot.inventory!.items, { ...loot, version }],
      },
    },
  })
  expect(action_projected(command, receipt, projected('8'))).toBe(false)
  expect(action_projected(command, receipt, projected('9'))).toBe(true)
  const no_loot = {
    Transaction: {
      digest: 'receipt',
      effects: { lamportVersion: '9', changedObjects: [] },
      objectTypes: {},
      events: [],
    },
  }
  expect(action_projected(command, no_loot, context)).toBe(true)
})

// A settled hero creation, withdrawal or collection names no hero. Before this rule each one left the
// wallet waiting for a resync that never came, so the bot could not sign again.
const id = (value: number): string => `0x${value.toString(16).padStart(64, '0')}`
const settled_receipt = (events: unknown[] = []): Receipt => ({
  Transaction: {
    digest: 'settled',
    effects: { status: { success: true }, lamportVersion: '9', changedObjects: [] },
    events,
  },
})
const settled = (kind: Command['kind'], payload: Record<string, unknown>): Command => ({
  ...profession_context().command,
  kind,
  payload,
  status: 'completed',
  result: { digest: 'settled' },
  action_baseline: { checkpoint_ms: 0 },
})
test('wallet-level commands reconcile without a hero', () => {
  const context = profession_context()
  const listing = { id: id(40), kiosk: character.kiosk } as never
  const listed = {
    ...context,
    snapshot: { ...context.snapshot, inventory: { ...context.snapshot.inventory!, listings: [listing] } },
  }
  expect(action_projected(settled('market_collect', {}), settled_receipt(), context)).toBe(true)
  const delist = settled('market_delist', { item_id: id(40), kiosk: character.kiosk })
  expect(action_projected(delist, settled_receipt(), listed)).toBe(false)
  expect(action_projected(delist, settled_receipt(), context)).toBe(true)
  const created = settled_receipt([{ type: `${id(1)}::character::CharacterCreated`, json: { character: id(77) } }])
  const create = settled('create_character', { name: 'newhero' })
  expect(action_projected(create, created, context)).toBe(false)
  const born = {
    ...context,
    snapshot: { ...context.snapshot, characters: [character, { ...character, id: id(77) }] },
  }
  expect(action_projected(create, created, born)).toBe(true)
})
