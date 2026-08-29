// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Crush presentation bridge: the receipt names exactly which rune stacks changed; the item
// stream supplies their contents. The modal itself keeps presentation state locally.

import type { ItemRow } from '@aresrpg/protocol'

export type CrushResult = Readonly<{ digest: string; items: readonly Readonly<ItemRow>[] }>
export type CrushPresentation =
  | Readonly<{ type: 'crushing'; item: Readonly<ItemRow> }>
  | Readonly<{ type: 'result'; result: Readonly<CrushResult> }>
  | Readonly<{ type: 'failed'; error: string }>
export type PendingCrushResult = Readonly<{
  digest: string
  item_ids: readonly string[]
  previous_amounts: Readonly<Record<string, number>>
}>

/** Null means at least one receipt-touched stack has not reached the projection yet. */
export const projected_crush_items = (
  pending: Readonly<PendingCrushResult>,
  inventory: readonly Readonly<ItemRow>[]
): readonly Readonly<ItemRow>[] | null => {
  const rows = pending.item_ids.map((item_id) => inventory.find(({ id }) => id === item_id) ?? null)
  if (rows.some((row) => row === null)) return null
  const items = rows.map((row) => row!)
  const projected = items.every(
    (item, index) => item.amount > (pending.previous_amounts[pending.item_ids[index]!] ?? 0)
  )
  return projected ? Object.freeze(items) : null
}

type Listener = (presentation: Readonly<CrushPresentation>) => void
const listeners = new Set<Listener>()
const publish = (presentation: Readonly<CrushPresentation>): void =>
  listeners.forEach((listener) => listener(presentation))

export const crush_results = Object.freeze({
  start: (item: Readonly<ItemRow>): void => publish(Object.freeze({ type: 'crushing', item })),
  publish: (result: Readonly<CrushResult>): void => publish(Object.freeze({ type: 'result', result })),
  fail: (error: unknown): void =>
    publish(Object.freeze({ type: 'failed', error: error instanceof Error ? error.message : String(error) })),
  subscribe: (listener: Listener): (() => void) => {
    listeners.add(listener)
    return () => void listeners.delete(listener)
  },
})
