// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import {
  aresrpg_deployment,
  shared_object_arg,
  random_shared_ref,
} from '../../deployment/aresrpg.js'
import { as_object_arg } from '../object_arg.js'

import { new_ptb } from './header.js'

// &Random (0x8) PIN — mirrors game_world.js / fight.js `random_arg`: pins the system object via `random_shared_ref`
// when the network's genesis version is stamped; else the unresolved `tx.object.random()`. Byte-identical either way.
/** @param {'mainnet'|'testnet'|'devnet'|'localnet'} network @param {import('@mysten/sui/transactions').Transaction} tx */
function random_arg(network, tx) {
  const ref = random_shared_ref(network)
  return ref ? tx.sharedObjectRef(ref) : tx.object.random()
}

// CRAFTING PTB BUILDER for the merged `aresrpg` package's `crafting` — the single-transaction, exact-ingredient,
// reference-corpus SUCCESS-ROLL craft — craft is NO LONGER deterministic: it rolls a success chance off the
// crafter's job level, so `craft` is now a TERMINAL `&Random` entry). The whole flow (read the crafter's level → burn
// the crafter's own kiosk-locked inputs → roll → MINT-on-success into the crafter's personal kiosk, credit job XP on
// every attempt) fits in ONE tx. Every item op stays inside the crafter's personal kiosk (kiosk-lock constitution —
// nothing reaches a raw address). Ids resolve through the ONE stamp-or-throw deployment home (deployment/aresrpg.js):
// until the ceremony stamps the ids this REFUSES LOUDLY (no builder invents an id). S-51b: the singletons —
// ItemExtractPolicy (EXTRACT_POLICY) / ItemPolicy / GameConfig / Version — are STATIC SharedObjectRefs via the
// shared-version cache; recipe / kiosk / pkcap / output_template ride the ref-or-id seam (`as_object_arg`); &Random
// (0x8) rides `random_arg` LAST (terminal command → Random-PTB compliant).
//
// FROZEN Move signature (read firsthand from packages/move/aresrpg/sources/crafting.move:160):
//   entry fun craft(recipe: &Recipe, kiosk: &mut Kiosk, pkcap: &PersonalKioskCap, character_id: ID,
//     input_item_ids: vector<ID>, output_template: &ItemTemplate, xpolicy: &ItemExtractPolicy,
//     policy: &TransferPolicy<Item>, config: &GameConfig, version: &Version, r: &Random, ctx)

/**
 * CRAFT `recipe`: CONSUME the crafter's kiosk-locked `input_item_ids` (burned through the extract seam) and MINT the
 * recipe's output into the crafter's personal kiosk in ONE tx. `output_template_id` MUST be the recipe's own output
 * template (a forged richer template aborts EWrongOutput on-chain); the ingredient tally must land EXACT (missing /
 * short / wrong / over-supplied inputs all abort, reverting the burns — nothing is lost). `input_item_ids` are the
 * IDs of the crafter's OWN kiosk-locked ingredient items (pure IDs — the items are extracted from `kiosk` by id).
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
    output_template_id,
    tx = new_ptb(context.network, context.ids?.aresrpg),
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
    if (!Array.isArray(input_item_ids) || input_item_ids.length === 0)
      throw new Error(
        "[craft_ptb] input_item_ids must be a non-empty array of the crafter's kiosk-locked ingredient item ids.",
      )

    tx.moveCall({
      target: `${a.LATEST_PACKAGE_ID}::crafting::craft`,
      arguments: [
        as_object_arg(tx, recipe_id), // recipe: &Recipe
        as_object_arg(tx, kiosk_id), // kiosk: &mut Kiosk
        as_object_arg(tx, personal_kiosk_cap_id), // pkcap: &PersonalKioskCap
        tx.pure.id(character_id), // character_id: ID (crafter's char — the roll runs at its job level)
        tx.pure.vector('id', input_item_ids), // input_item_ids: vector<ID>
        as_object_arg(tx, output_template_id), // output_template: &ItemTemplate (asserted == recipe's output)
        shared_object_arg(
          tx,
          network,
          'EXTRACT_POLICY',
          false,
          a.EXTRACT_POLICY,
        ), // xpolicy: &ItemExtractPolicy
        shared_object_arg(tx, network, 'ITEM_POLICY', false, a.ITEM_POLICY), // policy: &TransferPolicy<Item>
        shared_object_arg(tx, network, 'GAME_CONFIG', false, a.GAME_CONFIG), // config: &GameConfig (assert_enabled + crafting kill-switch)
        shared_object_arg(tx, network, 'VERSION', false, a.VERSION), // version: &Version (THE one)
        random_arg(network, tx), // r: &Random (0x8) — TERMINAL command → Random-PTB compliant
      ],
    })
    return tx
  }
}
