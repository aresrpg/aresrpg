// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Pure commission logic — the CUSTOMER-side greying/stock math, split out so it is unit-testable with ZERO
// React / chain / SDK-render coupling (component tests exercise the greying/stock logic as pure
// fns). Every chain/SDK read + the tx compose live behind commission_actions.js; the live `/v1` recipe
// DERIVATION lives in commission_recipes.js. This file only transforms plain data, so its test imports no
// heavy graph and never couples to any content source.
//
// The stock check mirrors `craft_affordability_of` have>=need semantics (pages/encyclopedia/recipes.ts) —
// the SAME rule the JobsDrawer uses to gate a craft — so a commission greys exactly what a craft tx could
// not burn. Computed inline here (not imported) to keep the tested core dependency-free. An ingredient
// whose template has not snapshotted carries a null id and therefore counts as 0 owned: the row still
// renders (the chain will demand it) but holds the gate CLOSED — honest gap, never a silent drop.
//
// Also home to the PLATFORM CUT math (platform_cut_mist / artisan_net_mist) — the customer request-create view
// and the artisan request queue both need the IDENTICAL 10%-floor split, so it lives here ONCE.

/**
 * The success chance for a recipe, DATA-DRIVEN. Chain truth today:
 * `crafting::craft` carries no RNG — a craft always succeeds — so absent an explicit per-recipe rate the
 * chance is 100%. When the verifying Move lane lands a <100% path, a recipe simply carries a numeric
 * `success_chance` (0..100) and this surfaces it, clamped. No UI change needed.
 * @param {{ success_chance?: number } | null | undefined} recipe
 * @returns {number} 0..100
 */
export function recipe_success_chance(recipe) {
  const raw = recipe?.success_chance
  return Number.isFinite(raw) ? Math.max(0, Math.min(100, /** @type {number} */ (raw))) : 100
}

/**
 * Owned units per template slug from the on-chain bag (`item_type` IS the seed slug, `amount` the stack
 * size) — the EXACT idiom the JobsDrawer uses (JobsDrawer.jsx `owned`), so the commission greying matches
 * what a craft tx could actually burn. Items with no `item_type` are skipped; a missing `amount` counts as 1.
 * @param {Array<{ item_type?: string, amount?: number }> | null | undefined} items
 * @returns {Record<string, number>}
 */
export function owned_from_items(items) {
  /** @type {Record<string, number>} */
  const map = {}
  for (const it of items ?? []) {
    if (!it?.item_type) continue
    map[it.item_type] = (map[it.item_type] || 0) + (Number(it.amount) || 1)
  }
  return map
}

/**
 * One customer-facing recipe row: the ingredient bill priced against the CUSTOMER's own stock. A row the
 * customer cannot fully supply (any ingredient short) is `craftable: false` → the UI greys it and renders
 * the `missing` tail ("missing: Oak Log ×2"). A recipe with no bill at all is treated as NOT craftable —
 * never silently free. `success_chance` and the artisan's `required_level` ride along for the row display;
 * `required_level` is the CHAIN gate the recipe carries (`crafting.move`, EUnderLevel), never the output
 * item's display level — they are different numbers on real content.
 * @param {{ id: string, name: string, required_level?: number, success_chance?: number }} recipe
 * @param {Array<{ id: string | null, name: string, qty: number, level?: number }>} ingredients
 * @param {Record<string, number>} owned  the customer's owned map (owned_from_items)
 */
export function commission_recipe_row(recipe, ingredients, owned) {
  const bill = (ingredients ?? []).map((ing) => {
    const have = ing.id ? (owned?.[ing.id] ?? 0) : 0
    const short = Math.max(0, ing.qty - have)
    return { ...ing, have, need: ing.qty, short, enough: short === 0 }
  })
  const missing = bill.filter((r) => !r.enough).map((r) => ({ id: r.id, name: r.name, short: r.short }))
  const seeded = bill.length > 0
  const has_ingredients = seeded && missing.length === 0
  return {
    recipe,
    bill,
    missing,
    seeded,
    has_ingredients,
    success_chance: recipe_success_chance(recipe),
    required_level: recipe.required_level ?? 1,
    // GREYED when the customer can't supply the resources. The artisan-level gate is applied
    // upstream (the list is pre-filtered to what the artisan CAN craft), so the row's own gate is stock.
    craftable: has_ingredients,
  }
}

/**
 * The compact "Oak Log ×2, Iron ×1" tail for a greyed row (`missing: X×2` indicated).
 * @param {Array<{ name: string, short: number }>} missing
 * @returns {string}
 */
export function missing_summary(missing) {
  return (missing ?? []).map((m) => `${m.name} ×${m.short}`).join(', ')
}

/**
 * The platform's floor-rounded 10% cut on a commission payment, in MIST — mirrors `commission.move`'s
 * `platform_cut_of` EXACTLY (`PLATFORM_CUT_BPS=1_000` / `BPS_DENOM=10_000` — PLATFORM
 * CUTS: `amount * 1000 / 10000` floored). Applies only at `execute` (a real craft) — `cancel` refunds the escrow
 * WHOLE, uncut.
 * @param {number} amount_mist
 * @returns {number} the cut, in MIST (floored, never negative)
 */
export function platform_cut_mist(amount_mist) {
  return Math.floor((Number(amount_mist) || 0) * 1000 / 10000)
}

/**
 * What the artisan actually nets after the platform cut (`amount − fee`) — mirrors `commission.move`'s
 * `CraftExecuted` split (`net = amount − fee`; the floor rounds in the platform's favor, so the artisan takes
 * the remainder).
 * @param {number} amount_mist
 * @returns {number} the artisan's net, in MIST
 */
export function artisan_net_mist(amount_mist) {
  const amount = Number(amount_mist) || 0
  return amount - platform_cut_mist(amount)
}
