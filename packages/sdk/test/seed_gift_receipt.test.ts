// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import { normalizeSuiAddress } from '@mysten/sui/utils'

import { verified_seed_gift_keys, type SeedGiftReceipt } from '../src/seed_gift_receipt.ts'

const game = normalizeSuiAddress('0x123')
const key = normalizeSuiAddress('0x456')
const template = normalizeSuiAddress('0x789')
const custody = normalizeSuiAddress('0xabc')
const allocation = { key, template, custody, amount: 3 }
// Core-client contract fixture: no new wire decoder; certification comes from core.getTransaction.
const fixture = () => ({
  Transaction: {
    digest: 'ISSUANCE',
    effects: {
      status: { success: true },
      changedObjects: [{ objectId: key, idOperation: 'Created', outputOwner: { AddressOwner: custody } }],
    },
    objectTypes: { [key]: `${game}::distribution::Giftcard` },
    events: [{ eventType: `${game}::distribution::GiftcardMinted`, json: { giftcard: key, template, amount: 3 } }],
  },
})
const verify = (receipt: unknown) => verified_seed_gift_keys(game, 'ISSUANCE', [allocation], receipt as SeedGiftReceipt)

test('original creation effects and canonical mint event prove the allocation', () => {
  expect(verify(fixture())).toEqual([key])
})

for (const mutation of [
  (receipt: ReturnType<typeof fixture>) => {
    receipt.Transaction.digest = 'OTHER'
  },
  (receipt: ReturnType<typeof fixture>) => {
    receipt.Transaction.effects.status.success = false
  },
  (receipt: ReturnType<typeof fixture>) => {
    receipt.Transaction.effects.changedObjects[0]!.idOperation = 'None'
  },
  (receipt: ReturnType<typeof fixture>) => {
    receipt.Transaction.effects.changedObjects[0]!.outputOwner.AddressOwner = template
  },
  (receipt: ReturnType<typeof fixture>) => {
    receipt.Transaction.events[0]!.json.amount = 2
  },
  (receipt: ReturnType<typeof fixture>) => {
    receipt.Transaction.events[0]!.json.template = key
  },
  (receipt: ReturnType<typeof fixture>) => {
    receipt.Transaction.events[0]!.json.giftcard = template
  },
  (receipt: ReturnType<typeof fixture>) => {
    receipt.Transaction.events[0]!.eventType = '0x999::distribution::GiftcardMinted'
  },
  (receipt: ReturnType<typeof fixture>) => {
    receipt.Transaction.objectTypes[key] = '0x999::distribution::Giftcard'
  },
  (receipt: ReturnType<typeof fixture>) => {
    receipt.Transaction.events.push(receipt.Transaction.events[0]!)
  },
  (receipt: ReturnType<typeof fixture>) => {
    receipt.Transaction.events = []
  },
  (receipt: ReturnType<typeof fixture>) => {
    receipt.Transaction.effects.changedObjects.push(receipt.Transaction.effects.changedObjects[0]!)
  },
]) {
  test(`recovery rejects changed or incomplete evidence: ${mutation.toString()}`, () => {
    const receipt = fixture()
    mutation(receipt)
    expect(() => verify(receipt)).toThrow()
  })
}

test('a receipt from another authored batch cannot restore this batch', () => {
  expect(() => verified_seed_gift_keys(game, 'ISSUANCE', [], fixture() as unknown as SeedGiftReceipt)).toThrow(
    'authored allocation'
  )
})
