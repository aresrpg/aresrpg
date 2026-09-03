// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Native Kiosk marketplace actions. The app supplies projected custody and never touches Sui.

import { marketplace_lot_sizes } from '@aresrpg/immutable'
import type { Transaction, TransactionArgument, TransactionObjectArgument } from '@mysten/sui/transactions'

import type { Sdk } from './client.ts'
import { created_object_id, receipt_digest } from './cache.ts'
import { create_kiosk_runner, resolve_kiosk_cap, retry_stale_kiosk_ref, type KioskCapLoader } from './kiosk_runner.ts'
import { merge_stacks_ptb, split_stack_ptb } from './stacks.ts'

export const ROYALTY_FLOOR_MIST = 10_000_000n

export type MarketplaceAsset = Readonly<{
  kind: 'item' | 'character'
  id: string
  kiosk: string
  price_mist: bigint
  amount?: number
  source_amount?: number
  existing?: string | null
  destination_kiosk?: string | null
  merge_sources?: readonly string[]
}>

export type MarketplaceActions = Readonly<{
  list: (asset: MarketplaceAsset) => Promise<Readonly<{ digest: string; listed_id: string }>>
  delist: (asset: Omit<MarketplaceAsset, 'price_mist'>) => Promise<Readonly<{ digest: string }>>
  buy: (asset: MarketplaceAsset) => Promise<Readonly<{ digest: string }>>
  collect: (kiosks: readonly string[]) => Promise<Readonly<{ digest: string }>>
}>

type MarketplaceContext = Readonly<{
  address: string
  kiosk_cap: KioskCapLoader
}>

const required = (value: unknown, name: string): string => {
  if (typeof value !== 'string' || !value) throw new Error(`Marketplace ${name} is not published on this network.`)
  return value
}

const asset_type = (sdk: Sdk, kind: MarketplaceAsset['kind']): string => {
  const origin = required(sdk.game_type_package, 'type package')
  return `${origin}::${kind}::${kind === 'item' ? 'Item' : 'Character'}`
}

const policy_id = (sdk: Sdk, kind: MarketplaceAsset['kind']): string =>
  required(
    (sdk.pins[kind === 'item' ? 'item_policy' : 'character_policy'] as { id?: string } | undefined)?.id,
    `${kind} policy`
  )

export const resolve_marketplace_transfer = (
  sdk: Sdk,
  tx: Transaction,
  kind: MarketplaceAsset['kind'],
  asset_id: string,
  price_mist: bigint,
  buyer_kiosk: TransactionObjectArgument,
  buyer_cap: TransactionObjectArgument,
  purchased: TransactionObjectArgument,
  request: TransactionObjectArgument
): void => {
  const type = asset_type(sdk, kind)
  const policy = policy_id(sdk, kind)
  const package_id = required(sdk.pins.package, 'package')
  const kiosk_package = required(sdk.pins.kiosk_package, 'Kiosk package')
  const fee = tx.moveCall({
    target: `${kiosk_package}::royalty_rule::fee_amount`,
    typeArguments: [type],
    arguments: [tx.object(policy), tx.pure.u64(price_mist)],
  })
  const [fee_coin] = tx.splitCoins(tx.gas, [fee])
  tx.moveCall({
    target: `${kiosk_package}::royalty_rule::pay`,
    typeArguments: [type],
    arguments: [tx.object(policy), request, fee_coin],
  })
  if (kind === 'item') {
    for (const rule of ['listing_rule', 'lot_rule'])
      tx.moveCall({
        target: `${package_id}::${rule}::prove`,
        arguments: [
          purchased,
          request,
          tx.object(required((sdk.pins.version as { id?: string } | undefined)?.id, 'version')),
        ],
      })
  }
  tx.moveCall({
    target: '0x2::kiosk::lock',
    typeArguments: [type],
    arguments: [buyer_kiosk, buyer_cap, tx.object(policy), purchased],
  })
  tx.moveCall({
    target: `${kiosk_package}::kiosk_lock_rule::prove`,
    typeArguments: [type],
    arguments: [request, buyer_kiosk],
  })
  tx.moveCall({
    target: `${kiosk_package}::personal_kiosk_rule::prove`,
    typeArguments: [type],
    arguments: [buyer_kiosk, request],
  })
  if (kind === 'character') {
    const [character, promise] = tx.moveCall({
      target: '0x2::kiosk::borrow_val',
      typeArguments: [type],
      arguments: [buyer_kiosk, buyer_cap, tx.pure.id(asset_id)],
    }) as unknown as [TransactionObjectArgument, TransactionArgument]
    tx.moveCall({
      target: `${package_id}::naked_rule::prove`,
      arguments: [
        character,
        request,
        tx.object(required((sdk.pins.version as { id?: string } | undefined)?.id, 'version')),
      ],
    })
    tx.moveCall({
      target: '0x2::kiosk::return_val',
      typeArguments: [type],
      arguments: [buyer_kiosk, character, promise],
    })
  }
  tx.moveCall({
    target: '0x2::transfer_policy::confirm_request',
    typeArguments: [type],
    arguments: [tx.object(policy), request],
  })
}

export const marketplace_actions = (sdk: Sdk, { address, kiosk_cap }: MarketplaceContext): MarketplaceActions => {
  const runner = create_kiosk_runner(sdk, kiosk_cap)
  return Object.freeze({
    list: async ({ kind, id, kiosk, price_mist, amount, source_amount, merge_sources = [] }) => {
      if (price_mist <= 0n) throw new Error('A marketplace price must be positive.')
      if (amount !== undefined && (!Number.isSafeInteger(amount) || amount < 1))
        throw new Error('A marketplace lot amount must be a positive safe integer.')
      if (source_amount !== undefined && amount !== undefined && amount > source_amount)
        throw new Error('A marketplace lot cannot exceed its source stack.')
      if (source_amount !== undefined && (!Number.isSafeInteger(source_amount) || source_amount < 1))
        throw new Error('A marketplace source amount must be a positive safe integer.')
      if (amount !== undefined && !marketplace_lot_sizes.includes(amount as (typeof marketplace_lot_sizes)[number]))
        throw new Error('Stackable marketplace lots must be 1, 10, 100, or 1000.')
      if (kind !== 'item' && merge_sources.length > 0) throw new Error('Only item stacks can merge before listing.')
      if (new Set(merge_sources).size !== merge_sources.length)
        throw new Error('A marketplace merge source may appear only once.')
      const receipt = await runner.with_kiosk(
        (tx, owned_kiosk, owner_cap) => {
          for (const source_id of merge_sources) {
            if (source_id === id) throw new Error('A stack cannot merge into itself.')
            merge_stacks_ptb(sdk, tx, { kiosk: owned_kiosk, cap: owner_cap }, { target_id: id, source_id })
          }
          if (kind === 'item' && amount !== undefined && source_amount !== undefined && amount < source_amount) {
            const lot_id = split_stack_ptb(sdk, tx, { kiosk: owned_kiosk, cap: owner_cap }, { item_id: id, amount })
            tx.moveCall({
              target: '0x2::kiosk::list',
              typeArguments: [asset_type(sdk, 'item')],
              arguments: [owned_kiosk, owner_cap, lot_id, tx.pure.u64(price_mist)],
            })
            return
          }
          tx.moveCall({
            target: '0x2::kiosk::list',
            typeArguments: [asset_type(sdk, kind)],
            arguments: [owned_kiosk, owner_cap, tx.pure.id(id), tx.pure.u64(price_mist)],
          })
        },
        { custody: { kiosk }, include: { objectTypes: true } }
      )
      const listed_id =
        kind === 'item' && amount !== undefined && source_amount !== undefined && amount < source_amount
          ? created_object_id(receipt, '::item::Item')
          : id
      if (!listed_id) throw new Error('The split listing receipt carried no created item id.')
      return Object.freeze({ digest: receipt_digest(receipt), listed_id })
    },
    delist: async ({ kind, id, kiosk, existing }) => {
      const receipt = await runner.with_kiosk(
        (tx, owned_kiosk, owner_cap) => {
          tx.moveCall({
            target: '0x2::kiosk::delist',
            typeArguments: [asset_type(sdk, kind)],
            arguments: [owned_kiosk, owner_cap, tx.pure.id(id)],
          })
          if (kind === 'item' && existing)
            merge_stacks_ptb(sdk, tx, { kiosk: owned_kiosk, cap: owner_cap }, { target_id: existing, source_id: id })
        },
        { custody: { kiosk } }
      )
      return Object.freeze({ digest: receipt_digest(receipt) })
    },
    buy: async ({ kind, id, kiosk: seller_kiosk, price_mist, existing, destination_kiosk }) => {
      if (price_mist <= 0n) throw new Error('A marketplace price must be positive.')
      if (existing && !destination_kiosk) throw new Error('A marketplace merge target must name its kiosk.')
      const receipt = await runner.with_kiosk(
        (tx, buyer_kiosk, buyer_cap) => {
          const [payment] = tx.splitCoins(tx.gas, [price_mist])
          const [purchased, request] = tx.moveCall({
            target: '0x2::kiosk::purchase',
            typeArguments: [asset_type(sdk, kind)],
            arguments: [tx.object(seller_kiosk), tx.pure.id(id), payment],
          }) as unknown as [TransactionObjectArgument, TransactionObjectArgument]
          resolve_marketplace_transfer(sdk, tx, kind, id, price_mist, buyer_kiosk, buyer_cap, purchased, request)
          if (kind === 'item' && existing)
            merge_stacks_ptb(sdk, tx, { kiosk: buyer_kiosk, cap: buyer_cap }, { target_id: existing, source_id: id })
        },
        { custody: destination_kiosk ? { kiosk: destination_kiosk } : undefined }
      )
      return Object.freeze({ digest: receipt_digest(receipt) })
    },
    collect: async (kiosks) => {
      if (kiosks.length === 0) throw new Error('No marketplace proceeds are available.')
      const receipt = await retry_stale_kiosk_ref(async (fresh) => {
        const owners = await Promise.all(kiosks.map((kiosk) => resolve_kiosk_cap(kiosk_cap, { kiosk }, fresh)))
        const tx = sdk.tx()
        owners.forEach((owner, index) => {
          if (!owner) throw new Error(`No personal kiosk cap is available for ${kiosks[index]}.`)
          sdk.with_owner_kiosk(tx, owner, (owned_kiosk, owner_cap) => {
            const coin = tx.moveCall({
              target: '0x2::kiosk::withdraw',
              arguments: [owned_kiosk, owner_cap, tx.pure.option('u64', null)],
            })
            tx.transferObjects([coin], address)
          })
        })
        return sdk.execute(tx)
      })
      return Object.freeze({ digest: receipt_digest(receipt) })
    },
  })
}
