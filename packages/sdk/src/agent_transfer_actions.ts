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
import { agent_batch_fits, type AgentBatchLimits } from './agent_batch_limits.ts'
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
      agent_address?: string
    }>
  | Readonly<{
      kind: 'cancel'
      seller_kiosk: string
      purchase_cap: string
      equipment?: readonly ReturnEquipment[]
      agent_address?: string
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
    check_return?: (intent: Exclude<CharacterTransferIntent, { kind: 'offer' }>) => Promise<void>
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
    if (intent.kind !== 'offer') await check_return(intent)
    switch (intent.kind) {
      case 'offer': {
        await check_offer(intent)
        await sdk.hydrate((intent.unequip ?? []).map((row) => row.item_id))
        const kiosk_cap = await resolve_kiosk_cap(context.kiosk_cap, { kiosk: intent.kiosk }, true)
        if (!kiosk_cap) throw new Error('The selected character kiosk is unavailable.')
        return builders.offer({ ...intent, sender: context.address, kiosk_cap })
      }
      case 'claim':
        return builders.claim({ ...intent, recipient: context.address, kiosk_cap: await context.kiosk_cap() })
      case 'cancel':
        return builders.cancel({ ...intent, holder: context.address })
    }
  }
  const simulate = (tx: Transaction, intent: AgentTransferIntent) =>
    sdk.simulate(tx, { budget: context.budget ?? (is_asset_intent(intent) ? 'estimate' : undefined) })
  return Object.freeze({
    sender: context.address,
    fits: async (input: AgentTransferIntent) => {
      await sdk.synchronize_transactions()
      if (!assets || !context.batch_limits) throw new Error('Batch transaction limits are unavailable.')
      return agent_batch_fits(assets.client, await compose(snapshot_intent(input)), context.batch_limits)
    },
    quote: async (input: AgentTransferIntent) => {
      if (!assets) throw new Error('Return quoting is unavailable for this session.')
      const intent = snapshot_intent(input)
      return quote_return_transaction(assets.client, context.address, await compose(intent))
    },
    prepare: async (input: AgentTransferIntent) => {
      const intent = snapshot_intent(input)
      const transaction = await compose(intent)
      const simulation = await simulate(transaction, intent)
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
        // Recheck the exact reviewed transaction against current chain state before signing.
        confirm: async ({ before_sign }: Readonly<{ before_sign?: () => void }> = {}) => {
          if (consumed) throw new Error('This review was already submitted. Reconcile its outcome first.')
          consumed = true
          const reviewed = Transaction.from(serialized)
          try {
            if (is_asset_intent(intent) || is_agent_batch(intent)) await compose(intent)
            else if (intent.kind === 'offer') await check_offer(intent)
            else await check_return(intent)
            assert_simulation(await simulate(reviewed, intent))
            if (is_asset_intent(intent)) await check_asset_reserve(sdk, context.address, intent, reviewed)
          } catch (error) {
            throw transaction_resolution_error(error)
          }
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

/** One explicit gesture prepares and submits one transaction, retaining the wallet's signature approval. */
export const execute_agent_transfer = async ({
  actions,
  intent,
  is_current,
  prepared,
}: Readonly<{
  actions: AgentTransferActions
  intent: AgentTransferIntent
  is_current: () => boolean
  prepared?: () => void
}>) => {
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
