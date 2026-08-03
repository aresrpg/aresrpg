// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Pure recipe-structure mapping for the §14 encyclopedia (no React / no RPC — plain data, unit-tested
// offline against the /v1 contract, exactly like loot.ts). The /v1 `recipes` rows (object-snapshotted
// on-chain `crafting::Recipe`s) are the SINGLE source of crafting truth; these helpers answer the two
// structural questions the item detail pane renders:
//   RECIPE        — which on-chain recipe OUTPUTS the selected template (or null — honest "no recipe")
//   INGREDIENT OF — every on-chain recipe that CONSUMES the selected template (+ how many it takes)
//
// TWO design laws are enforced here:
//   1. EXACT VALUES — quantities / required job+level / craft xp pass through VERBATIM from the /v1 row
//      (which mirrors the chain object field-for-field) — never derived, never rounded.
//   2. NO FABRICATION / EXISTENCE — pure projections of the /v1 rows: a recipe that exists only in a
//      static seed catalog (never minted on-chain) can NEVER surface, so "if it's in the encyclopedia,
//      players are 100% sure it's in game".
import type { RpcEncyclopediaItem, RpcRecipe } from '../../rpc/views'
import { short_fighter_id } from '../../world-shell/character_name_resolve.js'

/** The on-chain recipe whose OUTPUT is `template_id`, or null (honest "no recipe"). */
export function recipe_for_output(recipes: RpcRecipe[] | undefined, template_id: string): RpcRecipe | null {
  if (!template_id) return null
  return recipes?.find((r) => r.output_template_id === template_id) ?? null
}

/** Every on-chain recipe CONSUMING `template_id`, with the exact quantity that recipe takes of it. */
export function recipes_consuming(
  recipes: RpcRecipe[] | undefined,
  template_id: string
): { recipe: RpcRecipe; quantity: number }[] {
  if (!template_id || !recipes) return []
  return recipes
    .map((recipe) => {
      const consumed = recipe.inputs.find((i) => i.template_id === template_id)
      return consumed ? { recipe, quantity: consumed.quantity } : null
    })
    .filter((row): row is { recipe: RpcRecipe; quantity: number } => row !== null)
}

/** One line of a recipe's BILL OF MATERIALS, joined to the live item projection. */
export interface CraftIngredientRow {
  /**
   * The on-chain `item::Item.item_type` slug — the key the player's bag is tallied by. `null` when the
   * ingredient's template has not snapshotted yet: the row is still rendered (the chain requires it), but
   * it can never be proven owned, so it holds the craft gate CLOSED rather than sending a tx that would
   * abort `EMissingIngredient`. Honest gap, never a silent drop.
   */
  id: string | null
  template_id: string
  qty: number
  name: string
  level: number
}

/** A craftable row with everything a craft tx and its bill of materials need — see craft_recipes_for_job. */
export interface CraftRecipeRow {
  /** the OUTPUT template id — the encyclopedia's navigation key */
  id: string
  /** The row's on-chain art key — what encyclopedia_item_asset builds `items/{item_type}.png` from. Kept on
   *  the projection because a display name is not an art identity: dropping it left the jobs tab guessing. */
  item_type: string
  name: string
  level: number
  category: string
  /** the live `crafting::Recipe` shared-object id — the craft tx's own input, no chain-direct lookup needed */
  recipe_id: string
  output_template_id: string
  output_quantity: number
  /** the on-chain KNOWLEDGE gate (`crafting.move` asserts `crafter_level >= required_level`, EUnderLevel) */
  required_level: number
  craft_xp: number
  ingredients: CraftIngredientRow[]
}

/**
 * Every live recipe for one job (the SDK `JOBS` array index — `RpcRecipe.required_job` is that index
 * verbatim), with its BILL OF MATERIALS resolved against the same /v1 items list. THE single walk behind
 * every per-job crafting surface: the encyclopedia JOBS tab's RECIPES section, the in-game Jobs drawer and
 * the commission board all take this row (they need `recipe_id` and the ingredient slugs to actually fire
 * `crafting::craft`). A job's recipe membership therefore has exactly one home — the chain's own
 * `required_job` — for gathering jobs (flours / powders / blends) exactly like for the smiths (#1670).
 *
 * EXISTENCE LAW, both directions: a recipe whose OUTPUT has not snapshotted is skipped entirely (nothing
 * to render or craft), while an unresolved INGREDIENT keeps its row — dropping it would understate the
 * tally the chain will demand. Two levels ride along and must not be confused: `level` is the OUTPUT
 * item's level (display/sort only), `required_level` is the job level the chain actually gates on.
 */
export function craft_recipes_for_job(
  recipes: RpcRecipe[] | undefined,
  items: RpcEncyclopediaItem[] | undefined,
  job_index: number
): CraftRecipeRow[] {
  if (!recipes || !items || job_index < 0) return []
  const item_by_template_id = new Map(items.map((item) => [item.template_id, item]))
  return recipes
    .filter((r) => r.required_job === job_index)
    .map((r) => {
      const output = item_by_template_id.get(r.output_template_id)
      if (!output) return null // output not snapshotted — skipped, never fabricated
      return {
        id: output.template_id,
        // The row's on-chain art key (encyclopedia_item_asset builds `items/{item_type}.png`) AND the key
        // the in-game bag is tallied by — a display name is not an art identity.
        item_type: output.item_type ?? '',
        name: output.name ?? '',
        level: output.level ?? 0,
        category: output.category ?? '',
        recipe_id: r.recipe_id,
        output_template_id: r.output_template_id,
        output_quantity: r.output_quantity,
        required_level: r.required_level,
        craft_xp: r.craft_xp,
        ingredients: r.inputs.map((input) => {
          const item = item_by_template_id.get(input.template_id)
          return {
            id: item?.item_type ?? null,
            template_id: input.template_id,
            qty: input.quantity,
            name: item?.name ?? short_fighter_id(input.template_id),
            level: item?.level ?? 0,
          }
        }),
      }
    })
    .filter((row): row is CraftRecipeRow => row !== null)
    .sort((a, b) => a.level - b.level)
}

/**
 * Per-ingredient have/need for `count` crafts against the player's on-chain bag tally (`owned`, keyed by
 * `item_type` slug). PURE — the client gate is a mirror of what `crafting::craft` can actually burn, so an
 * ingredient with no resolvable slug counts as 0 owned and an empty bill of materials is never affordable.
 */
export function craft_affordability_of(
  ingredients: CraftIngredientRow[],
  owned: Record<string, number>,
  count = 1
): {
  rows: { id: string | null; template_id: string; need: number; have: number; enough: boolean }[]
  affordable: boolean
} {
  const rows = ingredients.map(({ id, template_id, qty }) => {
    const need = qty * count
    const have = id ? (owned[id] ?? 0) : 0
    return { id, template_id, need, have, enough: have >= need }
  })
  return { rows, affordable: rows.length > 0 && rows.every(({ enough }) => enough) }
}
