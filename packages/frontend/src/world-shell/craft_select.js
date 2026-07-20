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
 * Pick exact ingredient stacks for `ingredients` (`[{ id (slug), qty }]`) from ONE kiosk in `items`
 * (s.sui.items rows: `{ id, item_type, amount, kiosk_id, kiosk_cap_id }`). The craft borrows a SINGLE kiosk for
 * both the burns and the output lock, so every ingredient must resolve within the SAME kiosk. Returns the
 * craft PTB kiosk args + the flat input item ids, or null when no single kiosk can satisfy every ingredient
 * exactly.
 * @param {any[]} items
 * @param {{ id: string, qty: number }[]} ingredients
 * @returns {{ input_item_ids: string[], kiosk_id: string, personal_kiosk_cap_id: string } | null}
 */
export function select_ingredients(items, ingredients) {
  /** @type {Map<string, { cap: string, rows: any[] }>} */
  const by_kiosk = new Map()
  for (const it of items ?? []) {
    if (!it?.kiosk_id || !it?.id) continue
    if (!by_kiosk.has(it.kiosk_id)) by_kiosk.set(it.kiosk_id, { cap: it.kiosk_cap_id, rows: [] })
    by_kiosk.get(it.kiosk_id).rows.push(it)
  }
  for (const [kiosk_id, { cap, rows }] of by_kiosk) {
    if (!cap) continue
    /** @type {string[]} */
    const input_item_ids = []
    let ok = true
    for (const ing of ingredients) {
      const stacks = rows
        .filter((r) => r.item_type === ing.id)
        .map((r) => ({ id: r.id, amount: Number(r.amount) || 1 }))
      const picked = exact_subset(stacks, ing.qty)
      if (!picked) {
        ok = false
        break
      }
      input_item_ids.push(...picked)
    }
    if (ok && input_item_ids.length) return { input_item_ids, kiosk_id, personal_kiosk_cap_id: cap }
  }
  return null
}
