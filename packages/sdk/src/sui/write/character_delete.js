import { Transaction } from '@mysten/sui/transactions'

import {
  aresrpg_deployment,
  shared_object_arg,
} from '../../deployment/aresrpg.js'
import { as_object_arg } from '../object_arg.js'

// CHARACTER DELETE PTB BUILDER — deletes a character from the characters tab, provided everything was
// unequipped first (even the free one). The Move door is
// `character_extract::delete_character`: ONE call that zero-price-extracts the kiosk-LOCKED character through
// the sealed empty `CharacterExtractPolicy` (the `extract::ItemExtractPolicy` mechanism applied to Character),
// asserts the guard set ON-CHAIN — nothing equipped (EItemsEquipped 101), no unopened fight
// (EUnfinishedBusiness 102), no dungeon lock (EInDungeon 103) — emits `CharacterDeleted` and DESTROYS the
// character in the same call. No pledge, no borrow_val dance: the raw Character never crosses a public
// boundary, so the kiosk-lock constitution holds by construction. IRREVERSIBLE — and the NAME stays reserved
// forever (derived_object has no unclaim); the UI's confirm step states both.
//
// FROZEN Move signature (read firsthand from packages/move/aresrpg/sources/character_extract.move):
//   public fun delete_character(kiosk: &mut Kiosk, pkcap: &PersonalKioskCap, character_id: ID,
//                               policy: &CharacterExtractPolicy, version: &Version, ctx: &mut TxContext)

/**
 * DELETE (burn in-kiosk) one character the wallet owns. Composes the single `delete_character` moveCall;
 * the kiosk/pkcap params ride the ref-or-id seam (`as_object_arg`), Version + the wrapped extraction policy
 * ride the static shared-ref seam (S-51b). `CHARACTER_EXTRACT_POLICY` is stamped at the upgrade ceremony —
 * an unstamped network refuses loudly here (never guesses), same law as every deployment id.
 * @param {import("../../../types.js").Context} context
 */
export function delete_character_ptb(context) {
  const { network } = context
  return ({
    kiosk_id,
    personal_kiosk_cap_id,
    character_id,
    tx = new Transaction(),
  }) => {
    const a = aresrpg_deployment(network, context.ids?.aresrpg)
    if (!a.CHARACTER_EXTRACT_POLICY)
      throw new Error(
        `[character_delete] CHARACTER_EXTRACT_POLICY is not stamped for "${network}" — the character-delete ` +
          'door ships with the next upgrade ceremony (create_character_extract_policy). Refusing to compose ' +
          'a PTB against a missing shared policy.',
      )
    tx.moveCall({
      target: `${a.LATEST_PACKAGE_ID}::character_extract::delete_character`,
      arguments: [
        as_object_arg(tx, kiosk_id), // kiosk: &mut Kiosk
        as_object_arg(tx, personal_kiosk_cap_id), // pkcap: &PersonalKioskCap
        tx.pure.id(character_id), // character_id: ID
        shared_object_arg(tx, network, 'CHARACTER_EXTRACT_POLICY', false, a.CHARACTER_EXTRACT_POLICY), // policy: &CharacterExtractPolicy
        shared_object_arg(tx, network, 'VERSION', false, a.VERSION), // version: &Version
      ],
    })
    return tx
  }
}
