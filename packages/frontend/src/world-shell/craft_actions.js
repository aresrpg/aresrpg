// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// CRAFT actions — the tx seam over @aresrpg/sdk's `craft_ptb` (crafting::craft), the single-transaction,
// exact-ingredient, reference-corpus success-roll craft (rolls off the crafter's job level). ONE user action: click Craft on a recipe → burn the crafter's own
// kiosk-locked ingredient stacks → mint the recipe's output into the SAME personal kiosk (kiosk-lock
// constitution — nothing reaches a raw address), all atomic. Mirrors consumable_actions / crush_actions:
// same get_sdk() instance, same self-pay run_tx choke (dryRun-guarded, budget = sim ×1.5, 0.1-SUI ceiling,
// NEVER auto-retried — an executed abort surfaces and stops), then load_roster() repaints the bag off chain
// truth (which flips the onboarding quest-ladder 'craft' step the moment the output lands).
//
// RECIPE IDENTITY (issue #765): the caller hands us a LIVE recipe row — `pages/encyclopedia/recipes.ts`'s
// CraftRecipeRow, projected from `/v1/encyclopedia`, the object-snapshot of the on-chain `crafting::Recipe`
// set. It already carries the Recipe object id, the output template, and the bill of materials keyed by the
// SAME `item_type` slug the bag is tallied by — so this module resolves NOTHING: it selects stacks and
// signs. (Was: a chain-direct `RecipeCreated` GraphQL replay plus a batched gRPC read of every output
// template's slug, memoized per session — a second home for a fact the read layer already publishes, and
// one that could disagree with the very grid the player clicked.)
//
// EXACT-STACK SELECTION: crafting::craft burns WHOLE items and requires the tally to land EXACT (a single
// stack whose amount exceeds the need aborts EIngredientOverSupply; item::split is public(package), so the
// client cannot split). Loot/gather mint SEPARATE stacks (no merge on mint), so we pick a subset of the
// player's stacks that sums EXACTLY to each ingredient's quantity, all within ONE kiosk (the craft borrows a
// single kiosk for both the burns and the output lock). When no exact subset exists we refuse honestly.

import { use_auth } from '../auth'
import i18n from '../i18n'
import { get_sdk } from '../chain/sdk'
import { load_roster } from '../roster/load_roster.js'

import { select_ingredients } from './craft_select.js'
import { run_tx } from './tx.js'

/**
 * CRAFT one unit of `recipe` (a live CraftRecipeRow — see pages/encyclopedia/recipes.ts) from the player's
 * on-chain bag `items` (s.sui.items). Selects the exact ingredient stacks, then signs+executes the self-pay
 * craft tx through the standard run_tx choke and repaints the bag. Throws a translated, player-copy Error on
 * any refusal (the caller surfaces ONE toast); run_tx's own throw is already humanized (abort_copy: the
 * crafting arm).
 * @param {{
 *   recipe: import('../pages/encyclopedia/recipes').CraftRecipeRow,
 *   items: any[],
 *   character_id: string,
 * }} args
 * @returns {Promise<any>} the run_tx receipt on success
 */
export async function craft_item({ recipe, items, character_id }) {
  const { address } = use_auth.getState()
  if (!address) throw new Error(i18n.t('errors.craft_failed'))
  // The crafter's character drives the reference-corpus success roll (its job level) — craft_ptb refuses without it.
  if (!character_id) throw new Error(i18n.t('errors.craft_failed'))

  // An ingredient whose template has not snapshotted carries a null slug (CraftIngredientRow.id): there is
  // no way to match it against the bag, so the craft refuses here rather than sending a tx the chain would
  // abort with EMissingIngredient.
  const ingredients = (recipe.ingredients ?? []).map(({ id, qty }) => ({ id, qty: Number(qty) || 0 }))
  if (!recipe.recipe_id || !ingredients.length || ingredients.some(({ id, qty }) => !id || qty <= 0))
    throw new Error(i18n.t('errors.craft_no_recipe'))

  const selection = select_ingredients(items, ingredients)
  if (!selection) throw new Error(i18n.t('errors.craft_no_ingredients'))

  const sdk = await get_sdk()
  const tx = sdk.craft_ptb({
    recipe_id: recipe.recipe_id,
    kiosk_id: selection.kiosk_id,
    personal_kiosk_cap_id: selection.personal_kiosk_cap_id,
    character_id,
    input_item_ids: selection.input_item_ids,
    output_template_id: recipe.output_template_id,
  })

  const { result } = await run_tx('craft', tx) // dryRun-guarded self-pay; throws humanized on an on-chain abort
  load_roster().catch(() => {}) // repaint the bag off chain truth → the crafted output appears → quest 'craft' flips
  return result
}
