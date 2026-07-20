// CRAFT actions — the tx seam over @aresrpg/sdk's `craft_ptb` (crafting::craft), the single-transaction,
// exact-ingredient, reference-corpus success-roll craft (rolls off the crafter's job level). ONE user action: click Craft on a recipe → burn the crafter's own
// kiosk-locked ingredient stacks → mint the recipe's output into the SAME personal kiosk (kiosk-lock
// constitution — nothing reaches a raw address), all atomic. Mirrors consumable_actions / crush_actions:
// same get_sdk() instance, same self-pay run_tx choke (dryRun-guarded, budget = sim ×1.5, 0.1-SUI ceiling,
// NEVER auto-retried — an executed abort surfaces and stops), then load_roster() repaints the bag off chain
// truth (which flips the onboarding quest-ladder 'craft' step the moment the output lands).
//
// RECIPE-ID RESOLUTION (the ONE home, fully DYNAMIC — a fresh publish re-seeds recipes with new object ids,
// so nothing is hardcoded): the on-chain Recipe is a plain SHARED object whose only identity is its
// `output_template`, and the indexer DELIBERATELY defers `crafting::RecipeCreated` (packages/rpc tests:
// craft_pet_runes_gather_verbs_are_deferred — no /v1 view, Rust out of scope). So we resolve chain-direct at
// tx PRE-FLIGHT (SPEC §14-sanctioned: "chain-direct ONLY for tx pre-flight"): replay every `RecipeCreated`
// event (query_events.js — GraphQL) for its { recipe, output_template }, then read each output_template's
// `item_type` slug (one batched gRPC getObjects) to key the index by the SAME seed slug recipes.json uses.
// Memoized per session (the recipe set is publish-stable). This is why get_template_by_item_type_map is NOT
// used: it replays `template::ItemTemplateCreated`, which the merged package does not emit (it emits
// `item::TemplateCreated`), so that map is empty on this lineage — proven on-chain 2026-07-11.
//
// EXACT-STACK SELECTION: crafting::craft burns WHOLE items and requires the tally to land EXACT (a single
// stack whose amount exceeds the need aborts EIngredientOverSupply; item::split is public(package), so the
// client cannot split). Loot/gather mint SEPARATE stacks (no merge on mint), so we pick a subset of the
// player's stacks that sums EXACTLY to each ingredient's quantity, all within ONE kiosk (the craft borrows a
// single kiosk for both the burns and the output lock). When no exact subset exists we refuse honestly.

import { normalizeStructTag } from '@mysten/sui/utils'
import { aresrpg_id } from '@aresrpg/sdk/deployment/aresrpg'
import { recipe_ingredients } from '@aresrpg/sdk/jobs'

import { use_auth } from '../auth'
import i18n from '../i18n'
import { get_sdk } from '../chain/sdk'
import { DEMO_NETWORK } from '../chain/deployment'
import { replay_events } from '../chain/query_events.js'
import { load_roster } from '../roster/load_roster.js'

import { select_ingredients } from './craft_select.js'
import { run_tx } from './tx.js'

// Memoized slug → { recipe_id, output_template_id, output_quantity } for every RecipeCreated on the live
// lineage. Built once per session (recipes are publish-stable); a build error clears the memo so the next
// craft retries rather than wedging forever (get_sdk idiom).
let _recipe_index_promise =
  /** @type {Promise<Map<string, { recipe_id: string, output_template_id: string, output_quantity: number }>> | null} */ (
    null
  )

/** Batch-read `item_type` (the seed slug) for a set of ItemTemplate object ids (gRPC getObjects, chunk 50). */
async function template_slugs(sdk, ids) {
  /** @type {Map<string, string>} */
  const by_id = new Map()
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50)
    const { objects } = await sdk.grpc_client.core.getObjects({ objectIds: chunk, include: { json: true } })
    for (const o of objects ?? []) {
      if (!(o instanceof Error) && o?.objectId && o.json?.item_type) by_id.set(o.objectId, String(o.json.item_type))
    }
  }
  return by_id
}

/** Build the recipe index chain-direct (RecipeCreated events → output_template slugs). @returns {Promise<Map<string, any>>} */
async function build_recipe_index(sdk) {
  const pkg = aresrpg_id(DEMO_NETWORK, 'PACKAGE_ID') // event TYPE ORIGIN (frozen at first publish)
  if (!pkg) return new Map()
  const event_type = normalizeStructTag(`${pkg}::crafting::RecipeCreated`)
  const rows = await replay_events(sdk.graphql_client, event_type)
  const created = rows.map((r) => r.parsedJson).filter((j) => j?.recipe && j?.output_template)
  const slugs = await template_slugs(sdk, [...new Set(created.map((j) => String(j.output_template)))])
  const index = new Map()
  for (const j of created) {
    const slug = slugs.get(String(j.output_template))
    if (!slug) continue // output template not resolvable (deleted / wrong lineage) — skip, never fabricate
    index.set(slug, {
      recipe_id: String(j.recipe),
      output_template_id: String(j.output_template),
      output_quantity: Number(j.output_quantity ?? 1),
    })
  }
  return index
}

/** The memoized recipe index (see _recipe_index_promise). */
function get_recipe_index(sdk) {
  if (!_recipe_index_promise)
    _recipe_index_promise = build_recipe_index(sdk).catch((e) => {
      _recipe_index_promise = null // never cache a failed build — the next craft retries
      throw e
    })
  return _recipe_index_promise
}

/**
 * CRAFT one unit of `recipe` (a @aresrpg/sdk/jobs CraftRecipe — `.id` is the seed slug, e.g. `basic_pickaxe`)
 * from the player's on-chain bag `items` (s.sui.items). Resolves the live Recipe object + output template
 * chain-direct, selects the exact ingredient stacks, then signs+executes the self-pay craft tx through the
 * standard run_tx choke and repaints the bag. Throws a translated, player-copy Error on any refusal (the
 * caller surfaces ONE toast); run_tx's own throw is already humanized (abort_copy: the crafting arm below).
 * @param {{ recipe: { id: string }, items: any[], character_id: string }} args
 * @returns {Promise<any>} the run_tx receipt on success
 */
export async function craft_item({ recipe, items, character_id }) {
  const { address } = use_auth.getState()
  if (!address) throw new Error(i18n.t('errors.craft_failed'))
  // The crafter's character drives the reference-corpus success roll (its job level) — craft_ptb refuses without it.
  if (!character_id) throw new Error(i18n.t('errors.craft_failed'))

  const ingredients = recipe_ingredients(recipe.id).map((r) => ({ id: r.id, qty: Number(r.qty) || 0 }))
  if (!ingredients.length || ingredients.some((i) => i.qty <= 0)) throw new Error(i18n.t('errors.craft_no_recipe'))

  const sdk = await get_sdk()
  const resolved = (await get_recipe_index(sdk)).get(recipe.id)
  if (!resolved) throw new Error(i18n.t('errors.craft_no_recipe'))

  const selection = select_ingredients(items, ingredients)
  if (!selection) throw new Error(i18n.t('errors.craft_no_ingredients'))

  const tx = sdk.craft_ptb({
    recipe_id: resolved.recipe_id,
    kiosk_id: selection.kiosk_id,
    personal_kiosk_cap_id: selection.personal_kiosk_cap_id,
    character_id,
    input_item_ids: selection.input_item_ids,
    output_template_id: resolved.output_template_id,
  })

  const { result } = await run_tx('craft', tx) // dryRun-guarded self-pay; throws humanized on an on-chain abort
  load_roster().catch(() => {}) // repaint the bag off chain truth → the crafted output appears → quest 'craft' flips
  return result
}
