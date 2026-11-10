// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { AgentPairingIdentity } from '@aresrpg/protocol'
import { Transaction } from '@mysten/sui/transactions'
import { toBase64 } from '@mysten/sui/utils'
import type { SuiGrpcClient } from '@mysten/sui/grpc'

import { SDK, sui_transport, type TransactionSigner, type Pins } from './client.ts'
import { parse_agent_pairing_request, owner_agent_identity } from './agent_pairing.ts'
import { create_google_transaction_signer } from './agent_transactions.ts'
import { agent_transfer_actions } from './agent_transfer_actions.ts'
import { read_agent_equipment, same_agent_equipment } from './agent_equipment.ts'
import { read_personal_kiosks } from './kiosk_discovery.ts'
import { return_agent_assets, type AgentReturnOptions } from './agent_return.ts'
import type { KioskCapLoader } from './kiosk_runner.ts'
import type { TransactionStorage } from './transaction_execution.ts'
import { read_agent_recovery_assets } from './agent_inventory.ts'
import { check_agent_return, read_agent_returns, read_agent_item_returns } from './agent_returns.ts'

export { owner_agent_identity } from './agent_pairing.ts'

/** Owner recovery and automatic handover share one Google-member signing context per multisig. */
type RecallContext = Readonly<{
  read_request: () => unknown
  client: SuiGrpcClient
  sign_transaction: TransactionSigner
  pins?: Pins
  transaction_storage?: TransactionStorage | null
  owner_sdk?: ReturnType<typeof SDK>
  owner_kiosk_cap?: KioskCapLoader
}>

const recall_sdk = (options: RecallContext, identity: ReturnType<typeof owner_agent_identity>, network: 'mainnet') => {
  const sign_transaction = create_google_transaction_signer(
    identity,
    async (bytes) => {
      const proof = await options.sign_transaction(Transaction.from(bytes))
      return {
        bytes: typeof proof.bytes === 'string' ? proof.bytes : toBase64(proof.bytes),
        signature: proof.signature,
      }
    },
    options.client
  )
  return SDK({
    client: sui_transport(options.client),
    network,
    address: identity.address,
    sign_transaction,
    pins: options.pins,
    transaction_storage: options.transaction_storage,
  })
}

const read_recall = (
  options: RecallContext,
  sdk: ReturnType<typeof SDK>,
  identity: ReturnType<typeof owner_agent_identity>,
  request: ReturnType<typeof parse_agent_pairing_request>
) => {
  const current_owner = () => {
    const current = parse_agent_pairing_request(options.read_request())
    owner_agent_identity(
      { address: identity.address, multisig_public_key: identity.public_key.toBase64(), signer_mode: 'disposable' },
      current
    )
    return current.owner
  }
  const transfer = agent_transfer_actions(sdk, {
    address: identity.address,
    assets: {
      client: options.client,
      recipient: current_owner,
    },
    check_return: (intent) => {
      current_owner()
      return check_agent_return(options.client, sdk, identity.address, intent)
    },
    check_offer: async (intent) => {
      const current = await read_agent_equipment(options.client, sdk.game_type_package!, intent.character_id)
      if (!same_agent_equipment(current, intent.unequip ?? []))
        throw new Error('Equipment changed. Refresh Recall before signing.')
      if (intent.recipient !== current_owner()) throw new Error('Recall must return to the current Google owner.')
    },
    kiosk_cap: async (kiosk_id) => {
      const current = await read_personal_kiosks(sdk, identity.address)
      return (kiosk_id === undefined ? current[0] : current.find((cap) => cap.kioskId === kiosk_id)) ?? null
    },
  })
  return Object.freeze({
    read_pending_characters: () => read_agent_returns(options.client, sdk, identity.address, request.owner),
    transfer,
    read_recovery_assets: () => read_agent_recovery_assets(options.client, sdk, identity.address),
    read_incoming_items: () => read_agent_item_returns(options.client, sdk, request.owner, identity.address),
    read_deposit_items: () => read_agent_item_returns(options.client, sdk, identity.address, request.owner),
  })
}
export type AgentRecall = Awaited<ReturnType<typeof read_recall>>

/** One executor per multisig for the lifetime of the authenticated owner session. */
export const create_agent_recall_reader = (options: RecallContext) => {
  const executors = new Map<string, ReturnType<typeof SDK>>()
  const resolve = (pairing: AgentPairingIdentity) => {
    const request = parse_agent_pairing_request(options.read_request())
    const identity = owner_agent_identity(pairing, request)
    let sdk = executors.get(identity.address)
    if (!sdk) {
      sdk = recall_sdk(options, identity, request.network)
      executors.set(identity.address, sdk)
    }
    return { sdk, identity, request }
  }
  return Object.freeze({
    return_all: async (pairing: AgentPairingIdentity, input: AgentReturnOptions) => {
      if (!options.owner_sdk || !options.owner_kiosk_cap)
        throw new Error('Owner return is unavailable for this session.')
      const { sdk, identity, request } = resolve(pairing)
      const before_sign = () => {
        input.before_sign()
        owner_agent_identity(pairing, parse_agent_pairing_request(options.read_request()))
      }
      return return_agent_assets({
        ...input,
        before_sign,
        sdk,
        owner_sdk: options.owner_sdk,
        client: options.client,
        agent: identity.address,
        owner: request.owner,
        owner_kiosk_cap: options.owner_kiosk_cap,
      })
    },
    is_transaction_idle: () => [...executors.values()].every((sdk) => sdk.is_transaction_idle()),
    read_balances: async (pairing: AgentPairingIdentity) => {
      const { sdk } = resolve(pairing)
      const [sui_balance_mist, kares_balance] = await Promise.all([sdk.read_sui_balance(), sdk.read_kares_balance()])
      return { sui_balance_mist, kares_balance }
    },
    read: async (pairing: AgentPairingIdentity): Promise<AgentRecall> => {
      const { sdk, identity, request } = resolve(pairing)
      return read_recall(options, sdk, identity, request)
    },
  })
}
