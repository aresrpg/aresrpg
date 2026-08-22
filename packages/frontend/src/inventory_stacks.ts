// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// One selector for amount-bearing inventory. Listed stacks are never mutable merge/burn targets.

import { item_is_stackable } from '@aresrpg/immutable'
import type { ItemRow, ListingRow } from '@aresrpg/protocol'

export const available_item_stacks = (
  inventory: readonly Readonly<ItemRow>[],
  listings: readonly Readonly<ListingRow>[],
  item_type: string,
  kiosk?: string
): readonly Readonly<ItemRow>[] => {
  const listed = new Set(listings.map(({ id }) => id))
  return inventory
    .filter((row) => row.item_type === item_type && (!kiosk || row.kiosk === kiosk) && !listed.has(row.id))
    .toSorted((left, right) => right.amount - left.amount || left.id.localeCompare(right.id))
}

/** The largest unlocked stack absorbs new minted units. Null means the mint must lock a new object. */
export const stack_merge_target = (
  inventory: readonly Readonly<ItemRow>[],
  listings: readonly Readonly<ListingRow>[],
  item_type: string,
  kiosk?: string
): string | null => {
  const target = stack_merge_target_row(inventory, listings, item_type, kiosk)
  return target?.id ?? null
}

export const stack_merge_target_row = (
  inventory: readonly Readonly<ItemRow>[],
  listings: readonly Readonly<ListingRow>[],
  item_type: string,
  kiosk?: string
): Readonly<ItemRow> | null => {
  const [target] = available_item_stacks(inventory, listings, item_type, kiosk)
  return target && item_is_stackable(target.category) ? target : null
}

export const coalesced_stack_groups = (
  inventory: readonly Readonly<ItemRow>[],
  listings: readonly Readonly<ListingRow>[]
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
      const available = available_item_stacks(rows, listings, rows[0]!.item_type, rows[0]!.kiosk)
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
