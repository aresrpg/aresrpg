// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// CHARACTER_EXTRACT — the zero-price seam that pulls a kiosk-LOCKED Character back out of its personal kiosk
/// for the ONE legitimate non-trade reason a character leaves the market: to be DELETED —
/// characters must be deletable from the characters tab, provided everything is unequipped first, even the free one.
/// The `extract` module's exact mechanism, applied to `Character` (DECISIONS 2026-07-08 "Extract-seam ruling"):
///
/// THE PROBLEM. Every character is force-locked into a PERSONAL kiosk at mint (the `LockPledge` constitution).
/// A locked object leaves a kiosk ONLY via `list` → `purchase` → `confirm_request` against a
/// `TransferPolicy<Character>`. The MARKETPLACE character policy carries rules (kiosk-lock + royalty +
/// personal-kiosk + the §17.30 level gate), so a normal trade re-locks and pays — but a DELETE is not a trade:
/// the character must come fully OUT and DIE. This module runs the zero-price flow against a permanently EMPTY
/// policy that is WRAPPED (cap sealed inside, no accessor), so no raw `&TransferPolicy<Character>` ever escapes
/// and no external code can confirm a hand-rolled request against it (the royalty-evasion / unlock-escape class,
/// closed by construction exactly like `extract::ItemExtractPolicy`).
///
/// WHY NO ESCAPE (the type argument). Unlike the item seam, NO pledge is needed here: extraction, the guard
/// set, the event and `character::destroy` all compose INSIDE the one public door — a raw `Character` value
/// never crosses a public boundary, so it can never be walked off to an address. The character ceases to exist
/// in the same call that extracted it; there is no address-delivery path anywhere in this package.
///
/// THE GUARD SET (each refusal maps to honest player copy in the frontend decoder):
///   • EItemsEquipped     — `equipment::any_equipped` (the map's occupancy truth). An equipped Item lives as a
///     DF under the character; deleting would ORPHAN it — destroyed player value. Unequip first, always.
///   • EUnfinishedBusiness — `fight_marker` pending obligations (an unopened PvM result / live seat): the same
///     wall the SALE rule enforces (`character_listing_rule`) — opening needs the character alive.
///   • EInDungeon         — a live dungeon lock: exit/abandon the run first (the exit door always composes).
/// Plain-DATA dynamic fields (progression / world / checkpoints / spell + stat spends) are ORPHANED by design —
/// un-enumerable on-chain, no extractable value (see character.move's DELETION note). The name stays reserved
/// forever (`derived_object` has no unclaim) — the delete UI states it.
///
/// CEREMONY IMPLICATION. The Character type gets a SECOND policy: (1) the MARKETPLACE policy from
/// `character::create_character_policy` (ceremony binds kiosk-lock + royalty + personal-kiosk + listing-level
/// rules); (2) THIS extraction policy from `create_character_extract_policy` — permanently EMPTY, wrapped, its
/// cap sealed inside so no rule can ever be added. Safe empty precisely because it is wrapped + consumed only
/// inside the delete door. Stamped into the SDK deployment as CHARACTER_EXTRACT_POLICY at the upgrade ceremony.
module aresrpg::character_extract;

use aresrpg::{
  character::{Self, Character},
  dungeon_lock,
  equipment,
  fight_marker,
  version::Version
};
use kiosk::personal_kiosk::{Self, PersonalKioskCap};
use std::string::String;
use sui::{
  coin,
  event,
  kiosk::Kiosk,
  package::Publisher,
  sui::SUI,
  transfer_policy::{Self, TransferPolicy, TransferPolicyCap}
};

// ╔════════════════ [ Constants (teach, don't reject — the frontend maps each to human copy) ] ═ ]

const EItemsEquipped: u64 = 101; // delete_character: an equipped item would be orphaned — unequip everything first
const EUnfinishedBusiness: u64 = 102; // delete_character: unopened fight result / live PvM seat — open it first
const EInDungeon: u64 = 103; // delete_character: a live dungeon lock — exit or abandon the run first

// ╔════════════════ [ Types ] ════════════════════════════════════════════════ ]

/// The WRAPPED character-extraction policy. `policy` is a permanently rule-less `TransferPolicy<Character>`
/// and `cap` is its `TransferPolicyCap<Character>` — SEALED inside with no accessor, so no rule can ever be
/// added and the policy stays confirmable-with-no-receipts forever. Only `delete_character` (this module)
/// reaches `&self.policy` to confirm the zero-price request. `key` only — shared, never wrapped or moved.
public struct CharacterExtractPolicy has key {
  id: UID,
  policy: TransferPolicy<Character>,
  cap: TransferPolicyCap<Character>,
}

// ╔════════════════ [ Events ] ═══════════════════════════════════════════════ ]

/// A character was deleted (burned in-kiosk). The indexer drops the character from every projection off this;
/// `name`/`class`/`experience` ride along so read models can tombstone without a pre-delete snapshot. The name
/// itself stays permanently reserved on the creation gate (derived_object law).
public struct CharacterDeleted has copy, drop { character: ID, name: String, class: String, experience: u64 }

public struct CharacterExtractPolicyCreated has copy, drop { policy: ID }

// ╔════════════════ [ Extraction policy — Publisher gated (ceremony creates it) ] ═ ]

/// Create + SHARE the wrapped, permanently-EMPTY character-extraction policy (authority IS the `Publisher`,
/// `assert_latest` so it is authored at ceremony while dark). The returned `TransferPolicyCap<Character>` is
/// SEALED inside the wrapper (never handed out), so the inner policy can never gain a rule. Distinct from the
/// marketplace `character::create_character_policy`; see the module CEREMONY note.
public fun create_character_extract_policy(publisher: &Publisher, version: &Version, ctx: &mut TxContext) {
  version.assert_latest();
  let (policy, cap) = transfer_policy::new<Character>(publisher, ctx);
  let wrapper = CharacterExtractPolicy { id: object::new(ctx), policy, cap };
  event::emit(CharacterExtractPolicyCreated { policy: object::id(&wrapper) });
  transfer::share_object(wrapper);
}

// ╔════════════════ [ The DELETE door (holder-signed via the personal-kiosk cap) ] ═ ]

/// DELETE `character_id` out of the caller's personal kiosk: zero-price extract (list 0 → purchase with a zero
/// coin → confirm against the sealed empty policy — `list` aborts in the framework unless the caller's kiosk
/// holds the item AND the cap matches, so only the caller holding the matching cap can reach their own character), assert the guard set
/// on the extracted value, emit `CharacterDeleted`, and DESTROY it. One door, no pledge: the raw `Character`
/// never crosses a public boundary. Any guard abort reverts the extraction with the whole tx. Value path —
/// `assert_enabled` gated. IRREVERSIBLE; the name stays reserved forever.
public fun delete_character(
  kiosk: &mut Kiosk,
  pkcap: &PersonalKioskCap,
  character_id: ID,
  policy: &CharacterExtractPolicy,
  version: &Version,
  ctx: &mut TxContext,
) {
  version.assert_enabled();

  // the zero-price extraction — the sole site that reads `&policy.policy` (the wrapping is what keeps this
  // confirm unreachable to any hand-rolled request; the empty policy needs no receipts).
  let owner_cap = personal_kiosk::borrow(pkcap);
  kiosk.list<Character>(owner_cap, character_id, 0);
  let (character, request) = kiosk.purchase<Character>(character_id, coin::zero<SUI>(ctx));
  let (_id, _paid, _from) = policy.policy.confirm_request(request);

  // the guard set (on the extracted value — an abort reverts the extraction too)
  assert!(!equipment::any_equipped(&character), EItemsEquipped);
  assert!(fight_marker::is_unmarked(&character), EUnfinishedBusiness);
  assert!(!dungeon_lock::is_locked(&character), EInDungeon);

  event::emit(CharacterDeleted {
    character: character_id,
    name: character::name(&character),
    class: character::class(&character),
    experience: character::experience(&character),
  });
  character::destroy(character);
}

// ╔════════════════ [ Testing ] ══════════════════════════════════════════════ ]

#[test_only]
public fun deleted_character(e: &CharacterDeleted): ID { e.character }

#[test_only]
public fun deleted_name(e: &CharacterDeleted): String { e.name }
