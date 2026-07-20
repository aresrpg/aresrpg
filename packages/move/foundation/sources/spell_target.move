/// SPELL TARGETING — the TWO independent 1.29 layers (taxonomy §2), the exact structural gap the ticket
/// names. The live contract only allows "living-enemy, range ≥ 1"; this splits validation into:
///
///  (a) CAST CONSTRAINT — "may I aim at this cell?": range interval, orthogonal line-launch, line-of-sight,
///      and free-cell-vs-occupied. NOTE it decides GEOMETRY + OCCUPANCY ONLY — never team. This is what
///      unlocks self-cast (range 0), ally-cast, and empty-cell casts (traps/glyphs/teleport).
///  (b) PER-EFFECT FILTER — "who in the zone does THIS effect hit?": the `SpellEffectTarget` bitmask on each
///      `Effect` (NOT_TEAM / NOT_SELF / NOT_ENEMY / ONLY_CASTER) sorts friend from foe, so one AoE can heal
///      allies and damage enemies in the same cast.
///
/// Pure — reuses `combat_grid`'s package geometry (`manhattan`/`cheby`/`in_grid`/`line_of_sight`). Orthogonal
/// alignment is `manhattan == cheby` (true iff min(|Δx|,|Δy|)==0), so line-launch needs no grid-decode and
/// combat_grid stays untouched.
module aresrpg_foundation::spell_target;

use aresrpg_foundation::{combat_grid, spell_effect::{Self, SpellLevel}};

// ╔════════════════ [ Layer (a) — cast constraint: may I aim at this cell? ] ═══════ ]

/// `true` iff `target_cell` is a legal aim for `spell` cast from `caster_cell`. Checks GEOMETRY + OCCUPANCY
/// ONLY — team is a per-effect concern (layer b). `target_occupied` = is a fighter standing on the cell (the
/// caster's own cell counts as occupied, enabling self-cast when range_min == 0). `range_bonus` = the caster's
/// active +range modifiers (STAT_RANGE buffs/gear); it EXTENDS `range_max` ONLY for a `modifiable_range` spell
/// (1.29: fixed-range spells ignore +range), so a previously-out-of-range cell becomes legal while the buff holds.
public fun can_cast_at(
  spell: &SpellLevel,
  caster_cell: u64,
  target_cell: u64,
  target_occupied: bool,
  obstacles: &vector<u64>,
  range_bonus: u64,
): bool {
  if (!combat_grid::in_grid(target_cell)) return false;
  let d = combat_grid::manhattan(caster_cell, target_cell);
  let range_max = spell.sl_range_max() + if (spell.sl_modifiable_range()) range_bonus else 0;
  if (d < spell.sl_range_min() || d > range_max) return false;
  // line-launch: caster & target must be orthogonally aligned (same row or column).
  if (spell.sl_line_launch() && combat_grid::manhattan(caster_cell, target_cell) != combat_grid::cheby(caster_cell, target_cell)) {
    return false
  };
  if (spell.sl_line_of_sight() && !combat_grid::line_of_sight(caster_cell, target_cell, obstacles)) return false;
  // free_cell (traps/teleport/glyphs) must land on an EMPTY cell — that gate stays (D67 / rider #7). A
  // NON-free_cell spell may now aim at ANY legal-geometry cell, occupied OR EMPTY: 1.29 lets a player fire at
  // any in-range/LOS cell (a wasted hit that catches nobody is the player's own choice), so the old
  // "otherwise must be occupied" branch is DELETED. Empty non-free_cell casts simply hit no fighter downstream.
  if (spell.sl_free_cell() && target_occupied) return false;
  true
}

// ╔════════════════ [ Layer (b) — per-effect target filter (the bitmask) ] ════════ ]

/// `true` iff an effect with `target_filter` HITS a candidate fighter, given whether that fighter IS the
/// caster and whether it shares the caster's team. Semantics (taxonomy §2b): ONLY_CASTER ⇒ caster only;
/// NOT_SELF drops the caster; NOT_TEAM drops the caster's whole team (self included); NOT_ENEMY drops the
/// enemy team. No flag ⇒ hits anyone in the zone.
public fun effect_hits(target_filter: u8, is_caster: bool, same_team: bool): bool {
  if (target_filter & spell_effect::tf_only_caster() == spell_effect::tf_only_caster()) return is_caster;
  if (target_filter & spell_effect::tf_not_self() == spell_effect::tf_not_self() && is_caster) return false;
  if (target_filter & spell_effect::tf_not_team() == spell_effect::tf_not_team() && same_team) return false;
  if (target_filter & spell_effect::tf_not_enemy() == spell_effect::tf_not_enemy() && !same_team) return false;
  true
}

// ===========================================================================
// Tests — one per targeting category (self / ally / enemy / empty-cell) + the filter matrix.
// ===========================================================================

#[test_only]
use aresrpg_foundation::spell_effect::{new_spell_level, damage, heal, place_trap};

// A self-cast level: range 0, must-hit-a-fighter (the caster's own cell), no LOS.
#[test_only]
fun self_spell(): SpellLevel {
  new_spell_level(1, 2, 0, 0, false, false, false, false, 255, 255, 0, 0, false, vector[], vector[], vector[heal(20)], vector[])
}
// An ally/self heal: range 0..6, must hit a fighter.
#[test_only]
fun ally_heal(): SpellLevel {
  new_spell_level(1, 3, 0, 6, false, false, false, false, 255, 255, 0, 0, false, vector[], vector[], vector[heal(30)], vector[])
}
// An empty-cell trap: range 1..4, free_cell, no LOS.
#[test_only]
fun trap_spell(): SpellLevel {
  new_spell_level(1, 3, 1, 4, false, false, false, true, 255, 255, 0, 0, false, vector[], vector[], vector[place_trap(spell_effect::shape_circle(), 2)], vector[])
}
// Enemy fire: range 1..4, LOS, must hit a fighter.
#[test_only]
fun enemy_fire(): SpellLevel {
  new_spell_level(1, 4, 1, 4, false, false, true, false, 255, 255, 0, 0, false, vector[], vector[], vector[damage(aresrpg_foundation::spell::el_fire(), 15)], vector[])
}

#[test]
fun t_cast_self_only_at_own_cell() {
  let s = self_spell();
  let me = combat_grid::encode(5, 5);
  assert!(can_cast_at(&s, me, me, true, &vector[], 0), 0); // own cell, occupied by self
  // any other cell is out of the 0..0 range
  assert!(!can_cast_at(&s, me, combat_grid::encode(5, 6), true, &vector[], 0), 0);
}

#[test]
fun t_cast_ally_within_range() {
  let s = ally_heal();
  let me = combat_grid::encode(1, 1);
  let ally = combat_grid::encode(3, 1); // manhattan 2, occupied
  assert!(can_cast_at(&s, me, ally, true, &vector[], 0), 0);
  // D67 / rider #7: an EMPTY cell is now a LEGAL aim for a non-free_cell heal — geometry is all that gates it
  // (the heal simply catches nobody there). Was rejected pre-rider ("must hit a fighter").
  assert!(can_cast_at(&s, me, ally, false, &vector[], 0), 0);
}

// D67 / rider #7: a NON-free_cell damage spell may legally target an EMPTY, in-range, LOS-clear cell — the
// player's right to fire at any legal-geometry cell (wasted damage is a choice). Range/LOS still gate it.
#[test]
fun t_cast_non_free_cell_allows_empty_target() {
  let s = enemy_fire(); // range 1..4, LOS, NOT free_cell
  let me = combat_grid::encode(1, 1);
  let empty = combat_grid::encode(3, 1); // manhattan 2, in [1,4], empty
  assert!(can_cast_at(&s, me, empty, false, &vector[], 0), 0); // empty now LEGAL (was rejected pre-rider)
  assert!(can_cast_at(&s, me, empty, true, &vector[], 0), 0); // occupied still legal
  // geometry still gates: out-of-range empty rejected, LOS-blocked empty rejected
  assert!(!can_cast_at(&s, me, combat_grid::encode(7, 1), false, &vector[], 0), 0); // manhattan 6 > 4
  assert!(!can_cast_at(&s, me, empty, false, &vector[combat_grid::encode(2, 1)], 0), 0); // blocker on the line
}

#[test]
fun t_cast_enemy_range_and_los() {
  let s = enemy_fire();
  let me = combat_grid::encode(1, 1);
  let enemy = combat_grid::encode(3, 1); // manhattan 2, in [1,4]
  assert!(can_cast_at(&s, me, enemy, true, &vector[], 0), 0);
  // out of range
  assert!(!can_cast_at(&s, me, combat_grid::encode(7, 1), true, &vector[], 0), 0);
  // range 0 (self) rejected — fire can't be self-cast
  assert!(!can_cast_at(&s, me, me, true, &vector[], 0), 0);
  // LOS blocked by an obstacle on the straight line between (2,1)
  let blocker = combat_grid::encode(2, 1);
  assert!(!can_cast_at(&s, me, enemy, true, &vector[blocker], 0), 0);
}

#[test]
fun t_cast_empty_cell_trap() {
  let s = trap_spell();
  let me = combat_grid::encode(1, 1);
  let empty = combat_grid::encode(3, 1); // manhattan 2, empty
  assert!(can_cast_at(&s, me, empty, false, &vector[], 0), 0); // empty ok
  assert!(!can_cast_at(&s, me, empty, true, &vector[], 0), 0); // occupied rejected (free_cell)
}

// #55-E8 RANGE± CONSUMPTION: a +range_bonus extends range_max ONLY for a modifiable_range spell. A cell one cell
// beyond range_max is illegal at bonus 0, legal at bonus 1 (modifiable), and STAYS illegal for a fixed-range spell.
#[test]
fun t_cast_range_bonus_extends_only_modifiable() {
  let me = combat_grid::encode(1, 1);
  let far = combat_grid::encode(6, 1); // manhattan 5 — one past a range-4 spell
  // modifiable_range = true (5th flag), range 1..4, LOS off.
  let modspell = new_spell_level(1, 4, 1, 4, true, false, false, false, 255, 255, 0, 0, false, vector[], vector[], vector[damage(aresrpg_foundation::spell::el_fire(), 10)], vector[]);
  assert!(!can_cast_at(&modspell, me, far, true, &vector[], 0), 0); // out of range at bonus 0
  assert!(can_cast_at(&modspell, me, far, true, &vector[], 1), 0); // +1 range → now reaches manhattan 5
  // a FIXED-range spell ignores the bonus (enemy_fire has modifiable_range = false).
  assert!(!can_cast_at(&enemy_fire(), me, far, true, &vector[], 5), 0); // still out of range despite +5
}

#[test]
fun t_filter_enemy_damage() {
  let f = spell_effect::tf_not_team();
  assert!(effect_hits(f, false, false), 0); // enemy hit
  assert!(!effect_hits(f, false, true), 0); // ally excluded
  assert!(!effect_hits(f, true, true), 0); // caster excluded (own team)
}

#[test]
fun t_filter_heal_ally_and_self() {
  let f = spell_effect::tf_not_enemy();
  assert!(effect_hits(f, true, true), 0); // self healed
  assert!(effect_hits(f, false, true), 0); // ally healed
  assert!(!effect_hits(f, false, false), 0); // enemy excluded
}

#[test]
fun t_filter_ally_only_not_self() {
  let f = spell_effect::tf_not_enemy() | spell_effect::tf_not_self();
  assert!(!effect_hits(f, true, true), 0); // caster excluded
  assert!(effect_hits(f, false, true), 0); // ally hit
  assert!(!effect_hits(f, false, false), 0); // enemy excluded
}

#[test]
fun t_filter_only_caster() {
  let f = spell_effect::tf_only_caster();
  assert!(effect_hits(f, true, true), 0); // caster only
  assert!(!effect_hits(f, false, true), 0);
  assert!(!effect_hits(f, false, false), 0);
}
