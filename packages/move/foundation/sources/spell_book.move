// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// SPELL BOOK — spell DEFINITIONS and per-character allocation (exact 1.29). A spell is NOT a flat
/// struct: every spell has 6 LEVELS, and a character raises a spell 1→6 by spending 1 SPELL POINT per level
/// (mirroring stat-point allocation). Each level tweaks its `SpellLevel` params (lower AP cost, +range, bigger
/// AoE, higher fixed base). Resolution reads the caster's CURRENT level of the cast spell and uses THAT
/// level's `SpellLevel`.
///
///  * `Spell`            — a spell definition: id + an ARRAY of exactly 6 `SpellLevel`s (index 0 = level 1).
///  * `SpellAllocation`  — a character's spellbook: spell_id → current level (1..6) + unspent spell points.
///
/// DESIGN — WHERE IT LIVES (touchpoint flagged for the character worker): `SpellAllocation` is `store` +
/// `drop`, so `Character` embeds ONE `spells: SpellAllocation` field (init `spell_book::new_allocation()`) and
/// grants points at level-up via `grant_points`. The effect KINDS are unchanged — only the definition shape
/// gains its 6-level array + the allocation, per D25.
module aresrpg_foundation::spell_book;

use aresrpg_foundation::spell_effect::SpellLevel;
use sui::vec_map::{Self, VecMap};

// The module alias is a TEST-ONLY need: only the `#[test_only]` fixture builders below call
// `spell_effect::` doors. A plain `use` reads as unused in the release build the ceremony
// probe compiles, which is exactly the warning that blocked it.
#[test_only]
use aresrpg_foundation::spell_effect;

const MAX_LEVEL: u8 = 6; // exact 1.29: every spell has 6 levels

const EWrongLevelCount: u64 = 201; // new_spell: must supply exactly 6 levels
const ELevelOutOfRange: u64 = 202; // spell_level: level not in 1..=6
const ENotLearned: u64 = 203; // upgrade/resolve: spell not learned (level 0)
const EAlreadyMaxLevel: u64 = 204; // upgrade: already at level 6
const ENoSpellPoints: u64 = 205; // upgrade: insufficient unspent spell points (S8 cost = target_level − 1)
const ECharLevelTooLow: u64 = 206; // upgrade: character.level() below the TARGET level's min_char_level (#57 gate)

// ╔════════════════ [ Spell definition — the 6-level array ] ══════════════════════ ]

/// A spell definition: a stable `id` and its 6 per-level configs (`levels[0]` = level 1 … `levels[5]` = level
/// 6). `copy,drop,store` so a catalog can hand out definitions freely.
public struct Spell has copy, drop, store {
  id: u16,
  levels: vector<SpellLevel>,
}

public fun max_level(): u8 { MAX_LEVEL }

/// Build a spell from EXACTLY 6 level structs (asserts the count — a level-less/short array is rejected).
public fun new_spell(id: u16, levels: vector<SpellLevel>): Spell {
  assert!(levels.length() == (MAX_LEVEL as u64), EWrongLevelCount);
  Spell { id, levels }
}

public fun spell_id(s: &Spell): u16 { s.id }

/// RESOLUTION getter (wire this into `apply_cast`): the `SpellLevel` config for a given level (1..=6). Aborts
/// on an out-of-range level. `resolve_level` below composes this with a character's current level.
public fun level_of(s: &Spell, level: u8): &SpellLevel {
  assert!(level >= 1 && level <= MAX_LEVEL, ELevelOutOfRange);
  s.levels.borrow((level as u64) - 1)
}

// ╔════════════════ [ Character spell-point allocation ] ══════════════════════════ ]

/// A character's spellbook: the current level of each learned spell (absent = not learned = level 0) plus the
/// unspent spell points earned at level-up. `store,drop` so `Character` embeds it.
public struct SpellAllocation has drop, store {
  points: u64,
  levels: VecMap<u16, u8>,
}

public fun new_allocation(): SpellAllocation { SpellAllocation { points: 0, levels: vec_map::empty() } }

public fun points(alloc: &SpellAllocation): u64 { alloc.points }

/// Award spell points at character level-up (mirrors stat-point allocation).
public fun grant_points(alloc: &mut SpellAllocation, n: u64) { alloc.points = alloc.points + n; }

/// Current level of a spell for this character — 0 if never learned.
public fun current_level(alloc: &SpellAllocation, id: u16): u8 {
  if (alloc.levels.contains(&id)) *alloc.levels.get(&id) else 0
}

public fun is_learned(alloc: &SpellAllocation, id: u16): bool { current_level(alloc, id) >= 1 }

/// Learn a spell at level 1 (free, on class/level unlock — no spell point). Idempotent: re-learning a known
/// spell is a no-op (never resets its level).
public fun learn(alloc: &mut SpellAllocation, id: u16) {
  if (!alloc.levels.contains(&id)) alloc.levels.insert(id, 1);
}

/// Spend 1 spell point to raise a learned spell by one level (mirrors stat-point spend). Requires the spell be
/// learned, below max level, a point available, AND (#57) that the character has reached the TARGET level's
/// `min_char_level` — the caller passes its `character.level()`. The `Spell` def carries the per-level gate.
public fun upgrade(alloc: &mut SpellAllocation, spell: &Spell, character_level: u64) {
  let id = spell.id;
  assert!(alloc.levels.contains(&id), ENotLearned);
  let cur = *alloc.levels.get(&id);
  assert!(cur < MAX_LEVEL, EAlreadyMaxLevel);
  // #57 gate: raising TO level `cur+1` requires that level's min_char_level.
  let req = spell.level_of(cur + 1).min_char_level();
  assert!(character_level >= (req as u64), ECharLevelTooLow);
  // S8 (balance_audit §7.8): an upgrade costs `target_level − 1` points (L1→2=1 … L5→6=5),
  // so maxing ONE spell costs 15 and full-kit mastery lands ~L90 — restoring the "which spell do I level"
  // decision the old flat-1-point economy erased after ~L35. target_level = cur+1 ⇒ cost = (cur+1) − 1 = cur.
  let cost = cur as u64;
  assert!(alloc.points >= cost, ENoSpellPoints);
  alloc.points = alloc.points - cost;
  let lvl = alloc.levels.get_mut(&id);
  *lvl = *lvl + 1;
}

/// Resolution entry: the `SpellLevel` config for the caster's CURRENT level of `spell`. Aborts if unlearned.
public fun resolve_level(spell: &Spell, alloc: &SpellAllocation): &SpellLevel {
  let lvl = current_level(alloc, spell.id);
  assert!(lvl >= 1, ENotLearned);
  spell.level_of(lvl)
}

// ═══════════════════════════════════════════════════════════════════════════
// This module is the ENGINE only. Concrete spell DATA (the 6-level `Spell` defs)
// lives in the ADMIN-APPENDABLE `spell_registry` shared object — spells are added
// progressively and FROZEN once added (immutable, no edit). `fire_strike` is the
// seeded worked example there.
// ═══════════════════════════════════════════════════════════════════════════

// ===========================================================================
// Tests — 6-level array shape, per-level scaling, allocation spend, level-aware
// resolution. Use a test-only sample spell (the real data is in spell_registry).
// ===========================================================================

#[test_only]
const TEST_SPELL_ID: u16 = 1;

#[test_only]
fun sample_level(min_lv: u16, ap: u64, rmax: u64, base: u64): SpellLevel {
  spell_effect::new_spell_level(
    min_lv, ap, 1, rmax, false, false, true, false, 255, 255, 0, 50, false, vector[], vector[],
    vector[spell_effect::damage(aresrpg_foundation::spell::el_fire(), base)],
    vector[spell_effect::damage(aresrpg_foundation::spell::el_fire(), base + 7)],
  )
}

// A test spell whose per-level gate ramps 1/10/20/30/40/50 (so the char-level gate is exercisable).
#[test_only]
fun sample_spell(): Spell {
  new_spell(TEST_SPELL_ID, vector[
    sample_level(1, 4, 4, 15), sample_level(10, 4, 4, 17), sample_level(20, 4, 5, 19),
    sample_level(30, 4, 5, 21), sample_level(40, 3, 6, 23), sample_level(50, 3, 6, 25),
  ])
}

#[test]
fun t_spell_has_six_levels_that_scale() {
  let s = sample_spell();
  assert!(s.spell_id() == TEST_SPELL_ID, 0);
  let l1 = s.level_of(1);
  let l6 = s.level_of(6);
  assert!(l1.effects_for(false).borrow(0).value() == 15, 0);
  assert!(l6.effects_for(false).borrow(0).value() == 25, 0);
  assert!(l1.sl_ap_cost() == 4 && l6.sl_ap_cost() == 3, 0);
  assert!(l1.sl_range_max() == 4 && l6.sl_range_max() == 6, 0);
  assert!(l1.min_char_level() == 1 && l6.min_char_level() == 50, 0); // #57 per-level gate rides on SpellLevel
}

#[test]
#[expected_failure(abort_code = ELevelOutOfRange)]
fun t_spell_level_out_of_range_aborts() {
  let s = sample_spell();
  s.level_of(7);
}

#[test]
#[expected_failure(abort_code = EWrongLevelCount)]
fun t_new_spell_rejects_short_array() {
  new_spell(9, vector[sample_level(1, 4, 4, 10)]); // only 1 level -> reject
}

#[test]
fun t_allocation_learn_then_upgrade_spends_points() {
  let s = sample_spell();
  let mut alloc = new_allocation();
  assert!(current_level(&alloc, TEST_SPELL_ID) == 0, 0); // unlearned
  learn(&mut alloc, TEST_SPELL_ID);
  assert!(current_level(&alloc, TEST_SPELL_ID) == 1, 0); // free at unlock
  grant_points(&mut alloc, 3); // S8: 1→2 costs 1, 2→3 costs 2 = 3 total
  upgrade(&mut alloc, &s, 200); // 1 -> 2 (cost 1; char level 200 clears the gate)
  upgrade(&mut alloc, &s, 200); // 2 -> 3 (cost 2)
  assert!(current_level(&alloc, TEST_SPELL_ID) == 3, 0);
  assert!(points(&alloc) == 0, 0); // all 3 points spent (escalating cost)
}

#[test]
#[expected_failure(abort_code = ENoSpellPoints)]
fun t_upgrade_cost_escalates() {
  // S8: 2→3 costs 2 points; only 1 remains after 1→2 → ENoSpellPoints.
  let s = sample_spell();
  let mut alloc = new_allocation();
  learn(&mut alloc, TEST_SPELL_ID);
  grant_points(&mut alloc, 2);
  upgrade(&mut alloc, &s, 200); // 1→2 (cost 1, 1 left)
  upgrade(&mut alloc, &s, 200); // 2→3 needs 2 > 1 → abort
}

#[test]
#[expected_failure(abort_code = ENoSpellPoints)]
fun t_upgrade_without_points_aborts() {
  let s = sample_spell();
  let mut alloc = new_allocation();
  learn(&mut alloc, TEST_SPELL_ID);
  upgrade(&mut alloc, &s, 200); // no points granted (gate cleared at lvl 200) -> ENoSpellPoints
}

#[test]
#[expected_failure(abort_code = ENotLearned)]
fun t_upgrade_unlearned_aborts() {
  let s = sample_spell();
  let mut alloc = new_allocation();
  grant_points(&mut alloc, 1);
  upgrade(&mut alloc, &s, 200); // never learned -> ENotLearned
}

#[test]
fun t_upgrade_caps_at_max_level() {
  let s = sample_spell();
  let mut alloc = new_allocation();
  learn(&mut alloc, TEST_SPELL_ID);
  grant_points(&mut alloc, 15); // S8: 1+2+3+4+5 = 15 to master one spell 1→6
  // raise 1 -> 6 (5 upgrades), char level 200 clears every per-level gate
  let mut i = 0u64;
  while (i < 5) { upgrade(&mut alloc, &s, 200); i = i + 1; };
  assert!(current_level(&alloc, TEST_SPELL_ID) == MAX_LEVEL, 0);
  assert!(points(&alloc) == 0, 0); // exactly 15 spent to reach L6
}

#[test]
#[expected_failure(abort_code = EAlreadyMaxLevel)]
fun t_upgrade_past_max_aborts() {
  let s = sample_spell();
  let mut alloc = new_allocation();
  learn(&mut alloc, TEST_SPELL_ID);
  grant_points(&mut alloc, 15); // enough to fund the first 5 (cost 15); the 6th aborts on the max-level gate
  let mut i = 0u64;
  while (i < 6) { upgrade(&mut alloc, &s, 200); i = i + 1; }; // 6th push past L6 -> EAlreadyMaxLevel
}

#[test]
fun t_resolve_reads_current_level() {
  let s = sample_spell();
  let mut alloc = new_allocation();
  learn(&mut alloc, TEST_SPELL_ID);
  grant_points(&mut alloc, 5);
  // at level 1 (= live config)
  assert!(s.resolve_level(&alloc).effects_for(false).borrow(0).value() == 15, 0);
  upgrade(&mut alloc, &s, 200); // -> 2
  assert!(s.resolve_level(&alloc).effects_for(false).borrow(0).value() == 17, 0);
}

// #57 — the char-level gate: raising to L2 needs char level 10 (sample_spell's ramp).
#[test]
#[expected_failure(abort_code = ECharLevelTooLow)]
fun t_upgrade_below_char_level_aborts() {
  let s = sample_spell();
  let mut alloc = new_allocation();
  learn(&mut alloc, TEST_SPELL_ID);
  grant_points(&mut alloc, 1);
  upgrade(&mut alloc, &s, 9); // char level 9 < L2 requirement 10 -> ECharLevelTooLow
}

#[test]
fun t_upgrade_at_char_level_ok() {
  let s = sample_spell();
  let mut alloc = new_allocation();
  learn(&mut alloc, TEST_SPELL_ID);
  grant_points(&mut alloc, 1);
  upgrade(&mut alloc, &s, 10); // exactly at the L2 requirement -> ok
  assert!(current_level(&alloc, TEST_SPELL_ID) == 2, 0);
}

#[test]
#[expected_failure(abort_code = ENotLearned)]
fun t_resolve_unlearned_aborts() {
  let s = sample_spell();
  let alloc = new_allocation();
  s.resolve_level(&alloc);
}
