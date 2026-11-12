// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import type { Receipt } from '@aresrpg/sdk/cache'

import { empty_lane, type Command } from '../src/control.ts'
import { lane_key_for } from '../src/command_admission.ts'
import { empty_inventory } from '../src/actor_inventory.ts'
import { fold_actor_market } from '../src/actor_market.ts'
import { settled_market_receipts, restore_market_receipts } from '../src/market_recovery.ts'

import { fixture_bot, memory_store, put } from './helpers/control_fixture.ts'
import { profession_context, resource } from './helpers/profession_fixture.ts'

const proof = (version: string) => {
  const digest = `receipt-${version}`
  const command: Command = {
    ...profession_context().command,
    id: `command-${version}`,
    lane_key: lane_key_for(fixture_bot),
    kind: 'market_buy',
    status: 'completed',
    payload: { item_id: 'item', seller_kiosk: 'seller' },
    result: { digest },
  }
  const receipt: Receipt = {
    Transaction: {
      digest,
      effects: { status: { success: true }, lamportVersion: version, changedObjects: [] },
      objectTypes: {},
      events: [],
    },
  }
  return { command, receipt, digest }
}
const retained = async () => {
  const store = memory_store()
  const { command, receipt, digest } = proof('9')
  const base = empty_lane(fixture_bot)
  const lane = { ...base, catalogue_receipts: settled_market_receipts(base, command, receipt) }
  await put(store, `command:${command.id}`, command)
  await put(store, `receipt:${digest}`, { digest, receipt })
  return { store, lane, command, receipt, digest }
}
test('restart restores certified catalogue floor before accepting stale pages', async () => {
  const { store, lane } = await retained()
  const restored = await restore_market_receipts(store, lane, empty_inventory())
  expect(restored.catalogues.seller?.version).toBe('9')
  const stale = fold_actor_market(restored, {
    type: 'packet/market_slice',
    observation: { kind: 'offers', category: 'resource', item_type: resource.item_type, request: 1 },
    listings: [],
    next_cursor: null,
    kiosk_versions: { seller: '8' },
  })
  expect(stale).toBe(restored)
  expect(await restore_market_receipts(store, lane, restored)).toEqual(restored)
})
test('receipt pointer follows certified version rather than settlement arrival order', () => {
  const base = empty_lane(fixture_bot)
  const newest = proof('10')
  const older = proof('9')
  const pointers = settled_market_receipts(base, newest.command, newest.receipt)
  const lane = { ...base, catalogue_receipts: pointers }
  expect(settled_market_receipts(lane, older.command, older.receipt)).toBe(pointers)
  expect(settled_market_receipts(lane, newest.command, newest.receipt)).toBe(pointers)
})
for (const corruption of ['lane', 'digest', 'version', 'kiosk', 'missing'] as const) {
  test(`restart rejects ${corruption} proof corruption`, async () => {
    const { store, lane, command, receipt, digest } = await retained()
    if (corruption === 'lane') await put(store, `command:${command.id}`, { ...command, lane_key: 'other' })
    if (corruption === 'digest') await put(store, `receipt:${digest}`, { digest: 'other', receipt })
    const pointer = lane.catalogue_receipts!.seller!
    const pointers = {
      seller: {
        ...pointer,
        ...(corruption === 'version' ? { version: '10' } : {}),
        ...(corruption === 'missing' ? { command_id: 'missing' } : {}),
      },
    }
    const bad = { ...lane, catalogue_receipts: corruption === 'kiosk' ? { other: pointer } : pointers }
    await expect(restore_market_receipts(store, bad, empty_inventory())).rejects.toThrow('market_receipt_proof_invalid')
  })
}
