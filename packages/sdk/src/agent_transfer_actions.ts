// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { Transaction } from '@mysten/sui/transactions'

import type { EquipChange } from './character_actions.ts'
import type { Sdk } from './client.ts'
import { receipt_digest, type Receipt } from './cache.ts'
import { gas_mist_from_receipt } from './gas.ts'
import { resolve_kiosk_cap, type KioskCapLoader } from './kiosk_runner.ts'
import { transaction_resolution_error } from './transaction_error.ts'
import type { ReturnEquipment } from './agent_returns.ts'
import {
  compose_agent_assets,
  check_asset_reserve,
  is_asset_intent,
  type AgentAssetIntent,
} from './agent_asset_transfer.ts'
import { quote_return_transaction } from './agent_return_funding.ts'
import { compose_agent_batch, is_agent_batch, type AgentBatchIntent } from './agent_batch.ts'
import {
  agent_batch_fits,
  read_agent_batch_limits,
  submit_agent_batches,
  type AgentBatchLimits,
} from './agent_batch_limits.ts'
import { agent_character_transfer } from './agent_transactions.ts'

type CharacterTransferIntent =
  | Readonly<{
      kind: 'offer'
      character_id: string
      kiosk: string
      recipient: string
      unequip?: readonly EquipChange[]
    }>
  | Readonly<{
      kind: 'claim'
      character_id: string
      seller_kiosk: string
      purchase_cap: string
      equipment?: readonly ReturnEquipment[]
      agent_address: string
    }>

export type AgentTransferIntent = CharacterTransferIntent | AgentAssetIntent | AgentBatchIntent

const assert_simulation = (receipt: Receipt): void => {
  const { FailedTransaction: failure } = receipt
  const { effects } = failure ?? receipt.Transaction ?? receipt
  const status = effects?.status
  if (receipt.$kind === 'FailedTransaction' || failure || status?.success !== true)
    throw new Error(`Agent transfer simulation failed; no signature was requested. ${JSON.stringify(status)}`)
}

/** One reviewed operation per sender. Calling prepare never signs or submits.
 * Confirm is consumed before submission: an ambiguous result must be reconciled, never retried. */
export const agent_transfer_actions = (
  sdk: Sdk,
  context: Readonly<{
    address: string
    kiosk_cap: KioskCapLoader
    budget?: bigint | 'estimate'
    batch_limits?: AgentBatchLimits
    check_offer?: (intent: Extract<AgentTransferIntent, { kind: 'offer' }>) => Promise<void>
    check_return?: (intent: Extract<CharacterTransferIntent, { kind: 'claim' }>) => Promise<void>
    assets?: Readonly<{ client: SuiGrpcClient; recipient?: () => string }>
  }>
) => {
  const builders = agent_character_transfer(sdk)
  const check_offer = context.check_offer ?? (async () => undefined)
  const check_return = context.check_return ?? (async () => undefined)
  const { assets } = context
  const compose_assets = assets
    ? (intent: AgentAssetIntent) =>
        compose_agent_assets(assets.client, sdk, context.address, intent, assets.recipient?.())
    : async () => {
        throw new Error('Asset recovery is unavailable for this session.')
      }
  const compose = async (intent: AgentTransferIntent): Promise<Transaction> => {
    if (is_agent_batch(intent)) {
      if (!assets || !context.batch_limits) throw new Error('Batch transaction limits are unavailable.')
      return compose_agent_batch(
        sdk,
        {
          address: context.address,
          client: assets.client,
          kiosk_cap: context.kiosk_cap,
          limits: context.batch_limits,
          recipient: assets.recipient,
          check_offer,
          check_return,
        },
        intent
      )
    }
    if (is_asset_intent(intent)) return compose_assets(intent)
    if (intent.kind === 'claim') {
      await check_return(intent)
      return builders.claim({ ...intent, recipient: context.address, kiosk_cap: await context.kiosk_cap() })
    }
    await check_offer(intent)
    await sdk.hydrate((intent.unequip ?? []).map((row) => row.item_id))
    const kiosk_cap = await resolve_kiosk_cap(context.kiosk_cap, { kiosk: intent.kiosk }, true)
    if (!kiosk_cap) throw new Error('The selected character kiosk is unavailable.')
    return builders.offer({ ...intent, sender: context.address, kiosk_cap })
  }
  const simulate = (tx: Transaction) => sdk.simulate(tx, { budget: context.budget ?? 'estimate' })
  let limits = context.batch_limits && Promise.resolve(context.batch_limits)
  return Object.freeze({
    sender: context.address,
    synchronize: () => sdk.synchronize_transactions(),
    fits: async (input: AgentTransferIntent) => {
      await sdk.synchronize_transactions()
      if (!assets) throw new Error('Batch transaction limits are unavailable.')
      // A session that was given no limits reads the network's own, once.
      limits ??= read_agent_batch_limits(assets.client).catch((error: unknown) => {
        limits = undefined
        throw error
      })
      return agent_batch_fits(assets.client, await compose(snapshot_intent(input)), await limits)
    },
    quote: async (input: AgentTransferIntent) => {
      if (!assets) throw new Error('Return quoting is unavailable for this session.')
      const intent = snapshot_intent(input)
      return quote_return_transaction(assets.client, context.address, await compose(intent))
    },
    prepare: async (input: AgentTransferIntent) => {
      await sdk.synchronize_transactions()
      const intent = snapshot_intent(input)
      const transaction = await compose(intent)
      const simulation = await simulate(transaction)
      assert_simulation(simulation)
      if (is_asset_intent(intent)) await check_asset_reserve(sdk, context.address, intent, transaction)
      const gas_mist = gas_mist_from_receipt(simulation)
      if (gas_mist === null) throw new Error('Simulation returned no gas estimate.')
      const serialized = await transaction.toJSON()
      let consumed = false
      return Object.freeze({
        intent,
        sender: context.address,
        network: sdk.network,
        gas_mist: gas_mist.toString(),
        gas_budget_mist: transaction.getData().gasData.budget,
        // Submits the exact transaction that was just checked, built and simulated, once. Nothing is checked or
        // simulated again: the chain refuses a stale object, and every caller submits in the gesture that prepared.
        confirm: async ({ before_sign }: Readonly<{ before_sign?: () => void }> = {}) => {
          if (consumed) throw new Error('This review was already submitted. Reconcile its outcome first.')
          consumed = true
          const reviewed = Transaction.from(serialized)
          const receipt = await sdk.execute(reviewed, { include: { objectTypes: true }, before_sign })
          return Object.freeze({ digest: receipt_digest(receipt), receipt })
        },
      })
    },
  })
}

export type AgentTransferActions = ReturnType<typeof agent_transfer_actions>
export type AgentTransferReview = Awaited<ReturnType<AgentTransferActions['prepare']>>

const snapshot_intent = (input: AgentTransferIntent): AgentTransferIntent => {
  if (input.kind === 'offer_batch')
    return Object.freeze({
      ...input,
      items: Object.freeze(input.items.map((row) => Object.freeze({ ...row }))),
      characters: Object.freeze(
        input.characters.map((row) =>
          Object.freeze({
            ...row,
            unequip: Object.freeze((row.unequip ?? []).map((gear) => Object.freeze({ ...gear }))),
          })
        )
      ),
    })
  if (input.kind === 'claim_batch')
    return Object.freeze({
      ...input,
      items: Object.freeze(input.items.map((row) => Object.freeze({ ...row }))),
      characters: Object.freeze(
        input.characters.map((row) =>
          Object.freeze({
            ...row,
            equipment: Object.freeze((row.equipment ?? []).map((gear) => Object.freeze({ ...gear }))),
          })
        )
      ),
    })
  if (is_asset_intent(input))
    return Object.freeze({
      ...input,
      items: Object.freeze(input.items.map((row) => Object.freeze({ ...row }))),
    }) as AgentAssetIntent
  if (input.kind === 'offer')
    return Object.freeze({
      ...input,
      unequip: Object.freeze((input.unequip ?? []).map((row) => Object.freeze({ ...row }))),
    })
  if (!input.equipment) return Object.freeze({ ...input })
  return Object.freeze({
    ...input,
    equipment: Object.freeze((input.equipment ?? []).map((row) => Object.freeze({ ...row }))),
  })
}

type TransferGesture = Readonly<{
  actions: AgentTransferActions
  intent: AgentTransferIntent
  is_current: () => boolean
  prepared?: () => void
}>
/** One explicit gesture prepares and submits its transaction, retaining the wallet's signature approval.
 * An item claim costs several commands per pile, so a group that one transaction cannot hold is claimed in
 * several: an executed offer of many piles is never left without a claim that fits. */
export const execute_agent_transfer = async (gesture: TransferGesture) => {
  const { actions, intent } = gesture
  if (intent.kind !== 'asset_claim' || intent.items.length < 2) return submit_agent_transfer(gesture)
  let last: Awaited<ReturnType<typeof submit_agent_transfer>> | undefined
  await submit_agent_batches(
    intent.items,
    // A fit check signs nothing: its failure is a refusal before submission, like a failed preparation.
    (items) =>
      actions.fits({ ...intent, items }).catch((error: unknown) => {
        throw transaction_resolution_error(error)
      }),
    async (items) => {
      last = await submit_agent_transfer({ ...gesture, intent: { ...intent, items } })
    }
  )
  return last!
}
const submit_agent_transfer = async ({ actions, intent, is_current, prepared }: TransferGesture) => {
  const assert_current = () => {
    if (!is_current()) throw new Error('The confirmed wallet or agent changed.')
  }
  let review: AgentTransferReview
  try {
    assert_current()
    review = await actions.prepare(intent)
    assert_current()
    prepared?.()
  } catch (error) {
    throw transaction_resolution_error(error)
  }
  // Never wrap a confirmation error as preflight failure or retry an uncertain/executed transaction.
  return review.confirm({ before_sign: assert_current })
}
