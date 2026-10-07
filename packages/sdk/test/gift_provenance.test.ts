// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import { Transaction } from '@mysten/sui/transactions'
import type { SuiClientTypes } from '@mysten/sui/client'

import { gift_redemption, verified_gift_package, type GiftPolicy, type GiftReceipt } from '../src/gift_provenance.ts'
import { validate_gift_voucher } from '../src/gift_sponsor.ts'

import fixture from './fixtures/basecamp_gift.mainnet.json'

// Captured mainnet object 0x5acf…6d5a v1034707540 and tx 5SCHg…GGuc, 2026-10-07.
// Full object IDs, checkpoint and raw BCS live in the fixture's provenance, not self-round-trips.
const receipt = (): GiftReceipt => {
  const copy = structuredClone(fixture.redeem) as unknown as GiftReceipt
  copy.Transaction!.transaction = Transaction.from(fixture.redeem.Transaction.bcs).getData()
  return copy
}
const card = String(fixture.redeem.Transaction.events[0]!.json!.giftcard)
const { sender } = fixture.redeem.Transaction.transaction
const proof = { giftcard: card, redeem: fixture.redeem.Transaction.digest }
const current_policy: GiftPolicy = {
  ...fixture.policy,
  pins: { ...fixture.policy.pins, network: 'mainnet' },
  giftcards: new Set([card, fixture.voucher.objectId]),
  reward_templates: new Set(),
}

const policy = verified_gift_package(current_policy, fixture.package_lineage.id, fixture.package_lineage.original)

test('captured voucher and raw redemption transaction identify the exact minted crate and its kiosk', () => {
  validate_gift_voucher(policy, fixture.voucher as unknown as SuiClientTypes.Object<{ json: true }>)
  expect(gift_redemption(policy, sender, proof, receipt())).toEqual({
    stage: 'crate',
    proof,
    crate: '0x2458af09ad8778e1f6990c90c3d57b9a406f2efe880b3b5025590d3a9306b577',
    kiosk: '0x1b07fba3f12dd29206933ad62d443ec0883561ede9299919d0b6561663bfa374',
  })
})

test('a Sui Crate template alone never grants sponsorship to a different campaign voucher', () => {
  expect(() => validate_gift_voucher({ ...policy, giftcards: new Set() }, fixture.voucher as never)).toThrow()
  expect(() => gift_redemption(policy, sender, { ...proof, giftcard: fixture.voucher.objectId }, receipt())).toThrow()
  expect(() => gift_redemption(policy, fixture.voucher.objectId, proof, receipt())).toThrow()
})

test('a redemption cannot smuggle extra transactions or forge an event from another package', () => {
  const extra = receipt()
  extra.Transaction!.transaction.commands.push({ TransferObjects: { objects: [], address: { Input: 0 } } })
  expect(() => gift_redemption(policy, sender, proof, extra)).toThrow()
  const forged = receipt()
  forged.Transaction!.events[0]!.eventType = `0x2::distribution::GiftcardRedeemed`
  forged.Transaction!.events[0]!.packageId = '0x2'
  expect(() => gift_redemption(policy, sender, proof, forged)).toThrow()
})

test('a failed or ambiguous mint cannot establish a crate entitlement', () => {
  const failed = receipt()
  failed.Transaction!.effects.status = { success: false, error: { message: 'aborted' } } as never
  expect(() => gift_redemption(policy, sender, proof, failed)).toThrow()
  const extra = receipt()
  const item = extra.Transaction!.effects.changedObjects.find((row) => row.objectId.startsWith('0x2458'))!
  extra.Transaction!.effects.changedObjects.push({ ...item, objectId: '0xduplicate' })
  extra.Transaction!.objectTypes['0xduplicate'] = `${policy.game_type}::item::Item`
  expect(() => gift_redemption(policy, sender, proof, extra)).toThrow()
})

test('historical package calls must prove their original lineage', () => {
  expect(policy.pins.package).toBe(fixture.package_lineage.id)
  expect(() => verified_gift_package(current_policy, fixture.package_lineage.id, '0x2')).toThrow()
})

test('event type addresses may differ after an upgrade, but the verified game API must produce them', () => {
  const upgraded = receipt()
  upgraded.Transaction!.events[0]!.eventType = `${fixture.package_lineage.id}::distribution::GiftcardRedeemed`
  expect(gift_redemption(policy, sender, proof, upgraded).stage).toBe('crate')
})
