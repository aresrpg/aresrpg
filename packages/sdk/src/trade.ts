// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The one transaction builder for durable p2p exchange. Editable offer writes are exact-
// revision operations and return deterministic receipt projections. Terminal receipts return
// only certified shrink deltas because opposite-side settlement may serialize concurrently.

import { item_is_stackable } from '@aresrpg/immutable'
import { type ItemRow, type TradeCapRow, type TradePhase, type TradeRow } from '@aresrpg/protocol'
import type { KioskOwnerCap } from '@mysten/kiosk'
import type { Transaction, TransactionArgument, TransactionObjectArgument } from '@mysten/sui/transactions'

import { created_object_id, receipt_digest } from './cache.ts'
import { SDK } from './client.ts'
import type { KioskCapLoader } from './kiosk_runner.ts'
import { resolve_marketplace_transfer } from './marketplace.ts'
import { merge_stacks_ptb, split_stack_ptb } from './stacks.ts'
import {
  trade_offer_kiosks,
  trade_offer_post_removal_amounts,
  type TradeOfferAddition,
  type TradeOfferRemoval,
} from './trade_offer.ts'
export type { TradeOfferAddition, TradeOfferRemoval } from './trade_offer.ts'
export { trade_offer_post_removal_amounts } from './trade_offer.ts'

type GameSdk = ReturnType<typeof SDK>
type Side = 'a' | 'b'

export type TradeReceipt = Readonly<{ digest: string; trade: TradeRow }>
export type TradeOfferCommitReceipt = Readonly<{ digest: string; offer_revision: number }>
export type TradeCloseReceipt = Readonly<{ digest: string; trade: string }>
export type TradeTerminalDelta = Readonly<{
  trade: string
  phase: Extract<TradePhase, 'settling' | 'cancelled'>
  offer_revision: number
  remove_caps: readonly string[]
  clear_sui: Side | null
  closed: boolean
}>
export type TradeTerminalReceipt = Readonly<{ digest: string; delta: TradeTerminalDelta }>
export type TradeStackTargets = Readonly<Record<string, Readonly<{ id: string; kiosk: string }> | undefined>>

type SettlementRow = Readonly<{
  cap: TradeCapRow
  target?: Readonly<{ id: string; kiosk: string }>
}>
type SettlementGroup = Readonly<{ owner: KioskOwnerCap; rows: readonly SettlementRow[] }>
const MAX_ITEM_AMOUNT = 0xffff_ffff

const type_package = (sdk: GameSdk): string => {
  const value = sdk.game_type_package
  if (!value) throw new Error('Trade transaction unavailable: pins.json has no defining package id for this network.')
  return value
}

const item_type_tag = (sdk: GameSdk): string => `${type_package(sdk)}::item::Item`

const list_with_purchase_cap = (
  tx: Transaction,
  kiosk: TransactionObjectArgument,
  kiosk_cap: TransactionObjectArgument,
  object: string | TransactionArgument,
  item_type: string
) =>
  tx.moveCall({
    target: '0x2::kiosk::list_with_purchase_cap',
    typeArguments: [item_type],
    arguments: [kiosk, kiosk_cap, typeof object === 'string' ? tx.pure.id(object) : object, tx.pure.u64(0)],
  })

const own_side = (trade: Readonly<TradeRow>, address: string): Side => {
  if (trade.a === address) return 'a'
  if (trade.b === address) return 'b'
  throw new Error('The connected address is not a party to this trade.')
}

const other_side = (side: Side): Side => (side === 'a' ? 'b' : 'a')
const caps_for = (trade: Readonly<TradeRow>, side: Side): readonly TradeCapRow[] => trade[`caps_${side}`]
const sui_for = (trade: Readonly<TradeRow>, side: Side): bigint => BigInt(trade[`sui_${side}`])

export const trade_is_drained = (trade: Readonly<TradeRow>): boolean =>
  caps_for(trade, 'a').length === 0 &&
  caps_for(trade, 'b').length === 0 &&
  sui_for(trade, 'a') === 0n &&
  sui_for(trade, 'b') === 0n

export const trade_incoming = (
  trade: Readonly<TradeRow>,
  address: string
): Readonly<{ side: Side; caps: readonly TradeCapRow[]; sui: bigint }> => {
  const side = other_side(own_side(trade, address))
  return Object.freeze({ side, caps: caps_for(trade, side), sui: sui_for(trade, side) })
}

export const trade_own_offer = (
  trade: Readonly<TradeRow>,
  address: string
): Readonly<{ side: Side; caps: readonly TradeCapRow[]; sui: bigint }> => {
  const side = own_side(trade, address)
  return Object.freeze({ side, caps: caps_for(trade, side), sui: sui_for(trade, side) })
}

const assert_phase = (trade: Readonly<TradeRow>, phase: TradePhase): void => {
  if (trade.phase !== phase) throw new Error(`Trade action requires phase ${phase}; rendered phase is ${trade.phase}.`)
}

const touched_offer = (trade: Readonly<TradeRow>, update: Partial<TradeRow> = {}): TradeRow =>
  Object.freeze({
    ...trade,
    ...update,
    offer_revision: trade.offer_revision + 1,
    accept_a: false,
    accept_b: false,
  })

const projected_caps = (trade: Readonly<TradeRow>, side: Side, caps: readonly TradeCapRow[]): Partial<TradeRow> => ({
  [`caps_${side}`]: Object.freeze(caps),
})

const projected_sui = (side: Side, amount: bigint): Partial<TradeRow> => ({ [`sui_${side}`]: amount.toString() })

export const trade_create = async (
  sdk: GameSdk,
  {
    address,
    counterparty,
    cleanup = [],
  }: Readonly<{ address: string; counterparty: string; cleanup?: readonly string[] }>
): Promise<TradeReceipt> => {
  await sdk.hydrate_unknown(cleanup)
  const tx = sdk.tx()
  for (const trade of cleanup) sdk.doors.trade_close(tx, { t: trade })
  sdk.doors.trade_create(tx, { counterparty })
  const receipt = await sdk.execute(tx, { include: { objectTypes: true } })
  const trade_id = created_object_id(receipt, '::trade::Trade')
  if (!trade_id) throw new Error('The create receipt exposed no Trade object.')
  return Object.freeze({
    digest: receipt_digest(receipt),
    trade: Object.freeze({
      id: trade_id,
      a: address,
      b: counterparty,
      phase: 'requested',
      offer_revision: 0,
      accept_a: false,
      accept_b: false,
      sui_a: '0',
      sui_b: '0',
      caps_a: Object.freeze([]),
      caps_b: Object.freeze([]),
    }),
  })
}

export type TradeActionsCtx = Readonly<{
  trade: TradeRow
  address: string
  kiosk_cap: KioskCapLoader
}>

export const trade_actions = (sdk: GameSdk, { trade, address, kiosk_cap }: TradeActionsCtx) => {
  const side = own_side(trade, address)
  const submit = async (compose: (tx: Transaction) => void): Promise<string> => {
    await sdk.hydrate_unknown([trade.id])
    const tx = sdk.tx()
    compose(tx)
    return receipt_digest(await sdk.execute(tx))
  }
  const cap_for = async (kiosk?: string): Promise<KioskOwnerCap> => {
    const cap = await kiosk_cap(kiosk)
    if (!cap) throw new Error('No personal kiosk is available for this trade action.')
    return cap
  }
  const offer_receipt = async (compose: (tx: Transaction) => void, projected: TradeRow): Promise<TradeReceipt> =>
    Object.freeze({ digest: await submit(compose), trade: projected })
  const own = trade_own_offer(trade, address)
  const incoming = trade_incoming(trade, address)

  const deposit_item = async (cap: TradeCapRow): Promise<TradeReceipt> => {
    assert_phase(trade, 'negotiating')
    const owner = await cap_for(cap.kiosk)
    const caps = Object.freeze([...caps_for(trade, side), cap])
    return offer_receipt(
      (tx) => {
        sdk.with_owner_kiosk(tx, owner, (kiosk, owner_cap) => {
          const purchase_cap = list_with_purchase_cap(tx, kiosk, owner_cap, cap.object, item_type_tag(sdk))
          sdk.doors.trade_put_i(tx, { t: trade.id, cap: purchase_cap, seen_offer_revision: trade.offer_revision })
        })
      },
      touched_offer(trade, projected_caps(trade, side, caps))
    )
  }

  const append_kiosk_offer = (
    tx: Transaction,
    owner: KioskOwnerCap,
    additions: readonly TradeOfferAddition[],
    removals: readonly TradeOfferRemoval[],
    post_removal_amounts: ReadonlyMap<string, number>,
    initial_revision: number
  ): number => {
    let revision = initial_revision
    sdk.with_owner_kiosk(tx, owner, (kiosk_arg, owner_cap) => {
      for (const { cap, target } of removals) {
        const purchase_cap = sdk.doors.trade_take_i(tx, {
          t: trade.id,
          item: cap.object,
          seen_offer_revision: revision,
        })
        revision += 1
        tx.moveCall({
          target: '0x2::kiosk::return_purchase_cap',
          typeArguments: [item_type_tag(sdk)],
          arguments: [kiosk_arg, purchase_cap],
        })
        if (target)
          merge_stacks_ptb(
            sdk,
            tx,
            { kiosk: kiosk_arg, cap: owner_cap },
            { target_id: target.id, source_id: cap.object }
          )
      }
      for (const addition of additions) {
        const available_amount = post_removal_amounts.get(addition.item.id) ?? addition.item.amount
        const object =
          addition.amount === available_amount
            ? addition.item.id
            : split_stack_ptb(
                sdk,
                tx,
                { kiosk: kiosk_arg, cap: owner_cap },
                { item_id: addition.item.id, amount: addition.amount }
              )
        const purchase_cap = list_with_purchase_cap(tx, kiosk_arg, owner_cap, object, item_type_tag(sdk))
        sdk.doors.trade_put_i(tx, { t: trade.id, cap: purchase_cap, seen_offer_revision: revision })
        revision += 1
      }
    })
    return revision
  }

  const append_sui_offer = (tx: Transaction, sui: bigint, initial_revision: number): number => {
    if (sui > own.sui) {
      sdk.doors.trade_put_s(tx, { t: trade.id, coin: sdk.coin_of(tx, sui - own.sui), seen: initial_revision })
      return initial_revision + 1
    }
    if (sui === own.sui) return initial_revision
    const coin = sdk.doors.trade_take_s(tx, { t: trade.id, amount: own.sui - sui, seen: initial_revision })
    tx.transferObjects([coin], tx.pure.address(address))
    return initial_revision + 1
  }

  const commit_offer = async ({
    additions,
    removals,
    sui,
  }: Readonly<{
    additions: readonly TradeOfferAddition[]
    removals: readonly TradeOfferRemoval[]
    sui: bigint
  }>): Promise<TradeOfferCommitReceipt> => {
    assert_phase(trade, 'negotiating')
    const kiosks = trade_offer_kiosks(additions, removals, own.caps, sui, own.sui)
    const post_removal_amounts = trade_offer_post_removal_amounts(removals)
    const owners = new Map(await Promise.all(kiosks.map(async (kiosk) => [kiosk, await cap_for(kiosk)] as const)))
    await sdk.hydrate_unknown([trade.id, ...kiosks])
    const tx = sdk.tx()
    let seen = trade.offer_revision
    for (const kiosk of kiosks)
      seen = append_kiosk_offer(
        tx,
        owners.get(kiosk)!,
        additions.filter(({ item }) => item.kiosk === kiosk),
        removals.filter(({ cap }) => cap.kiosk === kiosk),
        post_removal_amounts,
        seen
      )
    seen = append_sui_offer(tx, sui, seen)
    const receipt = await sdk.execute(tx)
    return Object.freeze({ digest: receipt_digest(receipt), offer_revision: seen })
  }

  const recover_cap_ptb = (tx: Transaction, cap: Readonly<TradeCapRow>, kiosk: TransactionObjectArgument): void => {
    const purchase_cap = sdk.doors.trade_recover_i(tx, { t: trade.id, item: cap.object })
    tx.moveCall({
      target: '0x2::kiosk::return_purchase_cap',
      typeArguments: [item_type_tag(sdk)],
      arguments: [kiosk, purchase_cap],
    })
  }

  const recovery_groups = async (caps: readonly TradeCapRow[]): Promise<readonly SettlementGroup[]> => {
    const kiosks = [...new Set(caps.map(({ kiosk }) => kiosk))]
    const owners = new Map(await Promise.all(kiosks.map(async (kiosk) => [kiosk, await cap_for(kiosk)] as const)))
    return Object.freeze(
      kiosks.map((kiosk) =>
        Object.freeze({
          owner: owners.get(kiosk)!,
          rows: Object.freeze(caps.filter((cap) => cap.kiosk === kiosk).map((cap) => Object.freeze({ cap }))),
        })
      )
    )
  }

  const target_for = (cap: Readonly<TradeCapRow>, targets: TradeStackTargets) => targets[cap.object]

  const coalesced_rows = (rows: readonly SettlementRow[], kiosk: string): readonly SettlementRow[] => {
    const available = new Map<string, readonly Readonly<{ id: string; amount: number }>[]>()
    return Object.freeze(
      rows.map((row) => {
        if (row.target || !item_is_stackable(row.cap.category)) return row
        const targets = available.get(row.cap.item_type) ?? []
        const target = targets.find(({ amount }) => amount + row.cap.amount <= MAX_ITEM_AMOUNT)
        if (target) {
          available.set(
            row.cap.item_type,
            targets.map((candidate) =>
              candidate.id === target.id
                ? Object.freeze({ ...candidate, amount: candidate.amount + row.cap.amount })
                : candidate
            )
          )
          return Object.freeze({ ...row, target: Object.freeze({ id: target.id, kiosk }) })
        }
        available.set(
          row.cap.item_type,
          Object.freeze([...targets, Object.freeze({ id: row.cap.object, amount: row.cap.amount })])
        )
        return row
      })
    )
  }

  const settlement_groups = async (
    caps: readonly TradeCapRow[],
    targets: TradeStackTargets
  ): Promise<readonly SettlementGroup[]> => {
    const target_kiosks = [
      ...new Set(caps.flatMap((cap) => (target_for(cap, targets) ? [target_for(cap, targets)!.kiosk] : []))),
    ]
    const default_owner = caps.some((cap) => !target_for(cap, targets)) ? await cap_for() : null
    const owners = new Map(
      await Promise.all(target_kiosks.map(async (kiosk) => [kiosk, await cap_for(kiosk)] as const))
    )
    const groups = new Map<string, SettlementGroup>()
    for (const cap of caps.toSorted(
      (left, right) =>
        left.item_type.localeCompare(right.item_type) ||
        right.amount - left.amount ||
        left.object.localeCompare(right.object)
    )) {
      const target = target_for(cap, targets)
      const owner = target ? owners.get(target.kiosk) : default_owner
      if (!owner) throw new Error('No destination kiosk is available for this trade asset.')
      const rows = Object.freeze([...(groups.get(owner.kioskId)?.rows ?? []), Object.freeze({ cap, target })])
      groups.set(owner.kioskId, Object.freeze({ owner, rows }))
    }
    return Object.freeze(
      [...groups.values()].map((group) =>
        Object.freeze({ ...group, rows: coalesced_rows(group.rows, group.owner.kioskId) })
      )
    )
  }

  const claim_cap_ptb = (
    tx: Transaction,
    cap: Readonly<TradeCapRow>,
    buyer_kiosk: TransactionObjectArgument,
    buyer_cap: TransactionObjectArgument
  ): void => {
    const [purchased, request] = sdk.doors.trade_get_i(tx, {
      t: trade.id,
      item: cap.object,
      source: cap.kiosk,
    }) as unknown as [TransactionObjectArgument, TransactionObjectArgument]
    resolve_marketplace_transfer(sdk, tx, 'item', cap.object, 0n, buyer_kiosk, buyer_cap, purchased, request)
  }

  const merge_claimed = (
    tx: Transaction,
    row: SettlementRow,
    kiosk: TransactionObjectArgument,
    cap: TransactionObjectArgument
  ): void => {
    if (!row.target || !item_is_stackable(row.cap.category)) return
    merge_stacks_ptb(sdk, tx, { kiosk, cap }, { target_id: row.target.id, source_id: row.cap.object })
  }

  const terminal_delta = (
    phase: TradeTerminalDelta['phase'],
    remove_caps: readonly string[],
    clear_sui: Side | null,
    closed: boolean,
    offer_revision = trade.offer_revision
  ): TradeTerminalDelta =>
    Object.freeze({
      trade: trade.id,
      phase,
      offer_revision,
      remove_caps: Object.freeze(remove_caps),
      clear_sui,
      closed,
    })

  const terminal_receipt = async (
    compose: (tx: Transaction) => void,
    delta: TradeTerminalDelta
  ): Promise<TradeTerminalReceipt> => Object.freeze({ digest: await submit(compose), delta })

  return Object.freeze({
    join: async (): Promise<TradeReceipt> => {
      assert_phase(trade, 'requested')
      if (side !== 'b') throw new Error('Only the invited player can accept a pending trade request.')
      return offer_receipt(
        (tx) => sdk.doors.trade_join(tx, { t: trade.id, seen: trade.offer_revision }),
        touched_offer(trade, { phase: 'negotiating' })
      )
    },

    commit_offer,

    cancel_request: async (): Promise<TradeCloseReceipt> => {
      assert_phase(trade, 'requested')
      if (side !== 'a') throw new Error('Only the inviter can cancel this trade request.')
      const digest = await submit((tx) =>
        sdk.doors.trade_cancel_request(tx, { t: trade.id, seen: trade.offer_revision })
      )
      return Object.freeze({ digest, trade: trade.id })
    },

    decline_request: async (): Promise<TradeCloseReceipt> => {
      assert_phase(trade, 'requested')
      if (side !== 'b') throw new Error('Only the invited player can decline this trade request.')
      const digest = await submit((tx) =>
        sdk.doors.trade_decline_request(tx, { t: trade.id, seen: trade.offer_revision })
      )
      return Object.freeze({ digest, trade: trade.id })
    },

    deposit_item: async (item: ItemRow): Promise<TradeReceipt> =>
      deposit_item({
        object: item.id,
        name: item.name,
        level: item.level,
        amount: item.amount,
        item_type: item.item_type,
        category: item.category,
        kiosk: item.kiosk,
      }),

    withdraw_cap: async (cap: TradeCapRow): Promise<TradeReceipt> => {
      assert_phase(trade, 'negotiating')
      if (!caps_for(trade, side).some(({ object }) => object === cap.object))
        throw new Error('That asset is not in your rendered offer.')
      const owner = await cap_for(cap.kiosk)
      const caps = caps_for(trade, side).filter(({ object }) => object !== cap.object)
      return offer_receipt(
        (tx) => {
          sdk.with_owner_kiosk(tx, owner, (kiosk) => {
            const purchase_cap = sdk.doors.trade_take_i(tx, {
              t: trade.id,
              item: cap.object,
              seen_offer_revision: trade.offer_revision,
            })
            tx.moveCall({
              target: '0x2::kiosk::return_purchase_cap',
              typeArguments: [item_type_tag(sdk)],
              arguments: [kiosk, purchase_cap],
            })
          })
        },
        touched_offer(trade, projected_caps(trade, side, caps))
      )
    },

    set_sui: async (amount: bigint): Promise<TradeReceipt> => {
      assert_phase(trade, 'negotiating')
      if (amount < 0n) throw new Error('The offered SUI amount cannot be negative.')
      if (amount === own.sui) throw new Error('The offered SUI amount is unchanged.')
      return offer_receipt(
        (tx) => {
          if (amount > own.sui)
            sdk.doors.trade_put_s(tx, {
              t: trade.id,
              coin: sdk.coin_of(tx, amount - own.sui),
              seen: trade.offer_revision,
            })
          else {
            const coin = sdk.doors.trade_take_s(tx, {
              t: trade.id,
              amount: own.sui - amount,
              seen: trade.offer_revision,
            })
            tx.transferObjects([coin], tx.pure.address(address))
          }
        },
        touched_offer(trade, projected_sui(side, amount))
      )
    },

    accept: async (): Promise<Readonly<{ digest: string }>> => {
      assert_phase(trade, 'negotiating')
      if (trade[`accept_${side}`]) throw new Error('This offer revision is already accepted.')
      return Object.freeze({
        digest: await submit((tx) => sdk.doors.trade_accept(tx, { t: trade.id, seen: trade.offer_revision })),
      })
    },

    cancel_and_recover: async (): Promise<TradeTerminalReceipt> => {
      assert_phase(trade, 'negotiating')
      await sdk.hydrate_unknown(own.caps.map(({ kiosk }) => kiosk))
      const groups = await recovery_groups(own.caps)
      const closed = incoming.caps.length === 0 && incoming.sui === 0n
      return terminal_receipt(
        (tx) => {
          sdk.doors.trade_cancel(tx, { t: trade.id, seen: trade.offer_revision })
          for (const group of groups)
            sdk.with_owner_kiosk(tx, group.owner, (kiosk) => {
              for (const { cap } of group.rows) recover_cap_ptb(tx, cap, kiosk)
            })
          if (own.sui > 0n) {
            const coin = sdk.doors.trade_recover_s(tx, { t: trade.id })
            tx.transferObjects([coin], tx.pure.address(address))
          }
          if (closed) sdk.doors.trade_close(tx, { t: trade.id })
        },
        terminal_delta(
          'cancelled',
          own.caps.map(({ object }) => object),
          own.sui > 0n ? side : null,
          closed,
          trade.offer_revision + 1
        )
      )
    },

    settle_all: async (targets: TradeStackTargets): Promise<TradeTerminalReceipt> => {
      assert_phase(trade, 'settling')
      if (incoming.caps.length === 0 && incoming.sui === 0n)
        throw new Error('This trade has no remaining consideration to receive.')
      await sdk.hydrate_unknown(incoming.caps.map(({ kiosk }) => kiosk))
      const groups = await settlement_groups(incoming.caps, targets)
      const closed = own.caps.length === 0 && own.sui === 0n
      return terminal_receipt(
        (tx) => {
          for (const group of groups)
            sdk.with_owner_kiosk(tx, group.owner, (kiosk, kiosk_owner_cap) => {
              for (const row of group.rows) {
                claim_cap_ptb(tx, row.cap, kiosk, kiosk_owner_cap)
                merge_claimed(tx, row, kiosk, kiosk_owner_cap)
              }
            })
          if (incoming.sui > 0n) {
            const coin = sdk.doors.trade_get_s(tx, { t: trade.id })
            tx.transferObjects([coin], tx.pure.address(address))
          }
          if (closed) sdk.doors.trade_close(tx, { t: trade.id })
        },
        terminal_delta(
          'settling',
          incoming.caps.map(({ object }) => object),
          incoming.sui > 0n ? incoming.side : null,
          closed
        )
      )
    },

    recover_all: async (): Promise<TradeTerminalReceipt> => {
      assert_phase(trade, 'cancelled')
      if (own.caps.length === 0 && own.sui === 0n) throw new Error('This trade has no remaining offer to recover.')
      await sdk.hydrate_unknown(own.caps.map(({ kiosk }) => kiosk))
      const groups = await recovery_groups(own.caps)
      const closed = incoming.caps.length === 0 && incoming.sui === 0n
      return terminal_receipt(
        (tx) => {
          for (const group of groups)
            sdk.with_owner_kiosk(tx, group.owner, (kiosk) => {
              for (const { cap } of group.rows) recover_cap_ptb(tx, cap, kiosk)
            })
          if (own.sui > 0n) {
            const coin = sdk.doors.trade_recover_s(tx, { t: trade.id })
            tx.transferObjects([coin], tx.pure.address(address))
          }
          if (closed) sdk.doors.trade_close(tx, { t: trade.id })
        },
        terminal_delta(
          'cancelled',
          own.caps.map(({ object }) => object),
          own.sui > 0n ? side : null,
          closed
        )
      )
    },
  })
}

export type TradeActions = ReturnType<typeof trade_actions>
