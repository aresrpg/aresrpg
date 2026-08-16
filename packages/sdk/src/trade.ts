// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The trade escrow builder — the app's ONE door to the Trade object. Each action composes the
// PTB, runs it through the SDK executor, and returns { digest, trade }: the next rendered
// row, derived locally the way the chain will derive it. The app never reads a receipt.

import type { CharacterRow, ItemRow, TradeCapRow, TradeRow } from '@aresrpg/protocol'
import type { KioskOwnerCap } from '@mysten/kiosk'
import type { Transaction, TransactionObjectArgument } from '@mysten/sui/transactions'

import { SDK } from './client.ts'
import { receipt_digest, receipt_event, type Receipt } from './cache.ts'

export type { KioskOwnerCap } from '@mysten/kiosk'

type GameSdk = ReturnType<typeof SDK>

export type TradeReceipt = { digest: string; trade: TradeRow }

const package_id = (sdk: GameSdk): string => {
  const value = sdk.pins.package
  if (!value) throw new Error('Trade transaction unavailable: pins.json has no published package id for this network.')
  return value
}

const type_tag = (sdk: GameSdk, kind: 'item' | 'character'): string =>
  `${package_id(sdk)}::${kind}::${kind === 'item' ? 'Item' : 'Character'}`

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

// ── local projections: the next TradeRow, derived exactly as the contract derives it ──

const trade_touched = (trade: TradeRow): TradeRow => ({
  ...trade,
  version: trade.version + 1,
  accept_a: false,
  accept_b: false,
})

const own_side = (trade: TradeRow, address: string): 'a' | 'b' => {
  if (trade.a === address) return 'a'
  if (trade.b === address) return 'b'
  throw new Error('The connected address is not a party to this trade.')
}

const created_trade_id = (receipt: Receipt): string => {
  const id = receipt_event(receipt, '::trade::TradeCreated')?.trade
  if (typeof id !== 'string')
    throw new Error('The create receipt did not expose its TradeCreated id; the trade was not guessed locally.')
  return id
}

const cap_added = (trade: TradeRow, address: string, cap: TradeCapRow): TradeRow => {
  const side = own_side(trade, address)
  const touched = trade_touched(trade)
  return side === 'a'
    ? { ...touched, caps_a: [...touched.caps_a, cap] }
    : { ...touched, caps_b: [...touched.caps_b, cap] }
}

const cap_removed = (trade: TradeRow, address: string, object: string): TradeRow => {
  const side = own_side(trade, address)
  const touched = trade_touched(trade)
  return side === 'a'
    ? { ...touched, caps_a: touched.caps_a.filter((cap) => cap.object !== object) }
    : { ...touched, caps_b: touched.caps_b.filter((cap) => cap.object !== object) }
}

const sui_changed = (trade: TradeRow, address: string, amount: bigint, direction: 'deposit' | 'withdraw'): TradeRow => {
  const side = own_side(trade, address)
  const key = side === 'a' ? 'sui_a' : 'sui_b'
  const current = BigInt(trade[key])
  const next = direction === 'deposit' ? current + amount : current - amount
  if (next < 0n) throw new Error('The rendered escrow balance is lower than that withdrawal.')
  return { ...trade_touched(trade), [key]: next.toString() }
}

const accepted = (trade: TradeRow, address: string): TradeRow => {
  const side = own_side(trade, address)
  const next = side === 'a' ? { ...trade, accept_a: true } : { ...trade, accept_b: true }
  return { ...next, locked: next.accept_a && next.accept_b }
}

const sui_claimed = (trade: TradeRow, address: string): TradeRow => {
  const side = own_side(trade, address)
  return side === 'a' ? { ...trade, sui_b: '0' } : { ...trade, sui_a: '0' }
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
  const receipt = await sdk.execute(tx)
  return {
    digest: receipt_digest(receipt),
    trade: {
      id: created_trade_id(receipt),
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
  kiosk_cap: KioskOwnerCap | null
}

/** The builder: one trade, one party, every mutation. Rebuild it from the fresh row after each
 *  action — `accept` pins the exact version this instance rendered, which is the point. */
export const trade_actions = (sdk: GameSdk, { trade, address, kiosk_cap }: TradeActionsCtx) => {
  const submit = async (next: TradeRow, compose: (tx: Transaction) => void): Promise<TradeReceipt> => {
    const tx = sdk.tx()
    compose(tx)
    const receipt = await sdk.execute(tx)
    return { digest: receipt_digest(receipt), trade: next }
  }

  const deposit_cap = (kind: 'item' | 'character', cap: TradeCapRow) =>
    submit(cap_added(trade, address, cap), (tx) => {
      sdk.with_owner_kiosk(tx, kiosk_cap, (kiosk, owner_cap) => {
        const purchase_cap = list_with_purchase_cap(tx, kiosk, owner_cap, cap.object, type_tag(sdk, kind))
        if (kind === 'item') sdk.doors.trade_deposit_item_cap(tx, { t: trade.id, cap: purchase_cap })
        else sdk.doors.trade_deposit_character_cap(tx, { t: trade.id, cap: purchase_cap, kiosk, kiosk_cap: owner_cap })
      })
    })

  return {
    deposit_item: async (item: ItemRow) =>
      deposit_cap('item', { object: item.id, name: item.name, item_type: item.item_type }),

    deposit_character: async (character: CharacterRow) =>
      deposit_cap('character', {
        object: character.id,
        name: character.name,
        item_type: type_tag(sdk, 'character'),
      }),

    withdraw_cap: async (cap: TradeCapRow, kind: 'item' | 'character') =>
      submit(cap_removed(trade, address, cap.object), (tx) => {
        sdk.with_owner_kiosk(tx, kiosk_cap, (kiosk) => {
          const purchase_cap =
            kind === 'item'
              ? sdk.doors.trade_withdraw_item_cap(tx, { t: trade.id, item: cap.object })
              : sdk.doors.trade_withdraw_character_cap(tx, { t: trade.id, item: cap.object })
          tx.moveCall({
            target: '0x2::kiosk::return_purchase_cap',
            typeArguments: [type_tag(sdk, kind)],
            arguments: [kiosk, purchase_cap],
          })
        })
      }),

    deposit_sui: async (amount: bigint) => {
      if (amount <= 0n) throw new Error('Deposit amount must be positive.')
      return submit(sui_changed(trade, address, amount, 'deposit'), (tx) => {
        sdk.doors.trade_deposit_sui(tx, { t: trade.id, coin: sdk.coin_of(tx, amount) })
      })
    },

    withdraw_sui: async (amount: bigint) => {
      if (amount <= 0n) throw new Error('Withdrawal amount must be positive.')
      return submit(sui_changed(trade, address, amount, 'withdraw'), (tx) => {
        const coin = sdk.doors.trade_withdraw_sui(tx, { t: trade.id, amount })
        tx.transferObjects([coin], tx.pure.address(address))
      })
    },

    accept: async () =>
      submit(accepted(trade, address), (tx) => {
        sdk.doors.trade_accept(tx, { t: trade.id, seen_version: trade.version })
      }),

    claim_sui: async () =>
      submit(sui_claimed(trade, address), (tx) => {
        const coin = sdk.doors.trade_claim_sui(tx, { t: trade.id })
        tx.transferObjects([coin], tx.pure.address(address))
      }),

    destroy: async (): Promise<{ digest: string }> => {
      const tx = sdk.tx()
      sdk.doors.trade_destroy(tx, { t: trade.id })
      const receipt = await sdk.execute(tx)
      return { digest: receipt_digest(receipt) }
    },
  }
}
