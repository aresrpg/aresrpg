// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// LEARNED-SPELL LEVELS (S-12d) — the character-holder's spend door that turns earned spell points into per-spell levels.
/// SPEC §3 ("each level from 2 grants ... 1 spell point") + §7 ("spell points level it up; spell points bind to
/// the spell on the character"). This is the SINGLE game→spells contact in the package: the authoritative
/// per-spell MAX and the per-level character-level gate live only on the `aresrpg::SpellTemplate` shared
/// object, so the door reads them straight from it — a caller-supplied max/gate would be forgeable. The invested
/// level + the spent-points ledger live under NS_CHARACTER_WORLD on the Character (custodied world_cap — see
/// `character_link`, which owns that DF plumbing); the free read side (`character_link::spell_level`) is the
/// fight-snapshot seam that closes cast.move's F-07 level-1 gap.
///
/// ADOPTED RULES (stated at the placement, per the one-home law):
///   • COST to raise a spell from its current level `c` to `c+1` = `c` points (i.e. target_level − 1). Owner
///     ruling S8 (balance_audit §7.8), already the rule in `aresrpg_foundation::spell_book`: maxing ONE spell
///     1→6 costs 1+2+3+4+5 = 15, so full-kit mastery lands ~L90 (keeps the "which spell do I level?" decision).
///     SPEC §3 is silent on the number; this MIRRORS the existing foundation home rather than coining a second.
///   • CHARACTER-LEVEL GATE (#57, 1.29): raising TO level `t` needs `character.level() ≥` that level's
///     `min_char_level` (monotone; L6 = z502+100 — enforced at mint). Read from the template.
///   • MAX level = `spell_template::levels(spell).length()` (every template is exactly 6 by construction).
/// PTB-first: ONE level per call, no batch door; Move enforces the invariants, the SDK composes the sequence.
module aresrpg::spell_level;

use aresrpg_foundation::spell_effect;
use aresrpg::{character_link, version::Version};
use aresrpg::character;
use aresrpg_spells::spell_template::{Self, SpellTemplate};
use kiosk::personal_kiosk::{Self, PersonalKioskCap};
use sui::kiosk::Kiosk;

// ╔════════════════ [ Errors ] ═══════════════════════════════════════════════ ]

const ENotClassSpell: u64 = 101; // the spell's class is not the character's — its points could never be cast
const EAlreadyMaxLevel: u64 = 102; // the spell is already at the template's top level
const ECharLevelTooLow: u64 = 103; // character level below the TARGET level's min_char_level (#57 gate)
const ENoSpellPoints: u64 = 104; // fewer unspent spell points than the escalating cost

// ╔════════════════ [ Spend door (holder-gated, PTB-first) ] ═══════════════════ ]

/// Spend spell points to raise ONE owned spell by ONE level. Owner-gated by the personal-kiosk cap EXACTLY like
/// `character_link::flip_world`: `kiosk::borrow_mut` asserts the cap matches the kiosk the character is locked
/// in, so only the matching cap holder reaches the mutable Character (a mismatched cap aborts `sui::kiosk::ENotOwner`). game-
/// freeze + items-freeze gated (this is a value path). Aborts leave no partial write (all asserts precede both
/// writes, and the second write cannot fail after the first — checked arithmetic, existing slots).
public fun raise_spell_level(
  kiosk: &mut Kiosk,
  pkcap: &PersonalKioskCap,
  character_id: ID,
  spell: &SpellTemplate,
  version: &Version,
) {
  version.assert_enabled();
  let owner_cap = personal_kiosk::borrow(pkcap);
  let chr = kiosk.borrow_mut(owner_cap, character_id);

  // a character may only level a spell of its OWN class (cast.move gates casts by this same match; investing in
  // a foreign-class spell would burn the points forever).
  assert!(spell_template::class(spell) == character::class(chr), ENotClassSpell);

  let spell_id = spell_template::spell_id(spell);
  let current = character_link::spell_level(chr, spell_id);
  assert!((current as u64) < spell_template::levels(spell).length(), EAlreadyMaxLevel);
  let target = current + 1;

  // #57 gate: the character must have reached the target level's min_char_level (read off the authoritative template).
  let required = spell_effect::min_char_level(spell_template::level_of(spell, target));
  assert!(character_link::level(chr) >= (required as u64), ECharLevelTooLow);

  // S8 escalating cost: raising to `target` costs `target − 1 = current` points.
  let cost = current as u64;
  assert!(character_link::unspent_spell_points(chr) >= cost, ENoSpellPoints);

  character_link::z4(chr, cost, version);
  character_link::z3(chr, spell_id, target, version);
}
