// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { bcs } from '@mysten/sui/bcs'
import { Transaction } from '@mysten/sui/transactions'
import type { SuiClientTypes } from '@mysten/sui/client'
import { fromBase64, normalizeSuiAddress, normalizeStructTag } from '@mysten/sui/utils'

import type { Pins } from './pins.ts'
import { GiftError, type GiftAction, type GiftProof, type GiftStatus } from './gift_contract.ts'

export type GiftPolicy = Readonly<{
  pins: Pins
  game_type: string
  box_template: string
  giftcards: ReadonlySet<string>
  reward_templates: ReadonlySet<string>
}>
export const GIFT_RECEIPT_INCLUDE = { effects: true, events: true, objectTypes: true, transaction: true } as const
export type GiftReceipt = SuiClientTypes.TransactionResult<typeof GIFT_RECEIPT_INCLUDE>
type TransactionData = ReturnType<Transaction['getData']>
type MoveCall = Extract<TransactionData['commands'][number], { $kind: 'MoveCall' }>['MoveCall']
type Argument = MoveCall['arguments'][number]

const target_of = (call: MoveCall): string => `${normalizeSuiAddress(call.package)}::${call.module}::${call.function}`

const door_names = { redeem: 'redeem_giftcard', open: 'open_loot_boxes', collect: 'claim_loot' } as const

export const verified_gift_package = (policy: GiftPolicy, storage_id: string, original_id: string): GiftPolicy => {
  if (original_id !== policy.game_type) throw new GiftError('ineligible')
  return { ...policy, pins: { ...policy.pins, package: storage_id } }
}

/** No arbitrary PTBs: exactly one game door plus its ordinary kiosk/branding scaffold. */
export const gift_transaction_call = (policy: GiftPolicy, action: GiftAction, data: TransactionData): MoveCall => {
  const door = `${policy.pins.package}::api::${door_names[action]}`
  const allowed = new Set([`${policy.pins.math_package}::aresrpg::aresrpg`, door])
  const single_open = `${policy.pins.package}::api::open_loot_box`
  if (action === 'open') allowed.add(single_open)
  if (action === 'redeem') {
    allowed.add(`${normalizeSuiAddress('0x2')}::kiosk::new`)
    allowed.add(`${normalizeSuiAddress('0x2')}::transfer::public_share_object`)
    for (const name of ['new', 'borrow_val', 'return_val', 'transfer_to_sender'])
      allowed.add(`${policy.pins.kiosk_package}::personal_kiosk::${name}`)
  }
  const calls = data.commands.map((command) => {
    if (!command.MoveCall) throw new GiftError('ineligible')
    return command.MoveCall
  })
  const targets = calls.map(target_of)
  if (new Set(targets).size !== targets.length || targets.some((target) => !allowed.has(target)))
    throw new GiftError('ineligible')
  const game_calls = calls.filter(
    (call) => target_of(call) === door || (action === 'open' && target_of(call) === single_open)
  )
  if (game_calls.length !== 1 || !game_calls[0]) throw new GiftError('ineligible')
  return game_calls[0]
}

const transaction_input = (data: TransactionData, argument: Argument | undefined) => {
  if (argument?.$kind !== 'Input') throw new GiftError('ineligible')
  const input = data.inputs[argument.Input]
  if (!input) throw new GiftError('ineligible')
  return input
}

const object_argument = (data: TransactionData, argument: Argument | undefined): string => {
  const input = transaction_input(data, argument)
  const object = input.Object
  const id = object?.ImmOrOwnedObject?.objectId ?? object?.SharedObject?.objectId
  if (!id) throw new GiftError('ineligible')
  return id
}

const pure_argument = (data: TransactionData, argument: Argument | undefined): Uint8Array => {
  const input = transaction_input(data, argument)
  if (!input.Pure) throw new GiftError('ineligible')
  return fromBase64(input.Pure.bytes)
}

export const validate_gift_transaction = (
  policy: GiftPolicy,
  action: GiftAction,
  data: TransactionData,
  status: GiftStatus
): void => {
  const call = gift_transaction_call(policy, action, data)
  const args = call.arguments
  const null_option = (index: number): boolean => {
    const bytes = pure_argument(data, args[index])
    return bytes.length === 1 && bytes[0] === 0
  }
  const valid = {
    redeem: () =>
      object_argument(data, args[0]) === status.proof?.giftcard &&
      object_argument(data, args[1]) === policy.box_template &&
      null_option(2),
    open: () =>
      bcs.Address.parse(pure_argument(data, args[3])) === status.crate &&
      object_argument(data, args[4]) === policy.box_template &&
      (call.function === 'open_loot_box' || bcs.u32().parse(pure_argument(data, args[5])) === 1),
    collect: () =>
      object_argument(data, args[0]) === status.claim &&
      object_argument(data, args[1]) === status.reward_template &&
      null_option(2),
  }[action]()
  if (!valid) throw new GiftError('ineligible')
}

const certified = (receipt: GiftReceipt, digest: string, address: string) => {
  const transaction = receipt.Transaction
  if (
    !transaction ||
    !transaction.effects.status.success ||
    transaction.digest !== digest ||
    transaction.transaction.sender !== address
  )
    throw new GiftError('ineligible')
  return transaction
}

// New event types can originate in an upgraded package. The verified API producer,
// rather than the event type's first-definition address, owns this receipt.
const events_for = (transaction: NonNullable<GiftReceipt['Transaction']>, type: string, producer: string) =>
  transaction.events.filter(
    (row) =>
      row.packageId === producer &&
      row.module === 'api' &&
      normalizeStructTag(row.eventType).endsWith(type.slice(type.indexOf('::')))
  )

const event = (transaction: NonNullable<GiftReceipt['Transaction']>, type: string, producer: string) => {
  const matches = events_for(transaction, type, producer)
  if (matches.length !== 1 || !matches[0]?.json) throw new GiftError('ineligible')
  return matches[0].json
}

const consumed = (transaction: NonNullable<GiftReceipt['Transaction']>, id: string): void => {
  if (!transaction.effects.changedObjects.some((row) => row.objectId === id && row.idOperation === 'Deleted'))
    throw new GiftError('ineligible')
}

const created = (transaction: NonNullable<GiftReceipt['Transaction']>, type: string) => {
  const rows = transaction.effects.changedObjects.filter(
    (row) => row.idOperation === 'Created' && transaction.objectTypes[row.objectId] === type
  )
  if (rows.length !== 1 || !rows[0]) throw new GiftError('ineligible')
  return rows[0]
}

/** Kiosk Items belong to a dynamic-object field, whose certified parent is the kiosk. */
const deposited_item = (transaction: NonNullable<GiftReceipt['Transaction']>, policy: GiftPolicy) => {
  const item = created(transaction, `${policy.game_type}::item::Item`)
  const parent = item.outputOwner?.ObjectOwner
  const field = transaction.effects.changedObjects.find((row) => row.objectId === parent)
  const kiosk = field?.outputOwner?.ObjectOwner
  if (!kiosk) throw new GiftError('ineligible')
  return { item: item.objectId, kiosk }
}

export const gift_redemption = (
  policy: GiftPolicy,
  address: string,
  proof: GiftProof,
  receipt: GiftReceipt
): GiftStatus => {
  if (!proof.redeem || !policy.giftcards.has(proof.giftcard)) throw new GiftError('ineligible')
  const transaction = certified(receipt, proof.redeem, address)
  validate_gift_transaction(policy, 'redeem', Transaction.from(JSON.stringify(transaction.transaction)).getData(), {
    stage: 'voucher',
    proof,
  })
  const redeemed = event(
    transaction,
    `${policy.game_type}::distribution::GiftcardRedeemed`,
    String(policy.pins.package)
  )
  if (redeemed.giftcard !== proof.giftcard || redeemed.redeemer !== address) throw new GiftError('ineligible')
  consumed(transaction, proof.giftcard)
  const { item, kiosk } = deposited_item(transaction, policy)
  return { stage: 'crate', proof, crate: item, kiosk }
}

export const gift_opening = (
  policy: GiftPolicy,
  address: string,
  prior: GiftStatus,
  receipt: GiftReceipt
): GiftStatus => {
  if (!prior.proof?.open || !prior.crate) throw new GiftError('ineligible')
  const transaction = certified(receipt, prior.proof.open, address)
  validate_gift_transaction(policy, 'open', Transaction.from(JSON.stringify(transaction.transaction)).getData(), prior)
  consumed(transaction, prior.crate)
  const batch_type = `${policy.game_type}::loot_box::LootBoxesOpened`
  const has_batch = events_for(transaction, batch_type, String(policy.pins.package)).length > 0
  const roll = event(transaction, `${policy.game_type}::loot_box::LootBoxOpened`, String(policy.pins.package))
  const claim = created(transaction, `${policy.game_type}::loot_box::BoxClaim`)
  const reward_template = roll.rolled_template
  if (typeof reward_template !== 'string') throw new GiftError('ineligible')
  const valid = [
    roll.box_template === policy.box_template,
    roll.opener === address,
    roll.amount === 1,
    claim.outputOwner?.AddressOwner === address,
  ].every(Boolean)
  if (!valid) throw new GiftError('ineligible')
  if (has_batch) {
    const batch = event(transaction, batch_type, String(policy.pins.package))
    if (
      batch.box_template !== policy.box_template ||
      JSON.stringify(batch.claim_ids) !== JSON.stringify([claim.objectId])
    )
      throw new GiftError('ineligible')
  } else {
    const call = gift_transaction_call(
      policy,
      'open',
      Transaction.from(JSON.stringify(transaction.transaction)).getData()
    )
    if (call.function !== 'open_loot_box') throw new GiftError('ineligible')
  }
  return { ...prior, stage: 'reward', claim: claim.objectId, reward_template, amount: 1 }
}

export const gift_collection = (
  policy: GiftPolicy,
  address: string,
  prior: GiftStatus,
  receipt: GiftReceipt
): GiftStatus => {
  if (!prior.proof?.collect || !prior.claim) throw new GiftError('ineligible')
  const transaction = certified(receipt, prior.proof.collect, address)
  validate_gift_transaction(
    policy,
    'collect',
    Transaction.from(JSON.stringify(transaction.transaction)).getData(),
    prior
  )
  consumed(transaction, prior.claim)
  const claimed = event(transaction, `${policy.game_type}::loot_box::LootClaimed`, String(policy.pins.package))
  if (
    claimed.box_template !== policy.box_template ||
    claimed.rolled_template !== prior.reward_template ||
    claimed.opener !== address ||
    claimed.amount !== prior.amount
  )
    throw new GiftError('ineligible')
  const { item, kiosk } = deposited_item(transaction, policy)
  if (kiosk !== prior.kiosk) throw new GiftError('ineligible')
  return { ...prior, stage: 'collected', item }
}
