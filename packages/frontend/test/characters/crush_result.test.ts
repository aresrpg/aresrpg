// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'
import type { ItemRow } from '@aresrpg/protocol'

import { crush_results, projected_crush_items, type PendingCrushResult } from '../../src/crush_result.ts'

const rune = (id: string, item_type: string, amount: number): ItemRow => ({
  id,
  item_type,
  amount,
  name: item_type,
  category: 'rune',
  level: 1,
  kiosk: '0xkiosk',
})

test('a crush result waits until every touched rune stack carries its projected increase', () => {
  const pending: PendingCrushResult = {
    digest: 'tx',
    item_ids: ['0xexisting', '0xnew'],
    previous_amounts: { '0xexisting': 4 },
  }

  expect(projected_crush_items(pending, [rune('0xexisting', 'ba_fo', 4)])).toBeNull()
  expect(projected_crush_items(pending, [rune('0xexisting', 'ba_fo', 7)])).toBeNull()
  expect(projected_crush_items(pending, [rune('0xexisting', 'ba_fo', 7), rune('0xnew', 'pa_fo', 2)])).toEqual([
    rune('0xexisting', 'ba_fo', 7),
    rune('0xnew', 'pa_fo', 2),
  ])
})

test('a receipt touching no rune stacks is an immediate empty crush result', () => {
  expect(projected_crush_items({ digest: 'tx', item_ids: [], previous_amounts: {} }, [])).toEqual([])
})

test('crush presentation stays one lifecycle from item animation through result or failure', () => {
  const seen: string[] = []
  const unsubscribe = crush_results.subscribe(({ type }) => void seen.push(type))
  crush_results.start(rune('0xhat', 'hat', 1))
  crush_results.publish({ digest: 'tx', items: [rune('0xrune', 'rune_vitality_pa', 1)] })
  crush_results.fail(new Error('offline'))
  unsubscribe()

  expect(seen).toEqual(['crushing', 'result', 'failed'])
})
