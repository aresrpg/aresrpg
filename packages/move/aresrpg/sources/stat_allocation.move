// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// STAT ALLOCATION (§3) — the character-holder's spend door that turns earned STAT points into per-stat allocations, the twin of
/// `spell_level::raise_spell_level`. SPEC §3: "each level from 2 grants 5 stat points to assign freely and 1 spell
/// point." Before this door the stat half of `progression::points_for_level_range` was DISCARDED at every call site
/// (`character_link::unspent_spell_points` took only `.1`), so leveling silently threw away the stat points players
/// earned — this is the missing half of the progression system.
///
/// COST MODEL — FLAT, "assign freely" (SPEC §3): +1 to a stat costs exactly 1 stat point; there is NO escalating
/// cost curve (none exists in SPEC or `aresrpg_foundation`, unlike the spell escalation). So `raise_stat(stat, n)`
/// costs `n` points and raises that stat by `n`. The stat DF + the derived unspent view live on `character_link`
/// (one home); this door is the only writer. The allocated block feeds combat through `equipment::folded_stats`
/// (vitality → the HP recompute in `fold_gear`; strength/intelligence/agility/chance → the §17.27 damage lines).
///
/// OWNERSHIP GATE — identical to `raise_spell_level` / `character_link::flip_world`: `kiosk::borrow_mut` asserts the
/// `PersonalKioskCap` matches the kiosk the character is locked in, so ONLY the matching cap holder reaches the mutable Character
/// (a non-owner cap aborts `sui::kiosk::ENotOwner`). Version-gated (a value path). All asserts precede both writes,
/// and the second write cannot fail after the first (checked arithmetic, add-or-create slots) — no partial write.
///
/// PTB-first: ONE stat per call (N points at once); the SDK composes several calls to spread points across stats.
/// KIND_STAT_RESET (`consumable_effect`) stays FORWARD-DECLARED — no respec consumable ships yet, so no reset door.
module aresrpg::stat_allocation;

use aresrpg::{character_link, version::Version};
use kiosk::personal_kiosk::{Self, PersonalKioskCap};
use sui::{event, kiosk::Kiosk};

// ╔════════════════ [ Errors ] ═══════════════════════════════════════════════ ]

const EBadStat: u64 = 101; // the stat index is out of range (>= character_link::stat_count())
const EZeroPoints: u64 = 102; // a raise must allocate at least 1 point
const ENoStatPoints: u64 = 103; // fewer unspent stat points than the requested allocation

// ╔════════════════ [ Event ] ════════════════════════════════════════════════ ]

/// A stat was raised: `stat` index, `points` allocated this call, `stat_total` = the stat's NEW allocated total.
public struct StatRaised has copy, drop { character: ID, stat: u8, points: u64, stat_total: u64 }

// ╔════════════════ [ Spend door (holder-gated, PTB-first) ] ═══════════════════ ]

/// Spend `points` stat points to raise the character's `stat` allocation. Owner-gated by the personal-kiosk cap
/// EXACTLY like `spell_level::raise_spell_level`. Aborts (all before any write): `EBadStat` (stat >= count),
/// `EZeroPoints` (points == 0), `sui::kiosk::ENotOwner` (wrong cap), `ENoStatPoints` (unspent < points).
public fun raise_stat(
  kiosk: &mut Kiosk,
  pkcap: &PersonalKioskCap,
  character_id: ID,
  stat: u8,
  points: u64,
  version: &Version,
) {
  version.assert_enabled();
  assert!(stat < character_link::stat_count(), EBadStat);
  assert!(points >= 1, EZeroPoints);

  let owner_cap = personal_kiosk::borrow(pkcap);
  let chr = kiosk.borrow_mut(owner_cap, character_id);

  // DERIVED unspent = the STAT half of the per-level grant MINUS points already spent (never banked, floors at 0).
  assert!(character_link::unspent_stat_points(chr) >= points, ENoStatPoints);

  character_link::add_stat_points_spent(chr, points, version);
  let stat_total = character_link::add_stat_allocated(chr, stat, points, version);
  event::emit(StatRaised { character: character_id, stat, points, stat_total });
}
