// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// RUNE CATALOG TESTS — table integrity against the R1/DECISIONS canon (docs/RETRO_RUNES_RESEARCH.md):
/// scaled unit weights, derived rune weights (= retro weight ×5 for every row), amounts, caps, tiers, the two
/// NOT-RUNEABLE fields, and the abort surfaces.
#[test_only]
module aresrpg_foundation::rune_catalog_tests;

use aresrpg_foundation::rune_catalog as cat;

// ╔════════════════ [ Unit weights (×5) — the DECISIONS 2135 five + the classics ] ═ ]

#[test]
fun t_unit_weights_match_canon() {
  // Retro wt/pt ×5: Vi 0.2→1 · Sa 3→15 · primaries 1→5 · Ré 2→10 · Do 20→100 · Cri 10→50.
  assert!(cat::stat_unit_weight(cat::stat_vitality()) == 1, 0);
  assert!(cat::stat_unit_weight(cat::stat_wisdom()) == 15, 1);
  assert!(cat::stat_unit_weight(cat::stat_strength()) == 5, 2);
  assert!(cat::stat_unit_weight(cat::stat_intelligence()) == 5, 3);
  assert!(cat::stat_unit_weight(cat::stat_chance()) == 5, 4);
  assert!(cat::stat_unit_weight(cat::stat_agility()) == 5, 5);
  assert!(cat::stat_unit_weight(cat::stat_raw_damage()) == 100, 6);
  assert!(cat::stat_unit_weight(cat::stat_earth_resistance()) == 10, 7);
  assert!(cat::stat_unit_weight(cat::stat_fire_resistance()) == 10, 8);
  assert!(cat::stat_unit_weight(cat::stat_water_resistance()) == 10, 9);
  assert!(cat::stat_unit_weight(cat::stat_air_resistance()) == 10, 10);
}

#[test]
fun t_decisions_2135_weights() {
  // The corrected five, in retro units (scaled / weight_scale): action=100, movement=90, range=51,
  // Cri=10 (since the 2026-07-17 convergence the rune lives on `critical`; dead critical_chance keeps the
  // 2135 price for selectStatToReduce only); critical_outcomes = NOT-RUNEABLE (no rune, never a default).
  let s = cat::weight_scale();
  assert!(cat::stat_unit_weight(cat::stat_action()) / s == 100, 0);
  assert!(cat::stat_unit_weight(cat::stat_movement()) / s == 90, 1);
  assert!(cat::stat_unit_weight(cat::stat_range()) / s == 51, 2);
  assert!(cat::stat_unit_weight(cat::stat_critical_chance()) / s == 10, 3);
  assert!(!cat::is_runeable(cat::stat_critical_outcomes()), 4);
}

// ╔════════════════ [ Amounts (FIXED integers, R1 dispute 1 adopted) ] ═══════ ]

#[test]
fun t_amounts_multi_tier() {
  // Vi +3/+10/+30 · primaries +1/+3/+10 · Sa +1/+3/+10 · Ré +1/+3/+10.
  assert!(cat::rune_amount(cat::stat_vitality(), cat::tier_ba()) == 3, 0);
  assert!(cat::rune_amount(cat::stat_vitality(), cat::tier_pa()) == 10, 1);
  assert!(cat::rune_amount(cat::stat_vitality(), cat::tier_ra()) == 30, 2);
  assert!(cat::rune_amount(cat::stat_strength(), cat::tier_ba()) == 1, 3);
  assert!(cat::rune_amount(cat::stat_strength(), cat::tier_pa()) == 3, 4);
  assert!(cat::rune_amount(cat::stat_strength(), cat::tier_ra()) == 10, 5);
  assert!(cat::rune_amount(cat::stat_wisdom(), cat::tier_ra()) == 10, 6);
  assert!(cat::rune_amount(cat::stat_air_resistance(), cat::tier_pa()) == 3, 7);
}

#[test]
fun t_amounts_single_tier_majors() {
  // Po/Ga Pme/Ga Pa/Do/Cri: +1, Ba only.
  assert!(cat::rune_amount(cat::stat_range(), cat::tier_ba()) == 1, 0);
  assert!(cat::rune_amount(cat::stat_movement(), cat::tier_ba()) == 1, 1);
  assert!(cat::rune_amount(cat::stat_action(), cat::tier_ba()) == 1, 2);
  assert!(cat::rune_amount(cat::stat_raw_damage(), cat::tier_ba()) == 1, 3);
  assert!(cat::rune_amount(cat::stat_critical(), cat::tier_ba()) == 1, 4);
  assert!(!cat::has_rune(cat::stat_range(), cat::tier_pa()), 5);
  assert!(!cat::has_rune(cat::stat_action(), cat::tier_ra()), 6);
}

// ╔════════════════ [ Derived rune weights == R1 retro weights ×5 ] ══════════ ]

#[test]
fun t_rune_weights_derived_match_r1() {
  // R1 rune weights (retro): Fo 1/3/10 · Vi 0.6/2/6 · Sa 3/9/30 · Ré 2/6/20 · Po 51 · PM 90 · PA 100 ·
  // Do 20 · Cri 10 — all ×5 here.
  assert!(cat::rune_weight(cat::stat_strength(), cat::tier_ba()) == 5, 0);
  assert!(cat::rune_weight(cat::stat_strength(), cat::tier_pa()) == 15, 1);
  assert!(cat::rune_weight(cat::stat_strength(), cat::tier_ra()) == 50, 2);
  assert!(cat::rune_weight(cat::stat_vitality(), cat::tier_ba()) == 3, 3);
  assert!(cat::rune_weight(cat::stat_vitality(), cat::tier_pa()) == 10, 4);
  assert!(cat::rune_weight(cat::stat_vitality(), cat::tier_ra()) == 30, 5);
  assert!(cat::rune_weight(cat::stat_wisdom(), cat::tier_ba()) == 15, 6);
  assert!(cat::rune_weight(cat::stat_wisdom(), cat::tier_pa()) == 45, 7);
  assert!(cat::rune_weight(cat::stat_wisdom(), cat::tier_ra()) == 150, 8);
  assert!(cat::rune_weight(cat::stat_fire_resistance(), cat::tier_ba()) == 10, 9);
  assert!(cat::rune_weight(cat::stat_fire_resistance(), cat::tier_pa()) == 30, 10);
  // DISPUTED row (late-ID Ra-resist cluster, included per synthesis): retro 20 → 100.
  assert!(cat::rune_weight(cat::stat_fire_resistance(), cat::tier_ra()) == 100, 11);
  assert!(cat::rune_weight(cat::stat_range(), cat::tier_ba()) == 255, 12);
  assert!(cat::rune_weight(cat::stat_movement(), cat::tier_ba()) == 450, 13);
  assert!(cat::rune_weight(cat::stat_action(), cat::tier_ba()) == 500, 14);
  assert!(cat::rune_weight(cat::stat_raw_damage(), cat::tier_ba()) == 100, 15);
  assert!(cat::rune_weight(cat::stat_critical(), cat::tier_ba()) == 50, 16);
}

#[test]
fun t_weight_equals_amount_times_unit_for_all() {
  // The consistency law (puits conservation) over the WHOLE table: every populated (stat, tier).
  let mut stat = 0u8;
  while ((stat as u64) < cat::stat_count()) {
    let mut tier = cat::tier_ba();
    while (tier <= cat::tier_ra()) {
      if (cat::has_rune(stat, tier)) {
        assert!(cat::rune_weight(stat, tier) == cat::rune_amount(stat, tier) * cat::stat_unit_weight(stat), (stat as u64) * 10 + (tier as u64));
      };
      tier = tier + 1;
    };
    stat = stat + 1;
  };
}

// ╔════════════════ [ Runeability + caps + tiers ] ═══════════════════════════ ]

#[test]
fun t_not_runeable_is_explicit() {
  // Exactly two NOT-RUNEABLE fields: critical_chance(11) + critical_outcomes(12). All 15 others runeable.
  let mut stat = 0u8;
  let mut runeable_count = 0;
  while ((stat as u64) < cat::stat_count()) {
    if (cat::is_runeable(stat)) runeable_count = runeable_count + 1;
    stat = stat + 1;
  };
  assert!(runeable_count == 15, 0);
  assert!(!cat::is_runeable(cat::stat_critical_chance()), 1);
  assert!(!cat::is_runeable(cat::stat_critical_outcomes()), 2);
}

#[test]
fun t_max_apps() {
  // R1 hard caps: Po/PM/PA = 1, Cri = 10; everything else uncapped (0).
  assert!(cat::rune_max_apps(cat::stat_range()) == 1, 0);
  assert!(cat::rune_max_apps(cat::stat_movement()) == 1, 1);
  assert!(cat::rune_max_apps(cat::stat_action()) == 1, 2);
  assert!(cat::rune_max_apps(cat::stat_critical()) == 10, 3);
  assert!(cat::rune_max_apps(cat::stat_strength()) == 0, 4);
  assert!(cat::rune_max_apps(cat::stat_vitality()) == 0, 5);
}

#[test]
fun t_max_tier() {
  assert!(cat::max_tier(cat::stat_vitality()) == cat::tier_ra(), 0);
  assert!(cat::max_tier(cat::stat_wisdom()) == cat::tier_ra(), 1);
  assert!(cat::max_tier(cat::stat_water_resistance()) == cat::tier_ra(), 2);
  assert!(cat::max_tier(cat::stat_action()) == cat::tier_ba(), 3);
  assert!(cat::max_tier(cat::stat_raw_damage()) == cat::tier_ba(), 4);
  assert!(cat::max_tier(cat::stat_critical_chance()) == 0, 5); // non-runeable → no tier
}

#[test]
fun t_signature_and_scale() {
  assert!(cat::signature_weight() == 0, 0);
  assert!(cat::weight_scale() == 5, 1);
  assert!(cat::stat_count() == 17, 2);
}

// ╔════════════════ [ CRIT CONVERGENCE (Option C) ] ═ ]
// The Cri rune targets LIVE `critical`(9) — the combat denominator reducer (spell::is_critical crit_bonus);
// dead `critical_chance`(11) joins the non-runeable pair (equipment_stats.move fold mandate).

#[test]
fun t_cri_rune_targets_live_critical() {
  // Cri scribes stat 9: runeable, +1 Ba-only, cap 10, retro weight 10 (×5 = 50).
  assert!(cat::is_runeable(cat::stat_critical()), 0);
  assert!(cat::rune_amount(cat::stat_critical(), cat::tier_ba()) == 1, 1);
  assert!(cat::rune_max_apps(cat::stat_critical()) == 10, 2);
  assert!(cat::rune_weight(cat::stat_critical(), cat::tier_ba()) == 50, 3);
  assert!(cat::stat_unit_weight(cat::stat_critical()) / cat::weight_scale() == 10, 4);
  assert!(cat::max_tier(cat::stat_critical()) == cat::tier_ba(), 5);
}

#[test]
fun t_critical_chance_is_dead_not_runeable() {
  // Stat 11 is combat-dead: no rune, no cap, no tier. Reseed folds its authored values into `critical`.
  assert!(!cat::is_runeable(cat::stat_critical_chance()), 0);
  assert!(cat::rune_max_apps(cat::stat_critical_chance()) == 0, 1);
  assert!(cat::max_tier(cat::stat_critical_chance()) == 0, 2);
}

#[test, expected_failure(abort_code = 3, location = aresrpg_foundation::rune_catalog)]
fun t_amount_on_dead_critical_chance_aborts() {
  cat::rune_amount(cat::stat_critical_chance(), cat::tier_ba()); // ENotRuneable
}

// ╔════════════════ [ Abort surfaces ] ═══════════════════════════════════════ ]

#[test, expected_failure(abort_code = 3, location = aresrpg_foundation::rune_catalog)]
fun t_amount_on_non_runeable_aborts() {
  cat::rune_amount(cat::stat_critical_outcomes(), cat::tier_ba()); // ENotRuneable
}

#[test, expected_failure(abort_code = 3, location = aresrpg_foundation::rune_catalog)]
fun t_amount_on_missing_tier_aborts() {
  cat::rune_amount(cat::stat_action(), cat::tier_pa()); // Ga Pa has no Pa tier — ENotRuneable
}

#[test, expected_failure(abort_code = 1, location = aresrpg_foundation::rune_catalog)]
fun t_bad_stat_id_aborts() {
  cat::stat_unit_weight(17); // EBadStat
}
