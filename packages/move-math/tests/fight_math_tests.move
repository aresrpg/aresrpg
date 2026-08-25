// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
#[test_only]
module aresrpg_math::fight_math_tests;

use aresrpg_math::fight_math;

#[test]
fun mob_bands_scale_from_sixty_to_one_sixty_percent() {
  assert!(fight_math::band_scaled(1_000, 10, 20, 10) == 600, 0);
  assert!(fight_math::band_scaled(1_000, 10, 20, 15) == 1_100, 1);
  assert!(fight_math::band_scaled(1_000, 10, 20, 20) == 1_600, 2);
  assert!(fight_math::band_scaled(1_000, 10, 10, 10) == 1_000, 3);

  let center = 32_768;
  assert!(fight_math::centered_band_scaled(center, center, 10, 20, 10) == center, 4);
  assert!(fight_math::centered_band_scaled(center + 100, center, 10, 20, 10) == center + 60, 5);
  assert!(fight_math::centered_band_scaled(center - 100, center, 10, 20, 10) == center - 160, 6);
  assert!(fight_math::centered_band_scaled(center - 100, center, 10, 20, 15) == center - 110, 7);
  assert!(fight_math::centered_band_scaled(center - 100, center, 10, 20, 20) == center - 60, 8);

  assert!(fight_math::mob_loot_chance_scaled(5_000, 10, 20, 10) == 4_000, 9);
  assert!(fight_math::mob_loot_chance_scaled(5_000, 10, 20, 15) == 5_000, 10);
  assert!(fight_math::mob_loot_chance_scaled(5_000, 10, 20, 20) == 6_000, 11);
  assert!(fight_math::mob_loot_chance_scaled(9_000, 10, 20, 20) == 10_000, 12);

  assert!(fight_math::mob_pool_scaled(6, 10, 20, 10) == 6, 13);
  assert!(fight_math::mob_pool_scaled(6, 10, 20, 15) == 7, 14);
  assert!(fight_math::mob_pool_scaled(6, 10, 20, 20) == 8, 15);
  assert!(fight_math::mob_pool_scaled(3, 10, 20, 20) == 4, 16);
  assert!(fight_math::mob_pool_scaled(6, 10, 10, 10) == 6, 17);
}

#[test]
fun retro_fight_xp_balances_groups_then_splits_by_level() {
  assert!(fight_math::retro_group_coefficient_tenths(1) == 10, 0);
  assert!(fight_math::retro_group_coefficient_tenths(2) == 11, 1);
  assert!(fight_math::retro_group_coefficient_tenths(6) == 36, 2);
  assert!(fight_math::xp_for_player(1_970, 0, 12, 12, 12, 12, 1) == 1_970, 3);
  assert!(fight_math::xp_for_player(1_970, 0, 5, 30, 12, 12, 6) == 472, 4);
  assert!(fight_math::xp_for_player(1_000, 0, 5, 15, 15, 15, 2) == 366, 5);
  assert!(fight_math::xp_for_player(1_000, 0, 10, 15, 15, 15, 2) == 733, 6);
  assert!(fight_math::xp_for_player(1_200, 0, 1, 1, 12, 12, 1) == 1_100, 7);
  assert!(fight_math::xp_for_player(1_200, 0, 20, 20, 12, 12, 1) == 720, 8);
  assert!(fight_math::xp_for_player(1_200, 0, 40, 40, 12, 12, 1) == 270, 9);
  // Ares keeps its established Wisdom scale after the Retro group calculation.
  assert!(fight_math::xp_for_player(1_000, 600, 12, 12, 12, 12, 1) == 2_000, 10);
}

#[test]
fun critical_draw_is_stable_per_turn_and_spell() {
  let slash = fight_math::spell_crit_roll(5, &b"slash".to_string());
  let stab = fight_math::spell_crit_roll(5, &b"stab".to_string());

  // Golden values from the TypeScript integer twin. Both spells have the same 1-in-3 rate,
  // but the canonical name gives each an independent stable result for this turn.
  assert!(slash == 1_039_393_101 && slash % 3 == 0, 0);
  assert!(stab == 3_900_873_764 && stab % 3 != 0, 1);
  assert!(fight_math::spell_crit_roll(5, &b"slash".to_string()) == slash, 2);
}

/// The crit seam, pinned on BOTH sides: `packages/fight/test/fixtures/move_math.ts` carries
/// these exact numbers. `crit_denominator` divides by the integer `ln_e6`, so an edit to the
/// fixed-point log loop that reds neither suite would desync client crit prediction from
/// chain truth silently. Recorded answers — never regenerate them from the code under test.
#[test]
fun fixed_point_natural_log_is_pinned() {
  assert!(fight_math::ln_e6(12) == 2_484_904, 0); // agility 0 — the curve's floor
  assert!(fight_math::ln_e6(13) == 2_564_944, 1);
  assert!(fight_math::ln_e6(16) == 2_772_588, 2); // exact power of two: mantissa loop adds 0
  assert!(fight_math::ln_e6(62) == 4_127_131, 3);
  assert!(fight_math::ln_e6(112) == 4_718_494, 4); // agility 100
  assert!(fight_math::ln_e6(1012) == 6_919_678, 5); // agility 1000
}

/// One assert per arm of the quotation curve (crit_1_in, cri, agility) → X.
#[test]
fun crit_denominator_is_pinned() {
  assert!(fight_math::crit_denominator(1, 0, 0) == 1, 0); // <=2 short-circuit: always crits
  assert!(fight_math::crit_denominator(2, 0, 0) == 2, 1); // <=2 short-circuit: 1-in-2
  assert!(fight_math::crit_denominator(3, 2, 0) == 2, 2); // Cri eats the base → floor of 2
  assert!(fight_math::crit_denominator(30, 0, 0) == 30, 3); // the CAP: agility never raises X
  assert!(fight_math::crit_denominator(30, 0, 50) == 21, 4);
  assert!(fight_math::crit_denominator(30, 0, 1000) == 12, 5); // heavy diminishing returns
  assert!(fight_math::crit_denominator(30, 25, 100) == 3, 6); // Cri subtracts linearly first
  assert!(fight_math::crit_denominator(50, 10, 100) == 25, 7);
}
