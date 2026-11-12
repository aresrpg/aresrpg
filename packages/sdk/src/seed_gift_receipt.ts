// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { SuiClientTypes } from '@mysten/sui/client'
import { normalizeStructTag, normalizeSuiAddress } from '@mysten/sui/utils'

export const SEED_GIFT_RECEIPT_INCLUDE = { effects: true, events: true, objectTypes: true } as const
export type SeedGiftReceipt = SuiClientTypes.TransactionResult<typeof SEED_GIFT_RECEIPT_INCLUDE>
export type SeedGiftAllocation = Readonly<{ key: string; template: string; amount: number; custody: string }>

/** Verify issuance, never current custody: vouchers can have moved or been redeemed since creation. */
export const verified_seed_gift_keys = (
  game_type: string,
  digest: string,
  allocations: readonly SeedGiftAllocation[],
  receipt: SeedGiftReceipt
): readonly string[] => {
  const transaction = receipt.Transaction
  if (!transaction || transaction.digest !== digest || transaction.effects?.status?.success !== true)
    throw new Error('Gift creation recovery requires its successful certified receipt')
  const type = `${normalizeSuiAddress(game_type)}::distribution::Giftcard`
  const event_type = `${type}Minted`
  const created = transaction.effects.changedObjects.filter(
    (row) =>
      row.idOperation === 'Created' &&
      normalizeStructTag(transaction.objectTypes[row.objectId] ?? '0x0::missing::Missing') === type
  )
  if (!created.length) throw new Error('The receipt created no canonical giftcards')
  const expected = new Map(allocations.map((row) => [row.key, row]))
  const keys = created.map((object) => {
    const allocation = expected.get(object.objectId)
    const events = transaction.events.filter(
      (event) => normalizeStructTag(event.eventType) === event_type && event.json?.giftcard === object.objectId
    )
    if (!allocation) throw new Error(`Gift ${object.objectId} is outside the authored allocation`)
    const event = events[0]?.json
    const issued = [event?.template, event?.amount, object.outputOwner?.AddressOwner]
    const expected_values = [allocation.template, allocation.amount, normalizeSuiAddress(allocation.custody)]
    if (events.length !== 1 || JSON.stringify(issued) !== JSON.stringify(expected_values))
      throw new Error(`Gift creation receipt does not prove the authored allocation for ${object.objectId}`)
    return object.objectId
  })
  if (new Set(keys).size !== keys.length) throw new Error('Gift creation receipt repeats an object')
  return Object.freeze(keys)
}
