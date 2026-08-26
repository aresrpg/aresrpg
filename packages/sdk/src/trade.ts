// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The trade escrow builder — the app's ONE door to the Trade object. Creation projects only
// its deterministic identity; every existing-object action returns certified completion and
// the indexer's object-write stream remains the sole source of the mutable Trade row.

import type { CharacterRow, ItemRow, TradeCapRow, TradeRow } from '@aresrpg/protocol'
import type { Transaction, TransactionObjectArgument } from '@mysten/sui/transactions'

import { SDK } from './client.ts'
import { created_object_id, receipt_digest } from './cache.ts'
import { resolve_marketplace_transfer } from './marketplace.ts'
import { merge_stacks_ptb } from './stacks.ts'
import type { KioskCapLoader } from './kiosk_runner.ts'

type GameSdk = ReturnType<typeof SDK>

export type TradeReceipt = { digest: string; trade: TradeRow }

const type_package = (sdk: GameSdk): string => {
  const value = sdk.game_type_package
  if (!value) throw new Error('Trade transaction unavailable: pins.json has no defining package id for this network.')
  return value
}

const type_tag = (sdk: GameSdk, kind: 'item' | 'character'): string =>
  `${type_package(sdk)}::${kind}::${kind === 'item' ? 'Item' : 'Character'}`

const list_with_purchase_cap = (
  tx: Transaction,
  kiosk: TransactionObjectArgument,
  kiosk_cap: TransactionObjectArgument,
  object: string,
  item_type: string
) =>
  tx.moveCall({
    target: '0x2::kiosk::list_with_purchase_cap',
    typeArguments: [item_type],
    arguments: [kiosk, kiosk_cap, tx.pure.id(object), tx.pure.u64(0)],
  })

const own_side = (trade: TradeRow, address: string): 'a' | 'b' => {
  if (trade.a === address) return 'a'
  if (trade.b === address) return 'b'
  throw new Error('The connected address is not a party to this trade.')
}

export const trade_is_drained = (trade: TradeRow): boolean =>
  trade.caps_a.length === 0 && trade.caps_b.length === 0 && BigInt(trade.sui_a) === 0n && BigInt(trade.sui_b) === 0n

// ── the doors ──

export const trade_create = async (
  sdk: GameSdk,
  { address, counterparty }: { address: string; counterparty: string }
): Promise<TradeReceipt> => {
  const tx = sdk.tx()
  sdk.doors.trade_create(tx, { counterparty })
  const receipt = await sdk.execute(tx, { include: { objectTypes: true } })
  const trade_id = created_object_id(receipt, '::trade::Trade')
  if (!trade_id) throw new Error('The create receipt exposed no Trade object.')
  return {
    digest: receipt_digest(receipt),
    trade: {
      id: trade_id,
      a: address,
      b: counterparty,
      version: 0,
      accept_a: false,
      accept_b: false,
      locked: false,
      sui_a: '0',
      sui_b: '0',
      caps_a: [],
      caps_b: [],
    },
  }
}

export type TradeActionsCtx = {
  trade: TradeRow
  address: string
  kiosk_cap: KioskCapLoader
}

/** The builder: one trade, one party, every mutation. Rebuild it from the fresh row after each
 *  action — `accept` pins the exact version this instance rendered, which is the point. */
export const trade_actions = (sdk: GameSdk, { trade, address, kiosk_cap }: TradeActionsCtx) => {
  const submit = async (compose: (tx: Transaction) => void): Promise<Readonly<{ digest: string }>> => {
    await sdk.hydrate_unknown([trade.id])
    const tx = sdk.tx()
    compose(tx)
    const receipt = await sdk.execute(tx)
    return { digest: receipt_digest(receipt) }
  }

  const cap_for = async (kiosk?: string) => {
    const cap = await kiosk_cap(kiosk)
    if (!cap) throw new Error('No personal kiosk is available for this trade action.')
    return cap
  }

  const deposit_cap = async (kind: 'item' | 'character', cap: TradeCapRow) => {
    const owner = await cap_for(cap.kiosk)
    return submit((tx) => {
      sdk.with_owner_kiosk(tx, owner, (kiosk, owner_cap) => {
        const purchase_cap = list_with_purchase_cap(tx, kiosk, owner_cap, cap.object, type_tag(sdk, kind))
        if (kind === 'item') sdk.doors.trade_put_i(tx, { t: trade.id, cap: purchase_cap })
        else sdk.doors.trade_put_c(tx, { t: trade.id, cap: purchase_cap, kiosk, kiosk_cap: owner_cap })
      })
    })
  }

  return {
    deposit_item: async (item: ItemRow) =>
      deposit_cap('item', {
        object: item.id,
        kind: 'item',
        name: item.name,
        level: item.level,
        amount: item.amount,
        classe: null,
        item_type: item.item_type,
        category: item.category,
        kiosk: item.kiosk,
      }),

    deposit_character: async (character: CharacterRow) =>
      deposit_cap('character', {
        object: character.id,
        kind: 'character',
        name: character.name,
        level: character.level,
        amount: 1,
        classe: character.classe,
        item_type: null,
        category: null,
        kiosk: character.kiosk,
      }),

    withdraw_cap: async (cap: TradeCapRow) => {
      const owner = await cap_for(cap.kiosk)
      return submit((tx) => {
        sdk.with_owner_kiosk(tx, owner, (kiosk) => {
          const purchase_cap =
            cap.kind === 'item'
              ? sdk.doors.trade_take_i(tx, { t: trade.id, item: cap.object })
              : sdk.doors.trade_take_c(tx, { t: trade.id, item: cap.object })
          tx.moveCall({
            target: '0x2::kiosk::return_purchase_cap',
            typeArguments: [type_tag(sdk, cap.kind)],
            arguments: [kiosk, purchase_cap],
          })
        })
      })
    },

    deposit_sui: async (amount: bigint) => {
      if (amount <= 0n) throw new Error('Deposit amount must be positive.')
      own_side(trade, address)
      return submit((tx) => {
        sdk.doors.trade_put_s(tx, { t: trade.id, coin: sdk.coin_of(tx, amount) })
      })
    },

    withdraw_sui: async (amount: bigint) => {
      if (amount <= 0n) throw new Error('Withdrawal amount must be positive.')
      const side = own_side(trade, address)
      if (BigInt(trade[side === 'a' ? 'sui_a' : 'sui_b']) < amount)
        throw new Error('The rendered escrow balance is lower than that withdrawal.')
      return submit((tx) => {
        const coin = sdk.doors.trade_take_s(tx, { t: trade.id, amount })
        tx.transferObjects([coin], tx.pure.address(address))
      })
    },

    accept: async () => {
      own_side(trade, address)
      return submit((tx) => {
        sdk.doors.trade_accept(tx, { t: trade.id, seen_version: trade.version })
      })
    },

    claim_sui: async () => {
      own_side(trade, address)
      return submit((tx) => {
        const coin = sdk.doors.trade_get_s(tx, { t: trade.id })
        tx.transferObjects([coin], tx.pure.address(address))
      })
    },

    claim_cap: async (cap: TradeCapRow, existing: Readonly<{ id: string; kiosk: string }> | null = null) => {
      await sdk.hydrate_unknown([cap.kiosk])
      const side = own_side(trade, address)
      if (!trade.locked) throw new Error('Trade items can be claimed only after both parties accept.')
      const offered = side === 'a' ? trade.caps_b : trade.caps_a
      if (!offered.some(({ object }) => object === cap.object))
        throw new Error('That item is not in the counterparty escrow.')
      const owner = await cap_for(existing?.kiosk)
      return submit((tx) => {
        sdk.with_owner_kiosk(tx, owner, (buyer_kiosk, buyer_cap) => {
          const [purchased, request] = (cap.kind === 'item'
            ? sdk.doors.trade_get_i(tx, { t: trade.id, item: cap.object, source: cap.kiosk })
            : sdk.doors.trade_get_c(tx, { t: trade.id, item: cap.object, source: cap.kiosk })) as unknown as [
            TransactionObjectArgument,
            TransactionObjectArgument,
          ]
          resolve_marketplace_transfer(sdk, tx, cap.kind, cap.object, 0n, buyer_kiosk, buyer_cap, purchased, request)
          if (cap.kind === 'item' && existing)
            merge_stacks_ptb(
              sdk,
              tx,
              { kiosk: buyer_kiosk, cap: buyer_cap },
              { target_id: existing.id, source_id: cap.object }
            )
        })
      })
    },

    destroy: async (): Promise<{ digest: string }> => {
      await sdk.hydrate_unknown([trade.id])
      const tx = sdk.tx()
      sdk.doors.trade_destroy(tx, { t: trade.id })
      const receipt = await sdk.execute(tx)
      return { digest: receipt_digest(receipt) }
    },
  }
}

export type TradeActions = ReturnType<typeof trade_actions>
