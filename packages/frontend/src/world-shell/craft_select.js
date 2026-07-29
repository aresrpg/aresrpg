// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// CRAFT ingredient selection — the PURE (effect-free, import-free) core of craft_actions.js, split out so the
// burn-tally logic is unit-testable with zero mocks (bun mock.module process-global collision law).
//
// THE RULE IS THE CHAIN'S RULE (#1604): crafting::craft (packages/move/aresrpg/sources/crafting.move, `y18`)
// consumes min(need, amount) per supplied stack — a stack LARGER than the remaining need is AUTO-SPLIT, the
// surplus re-locking into the crafter's kiosk (`EIngredientOverSupply` fires only for a stack whose ingredient
// is ALREADY fully satisfied — a redundant input — and `EMissingIngredient` only for a real shortfall). So a
// bag satisfies a recipe iff, per ingredient template, the SUM of owned stack amounts covers the requirement.
// This matters because the world-load stack sweep (chain/stack_merge.js) folds every duplicate into ONE stack
// per resource: demanding stacks that tile the need exactly would refuse the shape the bag normally has.

/**
 * The fewest of `stacks` (`{ id, amount }`) whose amounts SUM to at least `target`, or null when the owned
 * total is short. Biggest-first, stopping the moment the tally is covered: fewest objects in the PTB, no
 * redundant stack for an already-satisfied ingredient (the chain splits the surplus off the last one).
 * @param {{ id: string, amount: number }[]} stacks
 * @param {number} target
 * @returns {string[] | null}
 */
export function covering_stacks(stacks, target) {
  if (!(target > 0)) return null
  const chosen = []
  let remaining = target
  for (const stack of [...stacks].sort((a, b) => b.amount - a.amount)) {
    if (remaining <= 0) break
    chosen.push(stack.id)
    remaining -= stack.amount
  }
  return remaining <= 0 ? chosen : null
}

/**
 * Pick the ingredient stacks for `ingredients` (`[{ id (slug), qty }]`) out of the owned-items bag (s.sui.items
 * rows: `{ id, item_type, amount, kiosk_id, kiosk_cap_id }`), restricted to the ONE kiosk the craft runs in.
 *
 * WHY ONE KIOSK (#1494): `crafting::craft` borrows the crafter's character out of the kiosk it is handed AND runs
 * `extract::extract_for_burn` for every ingredient against that SAME kiosk — so an ingredient sitting in a sibling
 * personal kiosk can only abort `0x2::kiosk::EItemNotFound` ("This item belongs to a different kiosk"). Selecting
 * across the whole bag composed exactly that doomed tx.
 *
 * Failures flow as DATA so the caller can be honest about WHICH refusal it is: `{ error: 'wrong_kiosk' }` means the
 * ingredients exist but live in another kiosk (a real, actionable state — not "you lack the materials"), while
 * `null` means the bag genuinely cannot satisfy the recipe.
 * @param {any[]} items
 * @param {{ id: string, qty: number }[]} ingredients
 * @param {string} kiosk_id the kiosk holding the crafter's character — the craft's one custody home
 * @returns {{ input_items: any[] } | { error: 'wrong_kiosk' } | null}
 */
export function select_ingredients(items, ingredients, kiosk_id) {
  const usable = (items ?? []).filter((item) => item?.id && item?.kiosk_id && item?.kiosk_cap_id)
  const pick = (pool) => {
    const by_id = new Map(pool.map((item) => [item.id, item]))
    const selected = ingredients.map((ing) =>
      covering_stacks(
        pool
          .filter((item) => item.item_type === ing.id)
          .map((item) => ({ id: item.id, amount: Number(item.amount) || 1 })),
        ing.qty
      )
    )
    if (selected.some((picked) => !picked)) return null
    const input_items = selected.flatMap((picked) => picked.map((id) => by_id.get(id)))
    return input_items.length ? { input_items } : null
  }

  const here = pick(usable.filter((item) => String(item.kiosk_id) === String(kiosk_id)))
  if (here) return here
  // Satisfiable somewhere, just not where the craft can reach — name that state instead of "no ingredients".
  return pick(usable) ? { error: 'wrong_kiosk' } : null
}
