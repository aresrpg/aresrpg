// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// A player moves the characters and items of another Sui wallet they own into their game wallet.
// This is the bot handover with another source signer: the same zero-price exclusive listings,
// the same measured batches, the same cap-based resume. It adds no transfer path of its own.
//
// The source wallet is not a game account and has no indexed projection. Its snapshot here is a
// signing-time read for the transaction this wallet is about to sign (DECISIONS: THE SDK IS
// WRITE-FIRST). It is never a game inventory and never a fallback for one.
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { normalizeSuiAddress } from '@mysten/sui/utils'

import type { Sdk } from './client.ts'
import type { KioskCapLoader } from './kiosk_runner.ts'
import { read_personal_kiosks } from './kiosk_discovery.ts'
import { read_agent_equipment, same_agent_equipment } from './agent_equipment.ts'
import { read_agent_recovery_assets } from './agent_inventory.ts'
import {
  check_agent_return,
  read_agent_item_returns,
  read_agent_returns,
  type AgentItemReturnOffer,
  type AgentReturnOffer,
} from './agent_returns.ts'
import {
  agent_transfer_actions,
  type AgentTransferActions,
  type AgentTransferIntent,
} from './agent_transfer_actions.ts'
import { claim_agent_batches, complete_agent_batches } from './agent_handover.ts'
import { read_agent_batch_limits } from './agent_batch_limits.ts'
import type { AgentBatchCharacter } from './agent_batch.ts'
import type { RecallItem } from './agent_asset_transfer.ts'
import { ROYALTY_FLOOR_MIST } from './marketplace.ts'

export type WalletImportContext = Readonly<{
  client: SuiGrpcClient
  source_sdk: Sdk
  source: string
  owner_sdk: Sdk
  owner: string
  owner_kiosk_cap: KioskCapLoader
}>

export type WalletImportPlan = Readonly<{
  characters: readonly AgentBatchCharacter[]
  items: readonly RecallItem[]
  /** Offers of an interrupted import. They are claimed first and never offered again. */
  pending: Readonly<{ characters: readonly AgentReturnOffer[]; items: readonly AgentItemReturnOffer[] }>
  /** Assets that stay in the source wallet, by reason. */
  left: Readonly<{ roster: number; listed: number }>
  /** Every object that changes owner pays the royalty floor once. */
  assets: number
  royalty_mist: bigint
}>

export type WalletImportProgress = Readonly<{ signer: 'source' | 'owner'; moved: number; total: number }>

export type WalletImportOptions = Readonly<{
  /** Free roster places of the game account. More characters stay in the source wallet. */
  character_slots: number
  before_sign: () => void
  on_progress?: (progress: WalletImportProgress) => void
}>

export class WalletImportFundingRequired extends Error {
  readonly payer: 'source' | 'owner'
  readonly required_mist: bigint
  constructor(payer: 'source' | 'owner', required_mist: bigint) {
    super(`The ${payer} wallet needs more SUI to move these assets.`)
    // eslint-disable-next-line functional/no-this-expressions -- Error metadata names the wallet to fund and the amount.
    this.payer = payer
    // eslint-disable-next-line functional/no-this-expressions -- Error metadata names the wallet to fund and the amount.
    this.required_mist = required_mist
  }
}

const character_assets = (row: Readonly<{ unequip?: readonly unknown[]; equipment?: readonly unknown[] }>): number =>
  1 + (row.unequip ?? row.equipment ?? []).length

const intent_assets = (intent: AgentTransferIntent): number =>
  intent.kind === 'offer_batch' || intent.kind === 'claim_batch'
    ? intent.characters.reduce((total, row) => total + character_assets(row), 0) + intent.items.length
    : 0

/** On-chain capability checks compare canonical addresses, so both wallets enter in that form. */
const canonical = (context: WalletImportContext): WalletImportContext => {
  const source = normalizeSuiAddress(context.source)
  const owner = normalizeSuiAddress(context.owner)
  if (source === owner) throw new Error('Connect a wallet other than your game wallet.')
  return { ...context, source, owner }
}

/** One signing-time snapshot of what the source wallet can offer now. */
export const read_wallet_import = async (
  input: WalletImportContext,
  character_slots: number
): Promise<WalletImportPlan> => {
  const context = canonical(input)
  const { client, source_sdk, source, owner } = context
  const [pending_characters, pending_items, audit] = await Promise.all([
    read_agent_returns(client, source_sdk, owner, source),
    read_agent_item_returns(client, source_sdk, owner, source),
    read_agent_recovery_assets(client, source_sdk, source),
  ])
  const free = audit.kiosk_assets.filter(({ listed }) => !listed)
  const owned_characters = free.filter(({ kind }) => kind === 'character')
  const places = Math.max(0, character_slots - pending_characters.length)
  const characters = await Promise.all(
    owned_characters.slice(0, places).map(async (row) => ({
      character_id: row.id,
      kiosk: row.kiosk,
      unequip: await read_agent_equipment(client, source_sdk.game_type_package!, row.id),
    }))
  )
  const held = free.filter(({ kind }) => kind === 'item')
  await source_sdk.hydrate(held.map(({ id }) => id))
  const items: readonly RecallItem[] = [
    ...held.map(({ id, kiosk }) => {
      const version = source_sdk.ref(id)?.version
      if (!version) throw new Error('An item revision is unavailable. Refresh before importing.')
      return { item_id: id, kiosk, version }
    }),
    ...audit.items.map(({ item }) => ({ item_id: item.id, kiosk: item.kiosk, version: item.version!, direct: true })),
  ]
  const assets =
    [...characters, ...pending_characters].reduce((total, row) => total + character_assets(row), 0) +
    items.length +
    pending_items.length
  return Object.freeze({
    characters: Object.freeze(characters),
    items: Object.freeze(items),
    pending: Object.freeze({ characters: pending_characters, items: pending_items }),
    left: Object.freeze({
      roster: owned_characters.length - characters.length,
      listed: audit.kiosk_assets.filter(({ listed, exclusive }) => listed && !exclusive).length,
    }),
    assets,
    royalty_mist: BigInt(assets) * ROYALTY_FLOOR_MIST,
  })
}

/** Offer from the source wallet, claim into the game wallet. A new call resumes from on-chain caps. */
export const import_wallet_assets = async (
  input: WalletImportContext,
  options: WalletImportOptions
): Promise<WalletImportPlan> => {
  const context = canonical(input)
  const { client, source_sdk, source, owner_sdk, owner } = context
  const { before_sign } = options
  before_sign()
  // An earlier submission with an unknown outcome is settled by its digest before anything is read or signed.
  const recovered = await Promise.all([
    source_sdk.recover_pending_transaction(),
    owner_sdk.recover_pending_transaction(),
  ])
  if (recovered.some(Boolean)) throw new Error('[sdk] previous transaction recovered; reload before importing')
  const plan = await read_wallet_import(context, options.character_slots)
  const batch_limits = await read_agent_batch_limits(client)
  const source_kiosk_cap: KioskCapLoader = async (id) => {
    const caps = await read_personal_kiosks(source_sdk, source)
    return (id ? caps.find(({ kioskId }) => kioskId === id) : caps[0]) ?? null
  }
  const offer = agent_transfer_actions(source_sdk, {
    address: source,
    kiosk_cap: source_kiosk_cap,
    budget: 'estimate',
    batch_limits,
    assets: { client, recipient: () => owner },
    check_offer: async (intent) => {
      before_sign()
      if (intent.recipient !== owner) throw new Error('The import recipient changed.')
      const current = await read_agent_equipment(client, source_sdk.game_type_package!, intent.character_id)
      if (!same_agent_equipment(current, intent.unequip))
        throw new Error('Equipment changed. Refresh before importing.')
    },
  })
  // The session's own loader keeps a kiosk created by the first claim, so later claims reuse it.
  const claim = agent_transfer_actions(owner_sdk, {
    address: owner,
    kiosk_cap: context.owner_kiosk_cap,
    budget: 'estimate',
    batch_limits,
    assets: { client },
    check_return: (intent) => check_agent_return(client, owner_sdk, owner, intent),
  })
  const synchronize = () => Promise.all([source_sdk.synchronize_transactions(), owner_sdk.synchronize_transactions()])
  let moved = 0
  let claiming = 0
  const before_step = async (actions: AgentTransferActions, intent: AgentTransferIntent): Promise<void> => {
    before_sign()
    await synchronize()
    const signer = actions.sender === owner ? 'owner' : 'source'
    const quote = await actions.quote(intent)
    const balance = BigInt((await client.core.getBalance({ owner: actions.sender })).balance.balance)
    if (balance < quote.required_mist) throw new WalletImportFundingRequired(signer, quote.required_mist)
    moved += claiming
    claiming = signer === 'owner' ? intent_assets(intent) : 0
    options.on_progress?.({ signer, moved, total: plan.assets })
    before_sign()
  }
  const hooks = { before_sign, before_step }
  await claim_agent_batches(claim, source, plan.pending.characters, plan.pending.items, hooks)
  if (plan.characters.length || plan.items.length)
    await complete_agent_batches({
      ...hooks,
      offer,
      claim,
      recipient: owner,
      characters: plan.characters,
      items: plan.items,
      read: {
        characters: async () => {
          await synchronize()
          return read_agent_returns(client, source_sdk, owner, source)
        },
        items: async () => {
          await synchronize()
          return read_agent_item_returns(client, source_sdk, owner, source)
        },
      },
    })
  options.on_progress?.({ signer: 'owner', moved: plan.assets, total: plan.assets })
  return plan
}
