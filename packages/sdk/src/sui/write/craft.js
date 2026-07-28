// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { Transaction } from '@mysten/sui/transactions'

import {
  aresrpg_deployment,
  item_type,
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

/** Build a vector from Move-call results (including abilityless BurnPledge values). */
function result_vector(tx, type, values) {
  const [first, ...remaining] = values
  const [vector] = tx.moveCall({
    target: '0x1::vector::singleton',
    typeArguments: [type],
    arguments: [first],
  })
  for (const value of remaining)
    tx.moveCall({
      target: '0x1::vector::push_back',
      typeArguments: [type],
      arguments: [vector, value],
    })
  return vector
}

// CRAFTING PTB BUILDER for the merged `aresrpg` package's `crafting` — the single-transaction, exact-ingredient,
// reference-corpus SUCCESS-ROLL craft — craft is NO LONGER deterministic: it rolls a success chance off the
// crafter's job level, so `craft` is now a TERMINAL `&Random` entry). The whole flow (read the crafter's level → burn
// the crafter's own kiosk-locked inputs → roll → MINT-on-success into the character's personal kiosk, credit job XP
// on every attempt) fits in ONE tx. Each ingredient is extracted from the personal kiosk named by its OWN custody
// row before the craft call; no item reaches a raw address. Ids resolve through the ONE stamp-or-throw deployment
// home (deployment/aresrpg.js):
// until the ceremony stamps the ids this REFUSES LOUDLY (no builder invents an id). S-51b: the singletons —
// ItemExtractPolicy (EXTRACT_POLICY) / ItemPolicy / GameConfig / Version — are STATIC SharedObjectRefs via the
// shared-version cache; recipe / kiosks / pkcaps / output_template ride the ref-or-id seam (`as_object_arg`);
// &Random (0x8) rides `random_arg` LAST (terminal command → Random-PTB compliant).
//
// Craft composition:
//   N × extract::extract_for_burn(ingredient's kiosk, ingredient's pkcap, ingredient id, ...)
//   entry fun craft(recipe: &Recipe, kiosk: &mut Kiosk, pkcap: &PersonalKioskCap, character_id: ID,
//     input_items: vector<Item>, input_pledges: vector<BurnPledge>, output_template: &ItemTemplate,
//     policy: &TransferPolicy<Item>, config: &GameConfig, version: &Version, r: &Random, ctx)

/**
 * CRAFT `recipe`: extract every selected ingredient from the personal kiosk recorded on that owned-item row,
 * CONSUME the extracted values, and MINT the recipe output into the character's personal kiosk in ONE tx.
 * `output_template_id` MUST be the recipe's own output template (a forged richer template aborts EWrongOutput
 * on-chain); the ingredient tally must land EXACT (missing / short / wrong / over-supplied inputs all abort,
 * reverting every extraction — nothing is lost).
 *
 * `input_items` is the owned-items custody shape: `{ id, kiosk_id, kiosk_cap_id }`. The builder deliberately
 * consumes those records directly instead of accepting a flat id list plus one assumed kiosk. The legacy
 * `input_item_ids` form remains for co-located SDK callers and is normalized to the supplied character kiosk/cap.
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

    const custody_items = Array.isArray(input_items)
      ? input_items
      : Array.isArray(input_item_ids)
        ? input_item_ids.map(id => ({
            id,
            kiosk_id,
            kiosk_cap_id: personal_kiosk_cap_id,
          }))
        : null
    if (!Array.isArray(custody_items) || custody_items.length === 0)
      throw new Error(
        "[craft_ptb] input_items must be a non-empty array of owned-item custody records.",
      )
    custody_items.forEach((item, index) => {
      if (!item?.id || !item?.kiosk_id || !item?.kiosk_cap_id)
        throw new Error(
          `[craft_ptb] input_items[${index}] requires id, kiosk_id and kiosk_cap_id from the item's owned-items custody record.`,
        )
    })

    const version = shared_object_arg(
      tx,
      network,
      'VERSION',
      false,
      a.VERSION,
    )
    const xpolicy = shared_object_arg(
      tx,
      network,
      'EXTRACT_POLICY',
      false,
      a.EXTRACT_POLICY,
    )
    const extracted = custody_items.map(item =>
      tx.moveCall({
        target: `${a.LATEST_PACKAGE_ID}::extract::extract_for_burn`,
        arguments: [
          as_object_arg(tx, item.kiosk_id),
          as_object_arg(tx, item.kiosk_cap_id),
          tx.pure.id(item.id),
          xpolicy,
          version,
        ],
      }),
    )
    const input_values = result_vector(
      tx,
      item_type(a),
      extracted.map(([item]) => item),
    )
    const input_pledges = result_vector(
      tx,
      `${a.PACKAGE_ID}::extract::BurnPledge`,
      extracted.map(([, pledge]) => pledge),
    )

    tx.moveCall({
      target: `${a.LATEST_PACKAGE_ID}::crafting::craft`,
      arguments: [
        as_object_arg(tx, recipe_id), // recipe: &Recipe
        as_object_arg(tx, kiosk_id), // kiosk: &mut Kiosk
        as_object_arg(tx, personal_kiosk_cap_id), // pkcap: &PersonalKioskCap
        tx.pure.id(character_id), // character_id: ID (crafter's char — the roll runs at its job level)
        input_values, // input_items: vector<Item> (each extracted from its own custody kiosk)
        input_pledges, // input_pledges: vector<BurnPledge> (paired by index)
        as_object_arg(tx, output_template_id), // output_template: &ItemTemplate (asserted == recipe's output)
        shared_object_arg(tx, network, 'ITEM_POLICY', false, a.ITEM_POLICY), // policy: &TransferPolicy<Item>
        shared_object_arg(tx, network, 'GAME_CONFIG', false, a.GAME_CONFIG), // config: &GameConfig (assert_enabled + crafting kill-switch)
        version, // version: &Version (THE one)
        random_arg(network, tx), // r: &Random (0x8) — TERMINAL command → Random-PTB compliant
      ],
    })
    return tx
  }
}
