// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
#[test_only]
module aresrpg_combat::numeric_ranges_tests;
use aresrpg_combat::combat;
use aresrpg_math::{fight_math, prng, spell_effect};

#[test]
fun every_numeric_retained_kind_rolls_once() {
  vector[4, 5, 7, 14, 15].do!(|kind| {
    let mut seed = 1;
    let amount = 2 + (prng::draw(&mut seed) % 10000) * 29 / 10000;
    let row = spell_effect::new_effect(kind, b"".to_string(), 2, 30, 0, 0, 0, 10000, if (kind == 7) spell_effect::chatiment_turns() else 2, 9);
    assert!(combat::numeric_rows_for_testing(vector[row], 1) == vector[seed, 100, 6, 100, 6, amount, 100, 6], 0);
  });
}

#[test]
fun a_stat_steal_shares_the_one_rolled_amount() {
  let mut seed = 1;
  let amount = 2 + (prng::draw(&mut seed) % 10000) * 29 / 10000;
  let row = spell_effect::new_effect(6, b"".to_string(), 2, 30, 0, 0, 0, 10000, 2, 9);
  assert!(combat::numeric_rows_for_testing(vector[row], 1) == vector[seed, 100, 6, amount, 100, 6, amount, 100, 6], 0);
}

#[test]
fun all_map_targets_get_independent_magnitudes_in_cell_order() {
  let mut seed = 1;
  let a = 2 + (prng::draw(&mut seed) % 10000) * 29 / 10000;
  let b = 2 + (prng::draw(&mut seed) % 10000) * 29 / 10000;
  let c = 2 + (prng::draw(&mut seed) % 10000) * 29 / 10000;
  let row = spell_effect::new_effect(4, b"".to_string(), 2, 30, spell_effect::shape_allmap(), 0, 0, 10000, 2, 9);
  assert!(combat::numeric_rows_for_testing(vector[row], 1) == vector[seed, 100, 6, a, 100, 6, b, 100, 6, c], 0);
}

#[test]
fun fixed_and_control_rows_preserve_entropy() {
  let fixed = spell_effect::new_effect(4, b"".to_string(), 4, 4, 0, 0, 0, 10000, 2, 9);
  let control = spell_effect::new_effect(18, b"".to_string(), 2, 30, 0, 0, 0, 10000, 2, 0);
  assert!(combat::numeric_rows_for_testing(vector[fixed, control], 1) == vector[1, 100, 6, 100, 6, 4, 6, 100, 6], 0);
}

#[test]
fun a_dead_active_seat_yields_to_its_living_teammate() {
  let mut state = combat::self_lethal_state_for_testing();
  let _ = combat::end_turn(&mut state, vector[1, 2, 3], 3000);
  assert!(combat::active_fighter(&state) == 1 && !combat::ended(&state), 0);
  combat::destroy(state);
}

#[test]
fun a_line_only_protector_moves_into_alignment_and_attacks() {
  assert!(combat::cast_destination_for_testing(true, 1, vector[], vector[]) == vector[124, 90, 124, 0], 0);
  assert!(combat::cast_destination_for_testing(false, 1, vector[], vector[]) == vector[104, 90, 105, 0], 1);
}

#[test]
fun an_unreachable_alignment_is_not_a_cast_destination() {
  assert!(combat::cast_destination_for_testing(true, 0, vector[], vector[])[0] == 380, 0);
  assert!(combat::cast_destination_for_testing(true, 1, vector[124], vector[])[0] == 380, 1);
}

#[test]
fun attempted_ap_magnitude_precedes_its_independent_dodge_stream() {
  vector[1, 2, 3, 4, 5, 6, 7, 8].do!(|initial| {
    let mut entropy = initial;
    let amount = 2 + (prng::draw(&mut entropy) % 10000) * 2 / 10000;
    let (next, removed) = fight_math::remove_points(prng::draw(&mut entropy), amount, true, 0, 0, 6, 6);
    let row = spell_effect::new_effect(6, b"".to_string(), 2, 3, 0, 0, 0, 10000, 2, 6);
    let mut expected = vector[next, 100, 6 + removed, 100, 6];
    if (removed > 0) expected.push_back(removed);
    expected.append(vector[100, 6]);
    assert!(combat::numeric_rows_for_testing(vector[row], initial) == expected, 0);
  });
}

#[test]
fun failed_chance_consumes_no_magnitude_draw() {
  let mut entropy = 1;
  let _ = prng::draw(&mut entropy);
  let row = spell_effect::new_effect(4, b"".to_string(), 2, 30, 0, 0, 0, 0, 2, 9);
  assert!(combat::numeric_rows_for_testing(vector[row], 1) == vector[entropy, 100, 6, 100, 6, 100, 6], 0);
}

#[test]
fun traps_can_kill_or_disarm_a_mob_before_its_planned_cast() {
  let lethal = spell_effect::new_effect(0, b"earth".to_string(), 100, 100, 0, 0, 0, 10000, 0, 0);
  assert!(combat::cast_destination_for_testing(true, 1, vector[], vector[lethal]) == vector[124, 100, 124, 2], 0);
  let drain = spell_effect::new_effect(20, b"".to_string(), 2, 2, 0, 0, 0, 10000, 0, 6);
  assert!(combat::cast_destination_for_testing(true, 1, vector[], vector[drain]) == vector[124, 100, 124, 0], 1);
}

#[test]
fun turn_rng_follows_effect_traversal_even_when_seat_indices_have_another_order() {
  assert!(combat::reordered_targets_for_testing() == vector[24, 7, 30], 0);
}
