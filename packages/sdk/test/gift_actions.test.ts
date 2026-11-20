// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import { Transaction } from '@mysten/sui/transactions'

import { advance_gift } from '../src/gift_actions.ts'
import { verified_gift_package, type GiftPolicy } from '../src/gift_provenance.ts'
import type { Receipt } from '../src/cache.ts'

import fixture from './fixtures/basecamp_gift.mainnet.json'

// Captured mainnet object 0x5acf…6d5a v1034707540 and tx 5SCHg…GGuc, 2026-10-07 (fixture provenance).
const card = String(fixture.redeem.Transaction.events[0]!.json!.giftcard)
const { sender } = fixture.redeem.Transaction.transaction
const policy: GiftPolicy = verified_gift_package(
  {
    ...fixture.policy,
    pins: { ...fixture.policy.pins, network: 'mainnet' },
    giftcards: new Set([card]),
    reward_templates: new Set(),
  },
  fixture.package_lineage.id,
  fixture.package_lineage.original
)
const signed = () => Transaction.from(fixture.redeem.Transaction.bcs).getData()
const receipt = () => structuredClone(fixture.redeem) as unknown as Receipt

test('the player-signed redemption receipt proves the crate without rereading the chain', () => {
  const status = advance_gift(
    policy,
    sender,
    'redeem',
    { stage: 'voucher', proof: { giftcard: card } },
    signed(),
    receipt()
  )
  expect(status).toMatchObject({
    stage: 'crate',
    proof: { giftcard: card, redeem: fixture.redeem.Transaction.digest },
    crate: '0x2458af09ad8778e1f6990c90c3d57b9a406f2efe880b3b5025590d3a9306b577',
  })
})

test('a receipt from another account never advances this gift', () => {
  const other = `0x${'9'.repeat(64)}`
  expect(() =>
    advance_gift(policy, other, 'redeem', { stage: 'voucher', proof: { giftcard: card } }, signed(), receipt())
  ).toThrow('Gift ineligible')
})
