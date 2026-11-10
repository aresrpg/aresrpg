// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { normalizeSuiAddress, normalizeStructTag } from '@mysten/sui/utils'
import { Transaction, type TransactionObjectArgument } from '@mysten/sui/transactions'

import type { Sdk } from './client.ts'
import { read_personal_kiosks } from './kiosk_discovery.ts'
import { read_agent_equipment } from './agent_equipment.ts'
import { read_agent_item_returns, type AgentItemReturnOffer } from './agent_returns.ts'
import { resolve_marketplace_transfer, collect_marketplace_ptb, delist_asset_ptb } from './marketplace.ts'
import { kares_payment } from './kares_ptb.ts'
import { create_kares_transaction } from './kares_actions.ts'

export type RecallItem = Readonly<{
  item_id: string
  kiosk: string
  version: string
  direct?: boolean
  character_id?: string
  slot?: string
}>
export type AgentAssetIntent =
  | Readonly<{ kind: 'asset_collect'; items: readonly Readonly<{ kiosk: string }>[] }>
  | Readonly<{ kind: 'asset_delist'; items: readonly RecallItem[] }>
  | Readonly<{
      kind: 'asset_offer'
      recipient: string
      items: readonly RecallItem[]
      sui_mist: string
      kares_mist: string
      reserve_mist: string
    }>
  | Readonly<{ kind: 'asset_claim' | 'asset_cancel'; agent_address: string; items: readonly AgentItemReturnOffer[] }>
  | Readonly<{ kind: 'asset_unstake'; items: readonly Readonly<{ id: string; amount: string }>[] }>

export const is_asset_intent = (intent: Readonly<{ kind: string }>): intent is AgentAssetIntent =>
  ['asset_offer', 'asset_claim', 'asset_cancel', 'asset_unstake', 'asset_collect', 'asset_delist'].includes(intent.kind)

const amount = (value: string): bigint => {
  if (!/^\d+$/.test(value)) throw new Error('Enter a nonnegative integer token amount.')
  return BigInt(value)
}
const unique = (ids: readonly string[]) => {
  if (new Set(ids).size !== ids.length) throw new Error('Select each asset once.')
}

const offer_items = async (
  client: SuiGrpcClient,
  sdk: Sdk,
  sender: string,
  intent: Extract<AgentAssetIntent, { kind: 'asset_offer' }>,
  tx: Transaction
) => {
  const caps = await read_personal_kiosks(sdk, sender)
  const direct = intent.items.filter((item) => item.direct)
  if (direct.length) await offer_direct_items(client, sdk, sender, direct, intent.recipient, tx, caps[0] ?? null)
  for (const kiosk_id of new Set(intent.items.filter((item) => !item.direct).map((item) => item.kiosk))) {
    const cap = caps.find((row) => row.kioskId === kiosk_id)
    if (!cap) throw new Error('The selected asset kiosk is no longer owned by this multisig.')
    const kiosk = await sdk.get_kiosk(kiosk_id)
    const chosen = intent.items.filter((item) => !item.direct && item.kiosk === kiosk_id)
    const { objects } = await client.core.getObjects({ objectIds: chosen.map(({ item_id }) => item_id) })
    const versions = new Map(
      objects.map((object) => {
        if (object instanceof Error) throw new Error('Selected item revisions are unavailable.', { cause: object })
        return [object.objectId, object.version] as const
      })
    )
    if (versions.size !== chosen.length) throw new Error('Selected item revisions are incomplete.')
    await Promise.all(chosen.map((item) => check_selected_item(client, sdk, kiosk, item, versions.get(item.item_id))))
    await sdk.hydrate(chosen.map((item) => item.item_id))
    sdk.with_personal_kiosk(tx, cap, (kiosk, owner) => {
      const purchase_caps = chosen.map((item) => {
        if (item.character_id && item.slot)
          sdk.doors.unequip_item(tx, {
            kiosk,
            cap: owner,
            character_id: item.character_id,
            slot: item.slot,
            receiving: item.item_id,
          })
        return item_purchase_cap(sdk, tx, kiosk, owner, item.item_id)
      })
      tx.transferObjects(purchase_caps, intent.recipient)
    })
  }
}
const check_selected_item = async (
  client: SuiGrpcClient,
  sdk: Sdk,
  kiosk: Awaited<ReturnType<Sdk['get_kiosk']>>,
  item: RecallItem,
  version: string | undefined
) => {
  if (version !== item.version) throw new Error('Selected item version changed. Refresh before signing.')
  if (item.character_id) {
    if (!kiosk.items.some((row) => row.objectId === item.character_id && !row.listing))
      throw new Error('The equipped character is unavailable or listed. Resolve custody first.')
    const gear = await read_agent_equipment(client, sdk.game_type_package!, item.character_id)
    if (!gear.some((row) => row.item_id === item.item_id && row.slot === item.slot))
      throw new Error('Selected equipment changed.')
    return
  }
  const row = kiosk.items.find((row) => row.objectId === item.item_id)
  if (
    !row ||
    row.listing ||
    normalizeStructTag(row.type) !== normalizeStructTag(`${sdk.game_type_package}::item::Item`)
  )
    throw new Error('Selected item is unavailable or listed. Cancel its listing first.')
}

export const compose_agent_assets = async (
  client: SuiGrpcClient,
  sdk: Sdk,
  sender: string,
  intent: AgentAssetIntent,
  recipient?: string,
  transaction?: Transaction
): Promise<Transaction> => {
  if (intent.kind === 'asset_collect') {
    unique(intent.items.map((row) => row.kiosk))
    if (!intent.items.length) throw new Error('Select kiosk proceeds.')
    const caps = await read_personal_kiosks(sdk, sender)
    return collect_marketplace_ptb(
      sdk,
      sender,
      intent.items.map((row) => row.kiosk),
      async (id) => caps.find((cap) => cap.kioskId === id) ?? null
    )
  }
  if (intent.kind === 'asset_delist') return compose_asset_delist(sdk, sender, intent.items)
  if (intent.kind === 'asset_unstake') {
    unique(intent.items.map((row) => row.id))
    if (!intent.items.length) throw new Error('Select a staking position.')
    const ids = intent.items.map(({ id }) => id)
    await sdk.hydrate(ids)
    const withdrawals = intent.items
      .map((row) => ({ id: row.id, amount: amount(row.amount) }))
      .filter((row) => row.amount > 0n)
    const tx = withdrawals.length
      ? await create_kares_transaction({ sdk, address: sender }, { kind: 'withdraw', withdrawals })
      : new Transaction()
    return create_kares_transaction({ sdk, address: sender }, { kind: 'claim', ids }, tx)
  }
  if (intent.kind !== 'asset_offer') return claim_items(client, sdk, sender, intent)
  return compose_asset_offer(client, sdk, sender, intent, recipient, transaction)
}

const compose_asset_offer = async (
  client: SuiGrpcClient,
  sdk: Sdk,
  sender: string,
  intent: Extract<AgentAssetIntent, { kind: 'asset_offer' }>,
  recipient?: string,
  transaction?: Transaction
) => {
  if (normalizeSuiAddress(intent.recipient) !== recipient)
    throw new Error('Asset recovery must return to the current Google owner.')
  unique(intent.items.map((row) => row.item_id))
  const sui = amount(intent.sui_mist)
  const kares = amount(intent.kares_mist)
  if ([!intent.items.length, sui === 0n, kares === 0n].every(Boolean))
    throw new Error('Select assets or an amount to recover.')
  amount(intent.reserve_mist)
  const tx = transaction ?? sdk.tx()
  tx.setSender(sender)
  await offer_items(client, sdk, sender, intent, tx)
  const coins = []
  if (sui > 0n) coins.push(tx.splitCoins(tx.gas, [sui])[0]!)
  if (kares > 0n) coins.push(kares_payment(sdk, tx, kares))
  if (coins.length) tx.transferObjects(coins, intent.recipient)
  return tx
}

const claim_items = async (
  client: SuiGrpcClient,
  sdk: Sdk,
  sender: string,
  intent: Extract<AgentAssetIntent, { kind: 'asset_claim' | 'asset_cancel' }>
) => {
  await check_agent_item_claims(client, sdk, sender, intent)
  const tx = sdk.tx()
  tx.setSender(sender)
  const type = `${sdk.game_type_package}::item::Item`
  if (intent.kind === 'asset_cancel') {
    for (const item of intent.items)
      tx.moveCall({
        target: '0x2::kiosk::return_purchase_cap',
        typeArguments: [type],
        arguments: [tx.object(item.seller_kiosk), tx.object(item.purchase_cap)],
      })
    return tx
  }
  const caps = await read_personal_kiosks(sdk, sender)
  sdk.with_personal_kiosk(tx, caps[0] ?? null, (kiosk, cap) => {
    claim_agent_items(sdk, tx, kiosk, cap, intent.items)
  })
  return tx
}

/** Full current fee budget plus the user's explicit reserve, re-read immediately before signing. */
export const check_asset_reserve = async (sdk: Sdk, sender: string, intent: AgentAssetIntent, tx: Transaction) => {
  if (intent.kind !== 'asset_offer') return
  const { budget } = tx.getData().gasData
  if (!budget) throw new Error('Gas budget is unavailable.')
  const balance = await sdk.sui_client.core.getBalance({ owner: sender })
  if (BigInt(balance.balance.balance) < amount(intent.sui_mist) + BigInt(budget) + amount(intent.reserve_mist))
    throw new Error('GasBalanceTooLow: insufficient SUI for the selected amount, transaction gas and retained reserve.')
}

const compose_asset_delist = async (sdk: Sdk, sender: string, items: readonly RecallItem[]) => {
  unique(items.map((row) => row.item_id))
  if (!items.length) throw new Error('Select listed items.')
  const caps = await read_personal_kiosks(sdk, sender)
  const tx = sdk.tx()
  tx.setSender(sender)
  for (const item of items) {
    const cap = caps.find((cap) => cap.kioskId === item.kiosk)
    if (!cap) throw new Error('The listed kiosk is no longer owned.')
    const kiosk = await sdk.get_kiosk(item.kiosk)
    const row = kiosk.items.find((row) => row.objectId === item.item_id)
    if (!row) throw new Error('The listed item is unavailable.')
    const valid = [
      row.listing !== undefined,
      row.listing?.isExclusive === false,
      row.type === `${sdk.game_type_package}::item::Item`,
    ]
    if (!valid.every(Boolean)) throw new Error('Listing changed or is an exclusive transfer. Refresh first.')
    sdk.with_personal_kiosk(tx, cap, (kiosk, owner) => delist_asset_ptb(sdk, tx, 'item', item.item_id, kiosk, owner))
  }
  return tx
}

const check_item_revision = async (client: SuiGrpcClient, item: RecallItem) => {
  const { object } = await client.core.getObject({ objectId: item.item_id })
  if (object.version !== item.version) throw new Error('Selected item version changed. Refresh before signing.')
  return object
}
const item_purchase_cap = (
  sdk: Sdk,
  tx: Transaction,
  kiosk: TransactionObjectArgument,
  cap: TransactionObjectArgument,
  id: string
) =>
  tx.moveCall({
    target: '0x2::kiosk::list_with_purchase_cap',
    typeArguments: [`${sdk.game_type_package}::item::Item`],
    arguments: [kiosk, cap, tx.pure.id(id), tx.pure.u64(0)],
  })
const offer_direct_items = async (
  client: SuiGrpcClient,
  sdk: Sdk,
  sender: string,
  items: readonly RecallItem[],
  recipient: string,
  tx: Transaction,
  cap: Awaited<ReturnType<typeof read_personal_kiosks>>[number] | null
) => {
  const objects = await Promise.all(items.map((item) => check_item_revision(client, item)))
  if (
    !objects.every(
      (object) =>
        object.type === `${sdk.game_type_package}::item::Item` &&
        object.owner.$kind === 'AddressOwner' &&
        normalizeSuiAddress(object.owner.AddressOwner) === sender
    )
  )
    throw new Error('Direct item ownership changed. Refresh before signing.')
  await sdk.hydrate(items.map((item) => item.item_id))
  sdk.with_personal_kiosk(tx, cap, (kiosk, owner) => {
    const caps = items.map((item) => {
      tx.moveCall({
        target: '0x2::kiosk::lock',
        typeArguments: [`${sdk.game_type_package}::item::Item`],
        arguments: [kiosk, owner, tx.object((sdk.pins.item_policy as { id: string }).id), tx.object(item.item_id)],
      })
      return item_purchase_cap(sdk, tx, kiosk, owner, item.item_id)
    })
    tx.transferObjects(caps, recipient)
  })
}

export const check_agent_item_claims = async (
  client: SuiGrpcClient,
  sdk: Sdk,
  sender: string,
  intent: Extract<AgentAssetIntent, { kind: 'asset_claim' | 'asset_cancel' }>
) => {
  unique(intent.items.map((row) => row.purchase_cap))
  if (!intent.items.length) throw new Error('Select incoming item returns.')
  const current = await read_agent_item_returns(client, sdk, sender, intent.agent_address)
  if (
    !intent.items.every((item) =>
      current.some((row) =>
        (['item_id', 'seller_kiosk', 'purchase_cap', 'recipient', 'agent_address'] as const).every(
          (key) => row[key] === item[key]
        )
      )
    )
  )
    throw new Error('Incoming item ownership or custody changed. Refresh before signing.')
}

export const claim_agent_items = (
  sdk: Sdk,
  tx: Transaction,
  kiosk: TransactionObjectArgument,
  cap: TransactionObjectArgument,
  items: readonly AgentItemReturnOffer[]
) => {
  const type = `${sdk.game_type_package}::item::Item`
  for (const item of items) {
    const zero = tx.moveCall({ target: '0x2::coin::zero', typeArguments: ['0x2::sui::SUI'] })
    const [purchased, request] = tx.moveCall({
      target: '0x2::kiosk::purchase_with_cap',
      typeArguments: [type],
      arguments: [tx.object(item.seller_kiosk), tx.object(item.purchase_cap), zero],
    })
    resolve_marketplace_transfer(sdk, tx, 'item', item.item_id, 0n, kiosk, cap, purchased!, request!, item.seller_kiosk)
  }
}
