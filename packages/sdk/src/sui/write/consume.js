import { Transaction } from '@mysten/sui/transactions'

import {
  aresrpg_deployment,
  shared_object_arg,
} from '../../deployment/aresrpg.js'
import { as_object_arg } from '../object_arg.js'

// CONSUME PTB BUILDER for the merged `aresrpg` package's `consume` — the out-of-fight USE of a heal consumable
// (SPEC §10). ONE call targets `consume::use_many(quantity)`: it extracts the potion stack from the caller's
// personal kiosk, burns exactly `quantity` units through the extract door, and applies the batched heal via
// `character_link::heal_hp`. `use_consumable` (single) is just `use_many` with quantity 1, so this builder always
// targets `use_many` and carries the batched `quantity` — the §10 multi-use DEBOUNCE (rapid clicks = ONE tx of
// the accumulated magnitude, never one tx per unit). Deterministic (no `&Random`). Aborts leave no partial write:
// ECharacterInFight (mid-fight dirty marker), ENotConsumable, EUnsupportedEffect, ELevelTooLow, EZeroQuantity —
// all honest refusals — plus the full-HP refusal in heal_hp (blocked when pointless). Every item op stays inside
// the caller's personal kiosk (kiosk-lock constitution). Ids resolve through the ONE stamp-or-throw deployment
// home (deployment/aresrpg.js): an un-stamped ceremony REFUSES LOUDLY (no builder invents an id).
//
// FROZEN Move signature (read firsthand from packages/move/aresrpg/sources/consume.move):
//   entry fun use_many(kiosk: &mut Kiosk, pkcap: &PersonalKioskCap, character_id: ID, item_id: ID,
//     template: &ItemTemplate, xpolicy: &ItemExtractPolicy, market_policy: &TransferPolicy<Item>,
//     config: &GameConfig, version: &Version, items_version: &ItemsVersion, clock: &Clock, quantity: u64, ctx)
// NOTE: after the S-46 merge `Version` and `ItemsVersion` are the SAME `aresrpg::version::Version` (one package,
// one Version) — both args take the single VERSION singleton.

/**
 * USE `quantity` units of the consumable `item_id` to heal `character_id`, in ONE tx (`consume::use_many`).
 * `template_id` MUST be the potion's own shared `ItemTemplate` (its `consumable_effect` DF is where the heal
 * magnitude + required level live; a wrong template aborts on-chain, reverting the burn). The character must be
 * IDLE (kiosk-locked) and out of any live fight; a full-HP character aborts (blocked when pointless, SPEC §10 —
 * the UI pre-checks this before firing). `quantity` ≥ 1.
 * @param {import("../../../types.js").Context} context
 */
export function consume_potion_ptb(context) {
  const { network } = context
  return ({
    kiosk_id,
    personal_kiosk_cap_id,
    character_id,
    item_id,
    template_id,
    quantity = 1,
    tx = new Transaction(),
  }) => {
    const a = aresrpg_deployment(network, context.ids?.aresrpg)
    if (!kiosk_id || !personal_kiosk_cap_id)
      throw new Error(
        '[consume_potion_ptb] kiosk_id and personal_kiosk_cap_id are required — the personal kiosk holding the character + its owner cap.',
      )
    if (!character_id || !item_id)
      throw new Error(
        '[consume_potion_ptb] character_id and item_id are required — the kiosk-locked Character + the potion stack to consume.',
      )
    if (!template_id)
      throw new Error(
        "[consume_potion_ptb] template_id is required — the potion's shared ItemTemplate (its consumable_effect DF carries the heal).",
      )
    if (!Number.isInteger(quantity) || quantity < 1)
      throw new Error(
        `[consume_potion_ptb] quantity must be an integer ≥ 1 (got ${quantity}) — the batched multi-use magnitude.`,
      )

    tx.moveCall({
      target: `${a.GIFTING_PACKAGE_ID}::consume::use_many`,
      arguments: [
        as_object_arg(tx, kiosk_id), // kiosk: &mut Kiosk
        as_object_arg(tx, personal_kiosk_cap_id), // pkcap: &PersonalKioskCap
        tx.pure.id(character_id), // character_id: ID
        tx.pure.id(item_id), // item_id: ID (the potion stack)
        as_object_arg(tx, template_id), // template: &ItemTemplate (the potion's own template)
        shared_object_arg(tx, network, 'EXTRACT_POLICY', false, a.EXTRACT_POLICY), // xpolicy: &ItemExtractPolicy
        shared_object_arg(tx, network, 'ITEM_POLICY', false, a.ITEM_POLICY), // market_policy: &TransferPolicy<Item>
        shared_object_arg(tx, network, 'GAME_CONFIG', false, a.GAME_CONFIG), // config: &GameConfig (assert_enabled + the game freeze)
        shared_object_arg(tx, network, 'VERSION', false, a.VERSION), // version: &Version (THE one)
        shared_object_arg(tx, network, 'VERSION', false, a.VERSION), // items_version: &ItemsVersion (post-merge = the SAME single VERSION)
        tx.object.clock(), // clock: &Clock (0x6) — the heal's lazy-regen timestamp anchor
        tx.pure.u64(quantity), // quantity: u64 (the batched multi-use magnitude)
      ],
    })
    return tx
  }
}
