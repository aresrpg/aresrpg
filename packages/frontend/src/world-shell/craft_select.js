// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// CRAFT ingredient selection — the PURE (effect-free, import-free) core of craft_actions.js, split out so the
// burn-tally logic is unit-testable with zero mocks (bun mock.module process-global collision law).
//
// WHY EXACT: crafting::craft (packages/move/aresrpg/sources/crafting.move) burns each supplied input WHOLE and
// requires the tally to land EXACT — a single stack whose amount exceeds an ingredient's need aborts
// EIngredientOverSupply, and a shortfall aborts EMissingIngredient. `item::split` is public(package) (the
// client cannot split a stack), so the ONLY way to satisfy a recipe is to pick a subset of the player's
// existing stacks that sums EXACTLY to each ingredient's quantity. Loot/gather mint SEPARATE stacks (no merge
// on mint — character_link::mint_and_lock_resource), so small exact subsets are the common case; when none
// exists (e.g. only a single over-large stack) we refuse honestly rather than send a tx that would abort.

/**
 * A subset of `stacks` (`{ id, amount }`) summing EXACTLY to `target`, or null when no exact subset exists.
 * Exhaustive pruned backtrack (bounded by the player's stack count for ONE item type — small); returns the
 * chosen ids. Sorted descending first so a single exact stack is found before splitting across many.
 * @param {{ id: string, amount: number }[]} stacks
 * @param {number} target
 * @returns {string[] | null}
 */
export function exact_subset(stacks, target) {
  if (!(target > 0)) return null
  const sorted = [...stacks].sort((a, b) => b.amount - a.amount)
  /** @type {{ id: string, amount: number }[]} */
  const chosen = []
  const dfs = (i, remaining) => {
    if (remaining === 0) return true
    if (remaining < 0 || i >= sorted.length) return false
    chosen.push(sorted[i])
    if (dfs(i + 1, remaining - sorted[i].amount)) return true
    chosen.pop()
    return dfs(i + 1, remaining)
  }
  return dfs(0, target) ? chosen.map((s) => s.id) : null
}

/**
 * Pick exact ingredient stacks for `ingredients` (`[{ id (slug), qty }]`) across the owned-items bag
 * (s.sui.items rows: `{ id, item_type, amount, kiosk_id, kiosk_cap_id }`). Each selected row is returned intact
 * as the craft PTB's custody input, so the SDK extracts that item from the kiosk which actually holds it. There
 * is deliberately no item-id→kiosk lookup alongside this function: the owned row is the custody record.
 * @param {any[]} items
 * @param {{ id: string, qty: number }[]} ingredients
 * @returns {{ input_items: any[] } | null}
 */
export function select_ingredients(items, ingredients) {
  const usable = (items ?? []).filter((item) => item?.id && item?.kiosk_id && item?.kiosk_cap_id)
  const by_id = new Map(usable.map((item) => [item.id, item]))
  const selected = ingredients.map((ing) => {
    const stacks = usable
      .filter((item) => item.item_type === ing.id)
      .map((item) => ({ id: item.id, amount: Number(item.amount) || 1 }))
    return exact_subset(stacks, ing.qty)
  })
  if (selected.some((picked) => !picked)) return null
  const input_items = selected.flatMap((picked) => picked.map((id) => by_id.get(id)))
  return input_items.length ? { input_items } : null
}
