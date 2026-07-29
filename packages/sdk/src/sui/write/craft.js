// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { Transaction } from '@mysten/sui/transactions'

import {
  aresrpg_deployment,
  shared_object_arg,
  random_shared_ref,
} from '../../deployment/aresrpg.js'
import { as_object_arg } from '../object_arg.js'

// &Random (0x8) PIN — mirrors game_world.js / fight.js `random_arg`: pins the system object via `random_shared_ref`
// when the network's genesis version is stamped; else the unresolved `tx.object.random()`. Byte-identical either way.
/** @param {'mainnet'|'testnet'|'devnet'|'localnet'} network @param {import('@mysten/sui/transactions').Transaction} tx */
function random_arg(network, tx) {
  const ref = random_shared_ref(network)
  return ref ? tx.sharedObjectRef(ref) : tx.object.random()
}

// CRAFTING PTB BUILDER for the merged `aresrpg` package's `crafting` — the single-transaction, exact-ingredient,
// reference-corpus SUCCESS-ROLL craft (craft is NOT deterministic: it rolls a success chance off the crafter's job
// level, so `craft` is a TERMINAL `&Random` entry). The whole flow — read the crafter's level, burn the kiosk-locked
// inputs, roll, MINT-on-success into the character's personal kiosk, credit job XP on every attempt — fits in ONE tx.
//
// ONE KIOSK, BY THE CHAIN'S CONSTRUCTION (#1494 / #1162). The deployed door does the extraction ITSELF:
//
//   entry fun craft(recipe: &Recipe, kiosk: &mut Kiosk, pkcap: &PersonalKioskCap, character_id: ID,
//     input_item_ids: vector<ID>, output_template: &ItemTemplate, xpolicy: &ItemExtractPolicy,
//     policy: &TransferPolicy<Item>, config: &GameConfig, version: &Version, r: &Random, ctx)
//
// `crafting::y93` borrows the CHARACTER out of `kiosk`, and `crafting::y18` runs
// `extract::extract_for_burn(kiosk, pkcap, …)` for EVERY id — all against that single kiosk. So the character and
// every ingredient must live in the SAME personal kiosk; anything else aborts inside `0x2::kiosk` with
// `EItemNotFound` — the player-facing "This item belongs to a different kiosk."
//
// This builder therefore VERIFIES custody instead of assuming it: callers pass the owned-item rows
// (`{ id, kiosk_id, kiosk_cap_id }` — the /v1 owned-items shape), and a row whose kiosk is not the crafting kiosk is
// REFUSED here, naming both kiosks, for zero gas. A knowably-doomed tx is never composed.
//
// The captured deployed signature is pinned in `test/fixtures/crafting_craft_signature.json`; the composition test
// asserts against it, because a builder that invents an overload the chain does not implement is exactly how craft
// broke before (a per-ingredient in-PTB extraction against a `(vector<Item>, vector<BurnPledge>)` door that exists
// in no published package).
//
// Ids resolve through the ONE stamp-or-throw deployment home (deployment/aresrpg.js): until the ceremony stamps
// them this REFUSES LOUDLY (no builder invents an id). S-51b: the singletons — ItemExtractPolicy (EXTRACT_POLICY) /
// ItemPolicy / GameConfig / Version — are STATIC SharedObjectRefs via the shared-version cache; recipe / kiosk /
// pkcap / output_template ride the ref-or-id seam (`as_object_arg`); &Random (0x8) rides `random_arg` LAST
// (terminal command → Random-PTB compliant).

/**
 * The ingredient ids to burn, PROVEN to sit in `kiosk_id`. `input_items` is the owned-items custody shape
 * (`{ id, kiosk_id, kiosk_cap_id }`) and is the form every player-facing caller uses — the rows carry the truth of
 * where each stack lives, so the mismatch is caught here rather than on chain. `input_item_ids` is the flat form for
 * co-located callers (bots, fixtures) that already know their ids sit in the passed kiosk.
 * @param {{ id: string, kiosk_id?: string, kiosk_cap_id?: string }[] | undefined} input_items
 * @param {string[] | undefined} input_item_ids
 * @param {string} kiosk_id
 * @returns {string[]}
 */
function ingredient_ids(input_items, input_item_ids, kiosk_id) {
  if (Array.isArray(input_items) && input_items.length) {
    input_items.forEach((item, index) => {
      if (!item?.id || !item?.kiosk_id)
        throw new Error(
          `[craft_ptb] input_items[${index}] requires id and kiosk_id from the item's owned-items custody record.`,
        )
      // The chain extracts EVERY ingredient from the ONE kiosk it is handed (crafting::y18), which must also hold
      // the crafter's character (crafting::y93) — so a foreign-kiosk ingredient can only abort. Refuse for free.
      if (String(item.kiosk_id) !== String(kiosk_id))
        throw new Error(
          `[craft_ptb] input_items[${index}] (${item.id}) is held in kiosk ${item.kiosk_id}, but the craft runs in kiosk ${kiosk_id} — crafting::craft burns every ingredient out of the crafting kiosk, so an ingredient in another kiosk cannot be crafted.`,
        )
    })
    return input_items.map(item => String(item.id))
  }
  if (Array.isArray(input_item_ids) && input_item_ids.length)
    return input_item_ids.map(String)
  throw new Error(
    '[craft_ptb] input_items must be a non-empty array of owned-item custody records.',
  )
}

/**
 * CRAFT `recipe`: burn the exact ingredient tally out of the crafter's personal kiosk and MINT the recipe output
 * back into it, in ONE tx. `output_template_id` MUST be the recipe's own output template (a forged richer template
 * aborts EWrongOutput on-chain); the ingredient tally must land EXACT (missing / short / wrong inputs abort,
 * reverting every extraction — nothing is lost; an over-large stack auto-splits and the surplus re-locks).
 * @param {import("../../../types.js").Context} context
 */
export function craft_ptb(context) {
  const { network } = context
  return ({
    recipe_id,
    kiosk_id,
    personal_kiosk_cap_id,
    character_id,
    input_item_ids,
    input_items,
    output_template_id,
    tx = new Transaction(),
  }) => {
    const a = aresrpg_deployment(network, context.ids?.aresrpg)
    if (!recipe_id || !output_template_id)
      throw new Error(
        '[craft_ptb] recipe_id and output_template_id are required — the shared Recipe and its output ItemTemplate ids.',
      )
    if (!character_id)
      throw new Error(
        "[craft_ptb] character_id is required — the crafter's Character id (the reference-corpus success roll runs at its job level).",
      )
    if (!kiosk_id || !personal_kiosk_cap_id)
      throw new Error(
        '[craft_ptb] kiosk_id and personal_kiosk_cap_id are required — the personal kiosk holding the crafter and every ingredient.',
      )

    const ids = ingredient_ids(input_items, input_item_ids, kiosk_id)

    tx.moveCall({
      target: `${a.LATEST_PACKAGE_ID}::crafting::craft`,
      arguments: [
        as_object_arg(tx, recipe_id), // recipe: &Recipe
        as_object_arg(tx, kiosk_id), // kiosk: &mut Kiosk (holds the character AND every ingredient)
        as_object_arg(tx, personal_kiosk_cap_id), // pkcap: &PersonalKioskCap
        tx.pure.id(character_id), // character_id: ID (crafter's char — the roll runs at its job level)
        tx.pure.vector('id', ids), // input_item_ids: vector<ID> (burned out of `kiosk`)
        as_object_arg(tx, output_template_id), // output_template: &ItemTemplate (asserted == recipe's output)
        shared_object_arg(tx, network, 'EXTRACT_POLICY', false, a.EXTRACT_POLICY), // xpolicy: &ItemExtractPolicy
        shared_object_arg(tx, network, 'ITEM_POLICY', false, a.ITEM_POLICY), // policy: &TransferPolicy<Item>
        shared_object_arg(tx, network, 'GAME_CONFIG', false, a.GAME_CONFIG), // config: &GameConfig (assert_enabled + crafting kill-switch)
        shared_object_arg(tx, network, 'VERSION', false, a.VERSION), // version: &Version (THE one)
        random_arg(network, tx), // r: &Random (0x8) — TERMINAL command → Random-PTB compliant
      ],
    })
    return tx
  }
}
