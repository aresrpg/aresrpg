// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { AgentPairingIdentity } from '@aresrpg/protocol'
import { Transaction } from '@mysten/sui/transactions'
import { normalizeStructTag, toBase64 } from '@mysten/sui/utils'
import type { SuiGrpcClient } from '@mysten/sui/grpc'

import { SDK, sui_transport, type TransactionSigner, type Pins } from './client.ts'
import { parse_agent_pairing_request, owner_agent_identity } from './agent_pairing.ts'
import { create_google_transaction_signer } from './agent_transactions.ts'
import { agent_transfer_actions } from './agent_transfer_actions.ts'
import { read_agent_equipment } from './agent_equipment.ts'
import { read_personal_kiosks } from './kiosk_discovery.ts'
import type { TransactionStorage } from './transaction_execution.ts'
import { read_agent_inventory } from './agent_inventory.ts'
import { check_agent_return, read_agent_returns, read_agent_item_returns } from './agent_returns.ts'

export { owner_agent_identity } from './agent_pairing.ts'

/** Owner signs the multisig's offer using Google, then claims it with the ordinary wallet.
 * No agent callback, secret, new custody model or automatic second transaction. */
type RecallContext = Readonly<{
  read_request: () => unknown
  client: SuiGrpcClient
  sign_transaction: TransactionSigner
  pins?: Pins
  transaction_storage?: TransactionStorage | null
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

const read_recall = async (
  options: RecallContext,
  sdk: ReturnType<typeof SDK>,
  identity: ReturnType<typeof owner_agent_identity>,
  request: ReturnType<typeof parse_agent_pairing_request>
) => {
  const caps = await read_personal_kiosks(sdk, identity.address)
  const kiosks = await Promise.all(caps.map((cap) => sdk.get_kiosk(cap.kioskId)))
  const type = normalizeStructTag(`${sdk.game_type_package}::character::Character`)
  const items = kiosks.flatMap((kiosk) =>
    kiosk.items
      .filter((item) => normalizeStructTag(item.type) === type)
      .map((item) => Object.freeze({ character_id: item.objectId, kiosk: item.kioskId }))
  )
  const characters = await Promise.all(
    items.map(async (item) =>
      Object.freeze({
        ...item,
        unequip: await read_agent_equipment(options.client, sdk.game_type_package!, item.character_id),
      })
    )
  )
  const transfer = agent_transfer_actions(sdk, {
    address: identity.address,
    assets: {
      client: options.client,
      recipient: () => {
        const current = parse_agent_pairing_request(options.read_request())
        owner_agent_identity(
          { address: identity.address, multisig_public_key: identity.public_key.toBase64(), signer_mode: 'disposable' },
          current
        )
        return current.owner
      },
    },
    check_return: (intent) => check_agent_return(options.client, sdk, identity.address, intent),
    check_offer: async (intent) => {
      const current = await read_agent_equipment(options.client, sdk.game_type_package!, intent.character_id)
      if (JSON.stringify(current) !== JSON.stringify(intent.unequip ?? []))
        throw new Error('Equipment changed. Refresh Recall before signing.')
      if (intent.recipient !== request.owner) throw new Error('Recall must return to the current Google owner.')
    },
    kiosk_cap: async (kiosk_id) => {
      const current = await read_personal_kiosks(sdk, identity.address)
      return (kiosk_id === undefined ? current[0] : current.find((cap) => cap.kioskId === kiosk_id)) ?? null
    },
  })
  const pending = await read_agent_returns(options.client, sdk, identity.address, request.owner)
  return Object.freeze({
    characters: Object.freeze(characters),
    pending,
    transfer,
    read_inventory: () => read_agent_inventory(options.client, sdk, identity.address),
    read_incoming_items: () => read_agent_item_returns(options.client, sdk, request.owner, identity.address),
    read_deposit_items: () => read_agent_item_returns(options.client, sdk, identity.address, request.owner),
  })
}
export type AgentRecall = Awaited<ReturnType<typeof read_recall>>

/** One executor per multisig for the lifetime of the authenticated owner session. */
export const create_agent_recall_reader = (options: RecallContext) => {
  const executors = new Map<string, ReturnType<typeof SDK>>()
  return Object.freeze({
    is_transaction_idle: () => [...executors.values()].every((sdk) => sdk.is_transaction_idle()),
    read: async (pairing: AgentPairingIdentity): Promise<AgentRecall> => {
      const request = parse_agent_pairing_request(options.read_request())
      const identity = owner_agent_identity(pairing, request)
      let sdk = executors.get(identity.address)
      if (!sdk) {
        sdk = recall_sdk(options, identity, request.network)
        executors.set(identity.address, sdk)
      }
      return read_recall(options, sdk, identity, request)
    },
  })
}
