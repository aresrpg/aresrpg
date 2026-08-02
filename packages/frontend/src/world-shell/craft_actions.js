// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// CRAFT actions — the tx seam over @aresrpg/sdk's `craft_ptb` (crafting::craft), the single-transaction,
// reference-corpus success-roll craft (rolls off the crafter's job level). ONE user action: click Craft on a recipe → burn the crafter's own
// kiosk-locked ingredient stacks from THEIR OWN custody kiosks → mint the recipe's output into the character's
// personal kiosk (kiosk-lock constitution — nothing reaches a raw address), all atomic. Mirrors
// consumable_actions / crush_actions:
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
// STACK SELECTION: craft_select.js owns the rule (it is the chain's own — see its header) and this module only
// surfaces its refusals; a recipe the bag cannot cover never reaches the PTB.
//
// ONE KIOSK (#1494): the chain borrows the crafter's character AND extracts every ingredient out of the single
// kiosk the PTB names, so the selection is bounded to the character's kiosk. Ingredients stranded in a sibling
// personal kiosk are refused honestly (`errors.item_wrong_kiosk`) at zero gas rather than sent as a tx that can
// only abort `0x2::kiosk::EItemNotFound` — the toast this flow used to produce.

import { use_auth } from '../auth'
import i18n from '../i18n'
import { get_sdk } from '../chain/sdk'
import { load_roster } from '../roster/load_roster.js'

import { select_ingredients } from './craft_select.js'
import { craft_outcome } from './craft_outcome.js'
import { kiosk_for_character } from './kiosk_resolve.js'
import { run_tx } from './tx.js'

/**
 * CRAFT one unit of `recipe` (a live CraftRecipeRow — see pages/encyclopedia/recipes.ts) from the player's
 * on-chain bag `items` (s.sui.items). Selects the exact ingredient stacks, then signs+executes the self-pay
 * craft tx through the standard run_tx choke and repaints the bag. Throws a translated, player-copy Error on
 * any refusal (the caller surfaces ONE toast); run_tx's own throw is already humanized (abort_copy: the
 * crafting arm).
 *
 * THE RETURN IS THE OUTCOME, NOT THE RECEIPT (#2034): the chain rolls for success inside this one tx, so a
 * resolved promise only means the transaction landed — the roll may still have failed, burning the inputs and
 * minting nothing. `craft_outcome` reads the authoritative `crafting::Crafted` event, and the caller reports
 * exactly that. The bag repaint rides BOTH branches: job XP moved either way.
 * @param {{
 *   recipe: import('../pages/encyclopedia/recipes').CraftRecipeRow,
 *   items: any[],
 *   character_id: string,
 * }} args
 * @returns {Promise<import('./craft_outcome.js').CraftOutcome>} the rolled outcome of the executed craft
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

  // The crafting kiosk is resolved FIRST because it bounds the selection: the chain burns every ingredient out of
  // the kiosk holding the crafter's character, so a stack in a sibling kiosk is not craftable (see craft_select).
  const sdk = await get_sdk()
  const handle = await kiosk_for_character(sdk, address, character_id)
  if (!handle) throw new Error(i18n.t('errors.craft_failed'))

  const selection = select_ingredients(items, ingredients, handle.kiosk_id)
  if (!selection) throw new Error(i18n.t('errors.craft_no_ingredients'))
  if (selection.error === 'wrong_kiosk') throw new Error(i18n.t('errors.item_wrong_kiosk'))

  const tx = sdk.craft_ptb({
    recipe_id: recipe.recipe_id,
    kiosk_id: handle.kiosk_id,
    personal_kiosk_cap_id: handle.personal_kiosk_cap_id,
    character_id,
    input_items: selection.input_items,
    output_template_id: recipe.output_template_id,
  })

  const { result } = await run_tx('craft', tx) // dryRun-guarded self-pay; throws humanized on an on-chain abort
  load_roster().catch(() => {}) // repaint the bag off chain truth → the crafted output appears → quest 'craft' flips
  return craft_outcome(result)
}
