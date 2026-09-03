// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// One selector for amount-bearing inventory. Listed stacks are never mutable merge/burn targets.

import { item_is_stackable } from '@aresrpg/immutable'
import type { ItemRow, ListingRow, TradeCapRow, TradeRow } from '@aresrpg/protocol'

const MAX_STACK_AMOUNT = 4_294_967_295

export const encumbered_asset_ids = (
  listings: readonly Readonly<ListingRow>[],
  trades: readonly Readonly<TradeRow>[]
): ReadonlySet<string> =>
  new Set([
    ...listings.map(({ id }) => id),
    ...trades.flatMap(({ caps_a, caps_b }) => [...caps_a, ...caps_b].map(({ object }) => object)),
  ])

/** Items still projected under a personal kiosk but available for ordinary inventory actions. */
export const available_inventory_items = (
  inventory: readonly Readonly<ItemRow>[],
  encumbered: ReadonlySet<string>,
  kiosk?: string
): readonly Readonly<ItemRow>[] =>
  inventory.filter((item) => (!kiosk || item.kiosk === kiosk) && !encumbered.has(item.id))

export const available_item_stacks = (
  inventory: readonly Readonly<ItemRow>[],
  encumbered: ReadonlySet<string>,
  item_type: string,
  kiosk?: string
): readonly Readonly<ItemRow>[] => {
  return available_inventory_items(inventory, encumbered, kiosk)
    .filter((row) => row.item_type === item_type)
    .toSorted((left, right) => right.amount - left.amount || left.id.localeCompare(right.id))
}

/** The largest unlocked stack absorbs new minted units. Null means the mint must lock a new object. */
export const stack_merge_target = (
  inventory: readonly Readonly<ItemRow>[],
  encumbered: ReadonlySet<string>,
  item_type: string,
  kiosk?: string,
  incoming = 1
): string | null => {
  const target = stack_merge_target_row(inventory, encumbered, item_type, kiosk, incoming)
  return target?.id ?? null
}

export const stack_merge_target_row = (
  inventory: readonly Readonly<ItemRow>[],
  encumbered: ReadonlySet<string>,
  item_type: string,
  kiosk?: string,
  incoming = 1
): Readonly<ItemRow> | null => {
  const target = available_item_stacks(inventory, encumbered, item_type, kiosk).find(
    ({ amount }) => amount + incoming <= MAX_STACK_AMOUNT
  )
  return target && item_is_stackable(target.category) ? target : null
}

/** Capacity-aware trade settlement plan. Existing stacks absorb only what fits; every excess
 * incoming object stays separate instead of turning a valid exchange into an overflow abort. */
export const trade_stack_targets = (
  inventory: readonly Readonly<ItemRow>[],
  encumbered: ReadonlySet<string>,
  incoming: readonly Readonly<TradeCapRow>[],
  options: Readonly<{
    same_kiosk?: boolean
    target_ids?: Readonly<Record<string, string | undefined>>
  }> = Object.freeze({})
): Readonly<Record<string, Readonly<{ id: string; kiosk: string; amount: number }> | undefined>> => {
  const virtual_amounts = new Map(inventory.map(({ id, amount }) => [id, amount]))
  return Object.freeze(
    Object.fromEntries(
      incoming
        .toSorted(
          (left, right) =>
            left.item_type.localeCompare(right.item_type) ||
            right.amount - left.amount ||
            left.object.localeCompare(right.object)
        )
        .flatMap((cap) => {
          if (!item_is_stackable(cap.category)) return []
          const target = available_item_stacks(
            inventory,
            encumbered,
            cap.item_type,
            options.same_kiosk ? cap.kiosk : undefined
          ).find(
            ({ id }) =>
              (!options.target_ids?.[cap.object] || options.target_ids[cap.object] === id) &&
              (virtual_amounts.get(id) ?? 0) + cap.amount <= MAX_STACK_AMOUNT
          )
          if (!target) return []
          virtual_amounts.set(target.id, (virtual_amounts.get(target.id) ?? target.amount) + cap.amount)
          return [[cap.object, Object.freeze({ id: target.id, kiosk: target.kiosk, amount: target.amount })] as const]
        })
    )
  )
}

export const coalesced_stack_groups = (
  inventory: readonly Readonly<ItemRow>[],
  encumbered: ReadonlySet<string>
): readonly Readonly<{
  target: Readonly<ItemRow>
  total_amount: number
  source_ids: readonly string[]
}>[] => {
  const groups = new Map<string, readonly Readonly<ItemRow>[]>()
  for (const row of inventory) {
    if (!item_is_stackable(row.category)) continue
    const key = `${row.kiosk}:${row.item_type}`
    groups.set(key, Object.freeze([...(groups.get(key) ?? []), row]))
  }
  return Object.freeze(
    [...groups.values()].flatMap((rows) => {
      const available = available_item_stacks(rows, encumbered, rows[0]!.item_type, rows[0]!.kiosk)
      const [target, ...sources] = available
      return target
        ? [
            Object.freeze({
              target,
              total_amount: available.reduce((total, row) => total + row.amount, 0),
              source_ids: Object.freeze(sources.map(({ id }) => id)),
            }),
          ]
        : []
    })
  )
}

export type StackMergePlan = Readonly<{
  target_id: string
  source_ids: readonly string[]
  kiosk: string
}>

export type CraftStackPlan = StackMergePlan &
  Readonly<{
    item_type: string
    amount: number
    total_amount: number
  }>

/** One ordered no-dust stack per recipe ingredient. Fragmented holdings become one optional
 *  deterministic merge transaction before the terminal craft. */
export const craft_stack_plan = (
  inputs: Readonly<Record<string, number>>,
  attempts: number,
  inventory: readonly Readonly<ItemRow>[],
  encumbered: ReadonlySet<string>,
  kiosk: string
): readonly CraftStackPlan[] | null => {
  const groups = Object.entries(inputs).map(([item_type, per_attempt]) => {
    const stacks = available_item_stacks(inventory, encumbered, item_type, kiosk)
    const [target, ...sources] = stacks
    const amount = per_attempt * attempts
    const total_amount = stacks.reduce((total, stack) => total + stack.amount, 0)
    if (!target || !item_is_stackable(target.category) || total_amount < amount || total_amount > 4_294_967_295)
      return null
    return Object.freeze({
      item_type,
      target_id: target.id,
      source_ids: Object.freeze(sources.map(({ id }) => id)),
      amount,
      total_amount,
      kiosk,
    })
  })
  return groups.some((group) => group === null) ? null : (groups as readonly CraftStackPlan[])
}

/** Coalesce existing output dust when the worst-case batch still fits one u32 stack. */
export const craft_output_stack_plan = (
  inventory: readonly Readonly<ItemRow>[],
  encumbered: ReadonlySet<string>,
  item_type: string,
  kiosk: string,
  incoming: number,
  excluded: ReadonlySet<string>
): StackMergePlan | null => {
  const stacks = available_item_stacks(inventory, encumbered, item_type, kiosk).filter(({ id }) => !excluded.has(id))
  const [largest, ...rest] = stacks
  if (!largest || !item_is_stackable(largest.category)) return null
  const total = stacks.reduce((amount, stack) => amount + stack.amount, 0)
  if (total + incoming <= 4_294_967_295)
    return Object.freeze({ target_id: largest.id, source_ids: Object.freeze(rest.map(({ id }) => id)), kiosk })
  const target = stacks.find(({ amount }) => amount + incoming <= 4_294_967_295)
  return target ? Object.freeze({ target_id: target.id, source_ids: Object.freeze([]), kiosk }) : null
}

/** Exact per-object burn plan for a recipe ingredient. Null means the unlocked balance is insufficient. */
export const allocate_stack_amount = (
  stacks: readonly Readonly<ItemRow>[],
  amount: number
): readonly Readonly<{ item_id: string; amount: number }>[] | null => {
  if (!Number.isSafeInteger(amount) || amount < 1) return null
  const folded = stacks.reduce(
    (state, stack) => {
      if (state.remaining === 0) return state
      const taken = Math.min(stack.amount, state.remaining)
      return taken > 0
        ? Object.freeze({
            remaining: state.remaining - taken,
            plan: Object.freeze([...state.plan, Object.freeze({ item_id: stack.id, amount: taken })]),
          })
        : state
    },
    Object.freeze({
      remaining: amount,
      plan: Object.freeze([]) as readonly Readonly<{ item_id: string; amount: number }>[],
    })
  )
  return folded.remaining === 0 ? folded.plan : null
}
