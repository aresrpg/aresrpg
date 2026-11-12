// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import { action_projected } from '../src/action_reconciliation.ts'

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
