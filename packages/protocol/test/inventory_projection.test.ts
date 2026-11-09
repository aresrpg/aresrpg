// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import type { ItemRow, TradeRow, TradeCapRow } from '../src/packets.ts'
import { fold_inventory, fold_item_packet, reconcile_trade_row } from '../src/inventory_projection.ts'

const item = (version: string, id = 'item'): ItemRow => ({ id, version, amount: Number(version) }) as ItemRow

test('inventory snapshots preserve newer rows, remove absent rows and obey departure versions', () => {
  const current = { inventory: [item('8'), item('3', 'absent')], removed_item_versions: { removed: '7' } }
  expect(fold_inventory(current, [item('5'), item('7', 'removed')])).toEqual([item('8')])
  expect(fold_inventory(current, [item('8', 'removed')])).toEqual([item('8', 'removed')])
})

test('incremental inventory ignores older departures and updates, including replay after resurrection', () => {
  const current = { inventory: [item('8')], removed_item_versions: {} }
  expect(fold_item_packet(current, { type: 'packet/item_removed', item: 'item', version: '7' })).toBe(current)
  expect(fold_item_packet(current, { type: 'packet/item_updated', item: item('7') }).inventory).toEqual([item('8')])
  const removed = fold_item_packet(current, { type: 'packet/item_removed', item: 'item', version: '8' })
  expect(fold_item_packet(removed, { type: 'packet/item_updated', item: item('8') })).toBe(removed)
  expect(fold_item_packet(removed, { type: 'packet/item_removed', item: 'item', version: '7' })).toBe(removed)
  const restored = fold_item_packet(removed, { type: 'packet/item_updated', item: item('9') })
  expect(fold_item_packet(restored, { type: 'packet/item_removed', item: 'item', version: '8' })).toBe(restored)
})

const trade = (values: Partial<TradeRow> = {}): TradeRow =>
  ({
    id: 'trade',
    a: 'alice',
    b: 'bob',
    offer_revision: 2,
    phase: 'settling',
    caps_a: [],
    caps_b: [],
    sui_a: '0',
    sui_b: '0',
    kares_a: '0',
    kares_b: '0',
    accept_a: false,
    accept_b: false,
    ...values,
  }) as TradeRow

test('terminal trade replay cannot restore caps or either currency and acceptance accumulates', () => {
  const current = trade()
  const stale = trade({ caps_a: [{ object: 'spent' } as TradeCapRow], sui_a: '100', kares_b: '200' })
  expect(reconcile_trade_row(current, stale)).toEqual(current)
  expect(
    reconcile_trade_row(trade({ phase: 'negotiating', accept_a: true }), trade({ phase: 'negotiating' })).accept_a
  ).toBe(true)
})
