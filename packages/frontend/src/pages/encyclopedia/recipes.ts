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

/** Display fallback for a template id that is not (yet) a live encyclopedia item. */
export const short_id = (id: string) => `${id.slice(0, 6)}…${id.slice(-4)}`

export interface CraftableItemRow {
  id: string
  name: string
  level: number
  category: string
}

/**
 * The JOBS tab's "Craftable Items" list for one job (the SDK `JOBS` array index — `RpcRecipe.required_job`
 * is that same index verbatim). Filters the /v1 recipes to this job, then resolves each recipe's
 * `output_template_id` against the live /v1 items (a recipe whose output hasn't snapshotted yet is
 * skipped, never fabricated — same existence law as recipe_for_output above).
 *
 * There is NO level field anywhere in this path and therefore no cutoff to reintroduce: `level` passes
 * through verbatim from the chain, exactly like every other field in this file. (Was: the JOBS tab read a
 * static bundled seed snapshot — packages/sdk/src/{items,recipes}.json, a legacy-ported catalog that was
 * simply never generated past level 110 — so nothing above it could ever appear, on ANY job.)
 */
export function craftable_items_for_job(
  recipes: RpcRecipe[] | undefined,
  items: RpcEncyclopediaItem[] | undefined,
  job_index: number
): CraftableItemRow[] {
  if (!recipes || !items || job_index < 0) return []
  const item_by_template_id = new Map(items.map((item) => [item.template_id, item]))
  return recipes
    .filter((r) => r.required_job === job_index)
    .map((r) => item_by_template_id.get(r.output_template_id))
    .filter((item): item is RpcEncyclopediaItem => item !== undefined)
    .map((item) => ({
      id: item.template_id,
      name: item.name ?? '',
      level: item.level ?? 0,
      category: item.category ?? '',
    }))
    .sort((a, b) => a.level - b.level)
}
