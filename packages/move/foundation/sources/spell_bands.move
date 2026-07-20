// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// SPELL BANDS — the MAGNITUDE LAW (annex §3 / SPEC §17.17 — review finding F1). `spell_effect::is_legal` proves
/// an effect is STRUCTURALLY executable (known kind/shape/flags/element); this module proves a whole `SpellLevel`
/// is IN-BAND — the sealed clamps a spell may never exceed. It is the SINGLE home for those bands: `aresrpg_spells`
/// calls `level_is_legal` at admission AND after every cap-gated live-tune setter, so a compromised cap can
/// REBALANCE numbers but can never mint or edit a spell past a sealed band (no-stun, no-execute, no-infinite-push,
/// bounded damage). Pure value math over `spell_effect`'s public accessors — no objects, no capabilities.
///
/// (B, P) — the damage/heal/DoT budget `value <= B + P * min_char_level` — are PARAMETERS the caller threads from
/// `aresrpg_game`'s GameConfig clamped dials (annex §3; harness-pinned at S-21), NEVER hardcoded. Every OTHER band
/// is a fixed sealed constant here, so the inviolable safety bands hold regardless of the (B, P) a caller passes;
/// only the damage budget scales with those dials (itself a rebalance lever, not a break).
module aresrpg_foundation::spell_bands;

use aresrpg_foundation::spell_effect::{Self, SpellLevel, Effect};
use sui::vec_map;

// ── sealed cast-constraint bands (annex §3) ──
const AP_COST_MAX: u64 = 12; //  ap_cost 1..=12; 0-AP effectful spells illegal (F3)
const RANGE_MAX: u64 = 20; //  range_min <= range_max <= 20
const CASTS_MAX: u8 = 10; //  casts_per_turn / _per_target 1..=10 …
const CASTS_UNLIMITED: u8 = 255; //  … or 255 (unlimited) only when ap_cost >= 1 naturally bounds it (F3)
const COOLDOWN_MAX: u8 = 15; //  cooldown_turns 0..=15
const CRIT_RATE_FLOOR: u64 = 2; //  crit_rate 0 (never) or >= 2 (1-in-X, X >= 2 floor)
const EFFECTS_PER_LIST_MAX: u64 = 8; //  effects per list (base AND crit) <= 8 (F2)
const ALLMAP_MIN_AP: u64 = 4; //  any allmap level costs ap_cost >= 4 (F7)

// ── sealed magnitude bands (annex §3 F2/F4/F5) ──
const POINTS_PER_EFFECT_MAX: u64 = 4; //  AP/MP removal <= 4 per effect …
const POINTS_PER_LIST_MAX: u64 = 6; //  … and <= 6 summed per list (the no-stun magnitude form — F4)
const PERCENT_LIFE_MAX: u64 = 25; //  PERCENT_LIFE_DAMAGE <= 25% (no executes — F4)
const PUSH_PULL_MAX: u64 = 8; //  PUSH / PULL <= 8 cells (F4)

/// TRUE iff `s` is a fully legal spell level: every effect (base + crit) is structurally legal AND every sealed
/// cast/magnitude band holds. `damage_base`/`damage_per_level` are the GameConfig (B, P) dials for the level-
/// indexed damage/heal/DoT budget. Called at admission and after every setter — the mutate-then-assert pattern in
/// `aresrpg_spells` reverts any edit that returns false.
public fun level_is_legal(s: &SpellLevel, damage_base: u64, damage_per_level: u64): bool {
  let budget = damage_base + damage_per_level * (s.min_char_level() as u64);
  let ap = s.sl_ap_cost();

  // ── cast constraints ──
  if (ap > AP_COST_MAX) return false;
  // 0-AP effectful spells illegal (F3): ap >= 1 whenever the base list actually does something.
  if (!s.sl_effects().is_empty() && ap < 1) return false;
  if (s.sl_range_min() > s.sl_range_max() || s.sl_range_max() > RANGE_MAX) return false;
  if (!casts_ok(s.sl_casts_per_turn(), ap)) return false;
  if (!casts_ok(s.sl_casts_per_target(), ap)) return false;
  if (s.sl_cooldown_turns() > COOLDOWN_MAX) return false;
  let cr = s.sl_crit_rate();
  if (cr != 0 && cr < CRIT_RATE_FLOOR) return false;
  // any allmap effect (base or crit) forces ap >= 4 (F7).
  if ((uses_allmap(s.sl_effects()) || uses_allmap(s.sl_crit_effects())) && ap < ALLMAP_MIN_AP) return false;

  // ── per-list effect bands (base AND crit) ──
  list_in_band(s.sl_effects(), budget) && list_in_band(s.sl_crit_effects(), budget)
}

/// casts value legal: 1..=10, or 255 (unlimited) only when a positive AP cost naturally bounds repetition (F3).
fun casts_ok(v: u8, ap: u64): bool {
  (v >= 1 && v <= CASTS_MAX) || (v == CASTS_UNLIMITED && ap >= 1)
}

fun uses_allmap(list: &vector<Effect>): bool {
  let n = list.length();
  let mut i = 0;
  while (i < n) {
    if (list.borrow(i).area_shape() == spell_effect::shape_allmap()) return true;
    i = i + 1;
  };
  false
}

/// Validate one effect list against the per-list + per-effect + per-kind bands. Returns false on the first
/// violation. Same-target DAMAGE is SUMMED per `target_filter` bucket and each bucket capped at `budget` (F2),
/// so stacking N damage effects on one target can't exceed the level budget; AP/MP strips are summed for the
/// no-stun form; each timed kind needs turns >= 1 and negative stat/resist alters must be dispellable (F5).
fun list_in_band(list: &vector<Effect>, budget: u64): bool {
  let n = list.length();
  if (n > EFFECTS_PER_LIST_MAX) return false;
  let dot_budget = budget / 2; //  DoT per-tick band = damage band / 2 (F2)
  let mut points_sum = 0u64; //  AP/MP removal summed across the list (no-stun)
  let mut dmg_by_target = vec_map::empty<u8, u64>(); //  same-target damage sums (F2)
  let mut i = 0;
  while (i < n) {
    let e = list.borrow(i);
    let k = e.kind();
    let v = e.value();

    // structural legality (single home: spell_effect::is_legal)
    if (!e.is_legal()) return false;
    // SHAPE_ALLMAP illegal on damage / DoT / points-removal kinds — utility shapes only (F7)
    if (e.area_shape() == spell_effect::shape_allmap() && allmap_forbidden_kind(k)) return false;
    // timed kinds require turns >= 1 — no "0 = permanent" reading (F5)
    if (is_timed_kind(k) && e.turns() < 1) return false;
    // negative ALTER_STAT / ALTER_RESIST must be dispellable — debuffs are always strippable (F5)
    if (
      (k == spell_effect::k_alter_stat() || k == spell_effect::k_alter_resist())
        && e.has_flag(spell_effect::flag_negative())
        && !e.has_flag(spell_effect::flag_dispellable())
    ) return false;

    // per-kind magnitude bands
    if (k == spell_effect::k_remove_points() || k == spell_effect::k_steal_points()) {
      if (v > POINTS_PER_EFFECT_MAX) return false;
      points_sum = points_sum + v;
    } else if (k == spell_effect::k_percent_life_damage()) {
      if (v > PERCENT_LIFE_MAX) return false;
    } else if (k == spell_effect::k_push() || k == spell_effect::k_pull()) {
      if (v > PUSH_PULL_MAX) return false;
    } else if (k == spell_effect::k_apply_dot()) {
      if (v > dot_budget) return false;
    } else if (k == spell_effect::k_heal() || k == spell_effect::k_caster_damage()) {
      if (v > budget) return false; //  heal / self-recoil: per-effect budget
    } else if (is_target_damage_kind(k)) {
      let tf = e.target_filter();
      let sum = (if (dmg_by_target.contains(&tf)) *dmg_by_target.get(&tf) else 0) + v;
      if (sum > budget) return false;
      if (dmg_by_target.contains(&tf)) *dmg_by_target.get_mut(&tf) = sum
      else dmg_by_target.insert(tf, sum);
    };
    i = i + 1;
  };
  points_sum <= POINTS_PER_LIST_MAX
}

/// Kinds whose flat `value` is damage TO A TARGET — summed per target_filter against the level budget (F2).
/// CASTER_DAMAGE (self-recoil) and HEAL are budgeted per-effect above; PERCENT_LIFE has its own 25% cap.
fun is_target_damage_kind(k: u8): bool {
  k == spell_effect::k_damage() || k == spell_effect::k_life_steal() || k == spell_effect::k_punishment_damage()
}

/// Every damaging kind — the allmap blacklist's damage arm.
fun is_damage_kind(k: u8): bool {
  k == spell_effect::k_damage()
    || k == spell_effect::k_percent_life_damage()
    || k == spell_effect::k_life_steal()
    || k == spell_effect::k_caster_damage()
    || k == spell_effect::k_punishment_damage()
}

/// Kinds SHAPE_ALLMAP may never carry: damage, DoT, and points-removal (F7).
fun allmap_forbidden_kind(k: u8): bool {
  is_damage_kind(k)
    || k == spell_effect::k_apply_dot()
    || k == spell_effect::k_remove_points()
    || k == spell_effect::k_steal_points()
}

/// Duration-bearing kinds that must carry turns >= 1 (F5): stat/resist alters and steals, DoT, glyphs, states,
/// invisibility, and the reduce / reflect / return shields.
fun is_timed_kind(k: u8): bool {
  k == spell_effect::k_alter_stat()
    || k == spell_effect::k_steal_stat()
    || k == spell_effect::k_alter_resist()
    || k == spell_effect::k_apply_dot()
    || k == spell_effect::k_place_glyph()
    || k == spell_effect::k_apply_state()
    || k == spell_effect::k_invisibility()
    || k == spell_effect::k_reduce_damage()
    || k == spell_effect::k_reflect_damage()
    || k == spell_effect::k_return_spell()
}

// ===========================================================================
// Tests — a legal MVP spell level ACCEPTS; every band violated in isolation
// REJECTS (adversarial, annex §3). (B, P) here are test dials, not the seal.
// ===========================================================================

#[test_only]
use aresrpg_foundation::spell_effect::{new_spell_level, new_effect, damage, remove_points, alter_stat};
#[test_only]
const B: u64 = 40; //  test damage base
#[test_only]
const P: u64 = 5; //  test per-level slope → budget at min_char_level 1 = 45

// A legal one-target fire level: ap 4, range 1..4, LOS, casts 255 (ap-bounded), crit swap to a higher fixed base.
#[test_only]
fun legal_level(): SpellLevel {
  new_spell_level(
    1, 4, 1, 4, false, false, true, false, 255, 255, 3, 50, false, vector[], vector[],
    vector[damage(fire(), 15)],
    vector[damage(fire(), 30)],
  )
}

#[test_only]
fun fire(): u8 { aresrpg_foundation::spell::el_fire() }

#[test]
fun t_legal_mvp_level_accepts() {
  assert!(level_is_legal(&legal_level(), B, P), 0);
}

#[test]
fun t_ap_cost_over_12_rejects() {
  let s = new_spell_level(
    1, 13, 1, 4, false, false, true, false, 1, 1, 0, 0, false, vector[], vector[],
    vector[damage(fire(), 10)], vector[],
  );
  assert!(!level_is_legal(&s, B, P), 0);
}

#[test]
fun t_zero_ap_effectful_rejects() {
  let s = new_spell_level(
    1, 0, 1, 4, false, false, true, false, 1, 1, 0, 0, false, vector[], vector[],
    vector[damage(fire(), 10)], vector[],
  );
  assert!(!level_is_legal(&s, B, P), 0);
}

#[test]
fun t_range_over_20_rejects() {
  let s = new_spell_level(
    1, 4, 1, 21, false, false, true, false, 1, 1, 0, 0, false, vector[], vector[],
    vector[damage(fire(), 10)], vector[],
  );
  assert!(!level_is_legal(&s, B, P), 0);
}

#[test]
fun t_range_min_over_max_rejects() {
  let s = new_spell_level(
    1, 4, 5, 3, false, false, true, false, 1, 1, 0, 0, false, vector[], vector[],
    vector[damage(fire(), 10)], vector[],
  );
  assert!(!level_is_legal(&s, B, P), 0);
}

#[test]
fun t_casts_over_10_and_not_unlimited_rejects() {
  let s = new_spell_level(
    1, 4, 1, 4, false, false, true, false, 11, 1, 0, 0, false, vector[], vector[],
    vector[damage(fire(), 10)], vector[],
  );
  assert!(!level_is_legal(&s, B, P), 0);
}

#[test]
fun t_cooldown_over_15_rejects() {
  let s = new_spell_level(
    1, 4, 1, 4, false, false, true, false, 1, 1, 16, 0, false, vector[], vector[],
    vector[damage(fire(), 10)], vector[],
  );
  assert!(!level_is_legal(&s, B, P), 0);
}

#[test]
fun t_crit_rate_one_rejects() {
  // crit_rate 1 is illegal (1-in-1 = always-crit); 0 or >= 2 only.
  let s = new_spell_level(
    1, 4, 1, 4, false, false, true, false, 1, 1, 0, 1, false, vector[], vector[],
    vector[damage(fire(), 10)], vector[],
  );
  assert!(!level_is_legal(&s, B, P), 0);
}

#[test]
fun t_over_eight_effects_rejects() {
  let mut effs = vector[];
  let mut i = 0;
  while (i < 9) { effs.push_back(damage(fire(), 1)); i = i + 1; };
  let s = new_spell_level(
    1, 4, 1, 4, false, false, true, false, 1, 1, 0, 0, false, vector[], vector[], effs, vector[],
  );
  assert!(!level_is_legal(&s, B, P), 0);
}

#[test]
fun t_damage_over_budget_rejects() {
  // budget at min_char_level 1 = 40 + 5 = 45; a single 46 damage is over.
  let s = new_spell_level(
    1, 4, 1, 4, false, false, true, false, 1, 1, 0, 0, false, vector[], vector[],
    vector[damage(fire(), 46)], vector[],
  );
  assert!(!level_is_legal(&s, B, P), 0);
}

#[test]
fun t_summed_same_target_damage_over_budget_rejects() {
  // Two 25 fire hits at the same filter = 50 > 45 budget (F2 sum rule), though each alone is legal.
  let s = new_spell_level(
    1, 4, 1, 4, false, false, true, false, 1, 1, 0, 0, false, vector[], vector[],
    vector[damage(fire(), 25), damage(fire(), 25)], vector[],
  );
  assert!(!level_is_legal(&s, B, P), 0);
}

#[test]
fun t_ap_removal_over_four_per_effect_rejects() {
  let s = new_spell_level(
    1, 4, 1, 4, false, false, true, false, 1, 1, 0, 0, false, vector[], vector[],
    vector[remove_points(0, 5, false)], vector[], // 5 AP > 4
  );
  assert!(!level_is_legal(&s, B, P), 0);
}

#[test]
fun t_ap_removal_summed_over_six_rejects() {
  // 4 + 3 = 7 > 6 summed per list (no-stun form), though each effect (<=4) is legal.
  let s = new_spell_level(
    1, 4, 1, 4, false, false, true, false, 1, 1, 0, 0, false, vector[], vector[],
    vector[remove_points(0, 4, false), remove_points(1, 3, false)], vector[],
  );
  assert!(!level_is_legal(&s, B, P), 0);
}

#[test]
fun t_percent_life_over_25_rejects() {
  let e = new_effect(spell_effect::k_percent_life_damage(), 255, 26, spell_effect::shape_point(), 0, spell_effect::tf_not_team(), 100, 0, 0, 0, spell_effect::phase_on_enter());
  let s = new_spell_level(
    1, 4, 1, 4, false, false, true, false, 1, 1, 0, 0, false, vector[], vector[], vector[e], vector[],
  );
  assert!(!level_is_legal(&s, B, P), 0);
}

#[test]
fun t_push_over_eight_rejects() {
  let e = new_effect(spell_effect::k_push(), 255, 9, spell_effect::shape_point(), 0, spell_effect::tf_not_team(), 100, 0, 0, 0, spell_effect::phase_on_enter());
  let s = new_spell_level(
    1, 4, 1, 4, false, false, true, false, 1, 1, 0, 0, false, vector[], vector[], vector[e], vector[],
  );
  assert!(!level_is_legal(&s, B, P), 0);
}

#[test]
fun t_timed_kind_zero_turns_rejects() {
  // an invisibility with turns 0 is illegal (no permanent timed effects).
  let e = new_effect(spell_effect::k_invisibility(), 255, 0, spell_effect::shape_point(), 0, spell_effect::tf_not_enemy(), 100, 0, 0, 0, spell_effect::phase_on_enter());
  let s = new_spell_level(
    1, 4, 1, 4, false, false, true, false, 1, 1, 0, 0, false, vector[], vector[], vector[e], vector[],
  );
  assert!(!level_is_legal(&s, B, P), 0);

  // STEAL_STAT's target debit and caster mirror-buff are both timed rows; zero cannot mean permanent.
  let steal = new_effect(
    spell_effect::k_steal_stat(), 255, 11, spell_effect::shape_point(), 0,
    spell_effect::tf_not_team(), 100, 0, spell_effect::stat_strength(), 0,
    spell_effect::phase_on_enter(),
  );
  let steal_level = new_spell_level(
    1, 4, 1, 4, false, false, true, false, 1, 1, 0, 0, false, vector[], vector[],
    vector[steal], vector[],
  );
  assert!(!level_is_legal(&steal_level, B, P), 1);
}

#[test]
fun t_negative_alter_without_dispellable_rejects() {
  // alter_stat(negative=true, dispellable=false) — a non-strippable debuff is illegal (F5).
  let s = new_spell_level(
    1, 4, 1, 4, false, false, true, false, 1, 1, 0, 0, false, vector[], vector[],
    vector[alter_stat(spell_effect::stat_strength(), 30, true, false, 3)], vector[],
  );
  assert!(!level_is_legal(&s, B, P), 0);
}

#[test]
fun t_allmap_damage_rejects() {
  // allmap on a DAMAGE kind is forbidden even at high AP.
  let e = new_effect(spell_effect::k_damage(), fire(), 10, spell_effect::shape_allmap(), 0, spell_effect::tf_not_team(), 100, 0, 0, 0, spell_effect::phase_on_enter());
  let s = new_spell_level(
    1, 6, 1, 4, false, false, true, false, 1, 1, 0, 0, false, vector[], vector[], vector[e], vector[],
  );
  assert!(!level_is_legal(&s, B, P), 0);
}

#[test]
fun t_allmap_utility_under_four_ap_rejects() {
  // a legal allmap kind (reveal) still needs ap >= 4 (F7) — at ap 3 it rejects.
  let e = new_effect(spell_effect::k_reveal(), 255, 0, spell_effect::shape_allmap(), 0, spell_effect::tf_none(), 100, 0, 0, 0, spell_effect::phase_on_enter());
  let s = new_spell_level(
    1, 3, 1, 4, false, false, false, false, 1, 1, 0, 0, false, vector[], vector[], vector[e], vector[],
  );
  assert!(!level_is_legal(&s, B, P), 0);
}

#[test]
fun t_allmap_utility_at_four_ap_accepts() {
  // the same reveal at ap 4 is legal (utility allmap, ap >= 4).
  let e = new_effect(spell_effect::k_reveal(), 255, 0, spell_effect::shape_allmap(), 0, spell_effect::tf_none(), 100, 0, 0, 0, spell_effect::phase_on_enter());
  let s = new_spell_level(
    1, 4, 1, 4, false, false, false, false, 1, 1, 0, 0, false, vector[], vector[], vector[e], vector[],
  );
  assert!(level_is_legal(&s, B, P), 0);
}

#[test]
fun t_crit_list_also_banded() {
  // the crit list is validated too: a 46-damage crit effect over the 45 budget rejects.
  let s = new_spell_level(
    1, 4, 1, 4, false, false, true, false, 1, 1, 0, 50, false, vector[], vector[],
    vector[damage(fire(), 15)],
    vector[damage(fire(), 46)],
  );
  assert!(!level_is_legal(&s, B, P), 0);
}
