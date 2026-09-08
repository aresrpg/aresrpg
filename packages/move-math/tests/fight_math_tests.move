// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
#[test_only]
module aresrpg_math::fight_math_tests;

use aresrpg_math::fight_math;
use aresrpg_math::{prng, spell_effect};

#[test]
fun damage_healing_and_signed_resistance_boundaries() {
  assert!(fight_math::sat_sub(5, 2) == 3 && fight_math::sat_sub(2, 5) == 0, 0);
  assert!(fight_math::max_1(0) == 1 && fight_math::max_1(7) == 7, 1);
  let elements = vector[b"earth", b"fire", b"water", b"air", b"unknown"];
  let expected = vector<u64>[10, 20, 30, 40, 0];
  let mut i = 0;
  while (i < elements.length()) {
    assert!(fight_math::primary_stat(&elements[i].to_string(), 10, 20, 30, 40) == expected[i], 2);
    i = i + 1;
  };
  assert!(fight_math::amplify_damage(13, 50, 4) == 23, 3);
  assert!(fight_math::heal_amount(13, 50) == 19, 4);
  assert!(fight_math::apply_resistance(100, 90) == 50, 5);
  assert!(fight_math::resolved_damage(10, 100, 5, 32_778, 32_768) == 22, 6);
  assert!(fight_math::resist(100, 32_748, 32_768) == 120, 7);
  assert!(fight_math::resist(100, 32_768, 32_768) == 100, 8);
  assert!(fight_math::punishment_base(100, 150, 100) == 100, 9);
  assert!(fight_math::punishment_base(100, 25, 100) == 175, 10);
  assert!(fight_math::punishment_base(100, 0, 0) == 100, 11);
  assert!(fight_math::apply_centered_shift(10, 90, 100) == 0, 12);
  assert!(fight_math::apply_centered_shift(10, 95, 100) == 5, 13);
}

#[test]
fun ranged_effects_consume_exactly_one_draw_and_fixed_effects_consume_none() {
  let ranged = spell_effect::new_effect(0, b"earth".to_string(), 2, 7, 0, 0, 0, 10_000, 0, 0);
  let fixed = spell_effect::new_effect(0, b"earth".to_string(), 4, 4, 0, 0, 0, 10_000, 0, 0);
  let mut state = 7;
  assert!(fight_math::roll_effect_value(&fixed, &mut state) == 4 && state == 7, 0);
  let (next, raw) = prng::rng_next(7);
  let value = fight_math::roll_effect_value(&ranged, &mut state);
  assert!(state == next && value == 2 + (raw % 10_000) * 6 / 10_000, 1);
  assert!(fight_math::roll_in_range(2, 7, 0) == 2, 2);
  assert!(fight_math::roll_in_range(2, 7, 9_999) == 7, 3);
  assert!(fight_math::roll_in_range(7, 2, 9_999) == 7, 4);
  assert!(fight_math::effect_seed(5, 0) != fight_math::effect_seed(5, 1), 5);
  assert!(fight_math::tackle_seed(5, 3) != fight_math::tackle_seed(5, 2), 6);
  assert!(!fight_math::crit_at(0, 0, 0, 0), 7);
  assert!(fight_math::crit_at(2, 2, 0, 0) && !fight_math::crit_at(3, 2, 0, 0), 8);
  assert!(fight_math::crit_denominator(30, 100, 0) == 2, 9);
  assert!(fight_math::crit_denominator(3, 0, 1000) == 2, 10);
}

#[test]
fun initiative_weaves_unequal_sides_without_losing_seats() {
  assert!(fight_math::weave_teams(vector[]) == vector[], 0);
  assert!(fight_math::weave_teams(vector[0, 0, 0]) == vector[0, 1, 2], 1);
  assert!(fight_math::weave_teams(vector[1, 1]) == vector[0, 1], 2);
  assert!(fight_math::weave_teams(vector[0, 0, 0, 1, 1]) == vector[0, 3, 1, 4, 2], 3);
  assert!(fight_math::weave_teams(vector[0, 1, 1, 1]) == vector[0, 1, 2, 3], 4);
}

#[test]
fun tackle_combines_lockers_and_rounds_each_pool_loss_up() {
  let (num, den) = fight_math::tackle_contest(0, &vector[]);
  assert!(num == 1 && den == 1, 0);
  let (num, den) = fight_math::tackle_contest(0, &vector[0, 10]);
  assert!(num == 4 && den == 24, 1);
  let (ap, mp) = fight_math::tackle_losses(6, 3, num, den);
  assert!(ap == 5 && mp == 3, 2);
  let (num, den) = fight_math::tackle_contest(1000, &vector[0]);
  assert!(num == den, 3);
  let (ap, mp) = fight_math::tackle_losses(6, 3, num, den);
  assert!(ap == 0 && mp == 0, 4);
}

#[test]
fun point_removal_guarantees_preserve_rng_and_dodge_stays_bounded() {
  let (state, removed) = fight_math::remove_points(7, 5, false, 0, 0, 3, 3);
  assert!(state == 7 && removed == 3, 0);
  let (state, removed) = fight_math::remove_points(7, 2, false, 0, 0, 3, 3);
  assert!(state == 7 && removed == 2, 1);
  let (state, removed) = fight_math::remove_points(7, 2, true, 0, 0, 0, 0);
  assert!(state == 7 && removed == 0, 2);
  let mut successes = 0u64;
  let mut refusals = 0u64;
  let mut seed = 0;
  while (seed < 100) {
    let (_, strong) = fight_math::remove_points(seed, 8, true, 1000, 0, 3, 3);
    let (_, weak) = fight_math::remove_points(seed, 8, true, 0, 1000, 3, 3);
    let (_, equal) = fight_math::remove_points(seed, 1, true, 10, 10, 3, 3);
    assert!(strong <= 3 && weak <= 3 && equal <= 1, 3);
    if (strong == 3) successes = successes + 1;
    if (weak == 0) refusals = refusals + 1;
    seed = seed + 1;
  };
  assert!(successes > 0 && refusals > 0, 4);
}

#[test]
fun zero_xp_inputs_and_flat_bands_preserve_boundaries() {
  assert!(fight_math::retro_group_coefficient_tenths(0) == 0, 0);
  assert!(fight_math::retro_group_coefficient_tenths(99) == 36, 1);
  assert!(fight_math::xp_for_player(0, 0, 1, 1, 1, 1, 1) == 0, 2);
  assert!(fight_math::xp_for_player(100, 0, 0, 1, 1, 1, 1) == 0, 3);
  assert!(fight_math::xp_for_player(100, 0, 1, 0, 1, 1, 1) == 0, 4);
  assert!(fight_math::xp_for_player(100, 0, 1, 1, 0, 1, 1) == 0, 5);
  assert!(fight_math::xp_for_player(100, 0, 1, 1, 1, 0, 1) == 0, 6);
  assert!(fight_math::xp_for_player(100, 0, 1, 1, 1, 1, 0) == 0, 7);
  assert!(fight_math::mob_loot_chance_scaled(2345, 10, 10, 10) == 2345, 8);
  assert!(fight_math::centered_band_scaled(90, 100, 10, 10, 10) == 90, 9);
  assert!(fight_math::centered_band_scaled(0, 100, 10, 20, 10) == 0, 10);
}

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
fun retro_push_collision_uses_level_seed_and_untravelled_cells() {
  assert!(fight_math::push_collision_damage(2, 3, 0) == 24, 0);
  assert!(fight_math::push_collision_damage(50, 3, 0) == 27, 1);
  assert!(fight_math::push_collision_damage(50, 3, 7) == 48, 2);
  assert!(fight_math::push_collision_damage(200, 0, 7) == 0, 3);
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
  // Retro applies one percent per Wisdom after the group calculation.
  assert!(fight_math::xp_for_player(1_000, 100, 12, 12, 12, 12, 1) == 2_000, 10);
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
