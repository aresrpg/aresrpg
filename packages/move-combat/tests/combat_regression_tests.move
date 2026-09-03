// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// Behavioral regressions for the shipped authority-free combat machine. Core tests cover
/// custody and lifecycle authority; this suite owns deterministic fight behavior.
#[test_only]
module aresrpg_combat::combat_regression_tests;

use aresrpg_combat::combat;
use aresrpg_math::combat_grid;

const EBadTargetCell: u64 = 1720;

fun wall(): vector<u64> {
  let mut cells = vector[];
  let mut y = 3;
  while (y <= 8) {
    cells.push_back(combat_grid::encode(4, y));
    y = y + 1;
  };
  cells
}

#[test]
fun a_blocked_mob_walks_its_budget_around_the_wall() {
  let landed = combat::rush_for_testing(
    combat_grid::encode(3, 5), combat_grid::encode(5, 5), wall(), 3,
  );
  assert!(landed != combat_grid::encode(3, 5), 0);
  assert!(landed == combat_grid::encode(3, 2), 1);
}

#[test]
fun a_big_budget_reaches_the_flank() {
  let landed = combat::rush_for_testing(
    combat_grid::encode(3, 5), combat_grid::encode(5, 5), wall(), 12,
  );
  assert!(combat_grid::manhattan(landed, combat_grid::encode(5, 5)) == 1, 0);
}

#[test]
fun a_sealed_target_is_the_one_legal_hold() {
  let mut walls = vector[
    combat_grid::encode(5, 4), combat_grid::encode(5, 6),
    combat_grid::encode(4, 5), combat_grid::encode(6, 5),
  ];
  walls.append(wall());
  let landed = combat::rush_for_testing(
    combat_grid::encode(3, 5), combat_grid::encode(5, 5), walls, 6,
  );
  assert!(landed == combat_grid::encode(3, 5), 0);
}

#[test]
fun an_ally_only_buff_targets_the_mob_ally_not_the_player() {
  assert!(combat::ally_buff_for_testing() == vector[0, 1], 0);
}

#[test]
fun a_mob_spends_remaining_ap_on_repeated_casts() {
  assert!(combat::mob_multi_cast_for_testing(0) == vector[0, 80, 2], 0);
}

#[test]
fun a_mob_respects_its_authored_per_turn_cast_cap() {
  assert!(combat::mob_multi_cast_for_testing(1) == vector[4, 90, 1], 0);
}

#[test]
fun caster_only_cost_ignores_the_aimed_ally_area() {
  let hp = combat::caster_only_cost_for_testing();
  assert!(hp[0] == 82, 0);
  assert!(hp[1] == 100, 1);
}

#[test]
fun percent_life_damage_rolls_the_authored_band() {
  let hp = combat::percent_life_roll_for_testing();
  assert!(hp[0] == hp[1], 0);
}

#[test]
fun mob_spell_numbers_scale_but_geometry_does_not() {
  assert!(combat::mob_effect_scaling_for_testing() == vector[60, 72, 160, 192, 3], 0);
}

#[test]
fun a_final_turn_buff_stays_visible_and_effective_until_that_turn_closes() {
  assert!(combat::final_turn_buff_for_testing() == vector[8, 50, 2, 1, 0], 0);
}

#[test]
fun pool_removal_uses_the_next_pool_and_instant_active_removal_does_not_repeat() {
  assert!(combat::pool_removal_semantics_for_testing() == vector[1, 2, 4, 0, 0, 100, 0, 6], 0);
}

#[test]
fun life_steal_drinks_exactly_half_of_what_landed() {
  assert!(combat::life_steal_half_for_testing() == vector[85, 47], 0);
}

#[test]
fun range_removal_reduces_modifiable_authored_reach() {
  assert!(combat::range_removal_reaches_authored_max_for_testing() == 2, 0);
}

#[test]
fun a_chatiment_gains_damage_up_to_its_cap_once_per_active_fighter_turn() {
  assert!(combat::chatiment_caps_for_testing() == vector[2, 90, 140, 2, 0], 0);
}

#[test]
fun enemy_only_swap_refuses_allies_and_invisible_enemies() {
  assert!(combat::swap_filter_for_testing(), 0);
}

fun invisible_after_cast(placement: bool): bool {
  combat::invisible_after_damage_cast_for_testing(placement, false)
}

#[test]
fun trap_placement_preserves_invisibility() { assert!(invisible_after_cast(true), 0); }

#[test]
fun direct_damage_reveals() { assert!(!invisible_after_cast(false), 0); }

#[test]
fun mob_searches_when_every_enemy_is_invisible() {
  let cells = combat::mob_searches_for_invisible_enemy_for_testing();
  assert!(cells[0] != cells[1], 0);
}

#[test]
fun invisible_teammate_does_not_block_line_of_sight() {
  assert!(combat::invisible_teammate_los_for_testing(), 0);
}

#[test]
#[expected_failure(abort_code = 1721, location = aresrpg_combat::combat)]
fun an_invisible_occupant_still_consumes_the_per_target_cap() {
  combat::invisible_after_damage_cast_for_testing(false, true);
  abort 999
}

#[test]
fun duplicate_item_rows_are_one_collection_group() {
  assert!(combat::matching_drops_for_testing() == vector[5], 0);
}

#[test]
fun three_guaranteed_quantity_three_mob_rows_pay_nine_non_stackable_items() {
  assert!(combat::three_mob_non_stackable_split_for_testing() == vector[6, 3, 9], 0);
}

#[test]
fun mob_birth_resolves_loot_chance_but_preserves_quantity() {
  assert!(combat::mob_loot_scaling_for_testing() == vector[4_000, 6_000, 1, 2], 0);
}

#[test]
fun active_chance_effects_modify_loot_but_power_does_not() {
  assert!(combat::active_chance_for_loot_for_testing() == vector[600, 480, 420], 0);
}

#[test]
fun force_start_requires_an_armed_elapsed_clock() {
  assert!(!combat::placement_force_ready_for_testing(0, 1_000_000), 0);
  assert!(!combat::placement_force_ready_for_testing(42_000, 101_999), 1);
  assert!(combat::placement_force_ready_for_testing(42_000, 102_000), 2);
}

#[test]
fun shield_uses_elemental_characteristic_without_raw_damage_and_matches_incoming_element() {
  let result = combat::elemental_shield_scaling_for_testing();
  assert!(result[0] == 60, 0);
  assert!(result[1] == 37, 1);
}

#[test]
fun a_body_pulled_onto_the_declared_route_stops_the_walk() {
  let answer = combat::walk_into_pulled_body_for_testing();
  let step_1 = combat_grid::encode(1, 5);
  let step_2 = combat_grid::encode(2, 5);
  assert!(answer[1] == step_2, 0);
  assert!(answer[0] == step_1, 1);
  assert!(answer[0] != answer[1], 2);
}

fun resolve(
  existing_kind: u8,
  same_center: bool,
  target_occupied: bool,
  incoming_kinds: vector<u8>,
): vector<u64> {
  combat::resolve_placement_for_testing(
    existing_kind, same_center, target_occupied, incoming_kinds,
  )
}

fun assert_committed(answer: vector<u64>, expected_zones: u64) {
  assert!(answer[0] == expected_zones, 0);
  assert!(answer[1] == 4, 1);
  assert!(answer[2] == 1, 2);
  assert!(answer[3] == 1, 3);
}

#[test]
#[expected_failure(abort_code = EBadTargetCell, location = aresrpg_combat::combat)]
fun trap_center_rejects_a_glyph() { resolve(12, true, false, vector[13]); abort 0 }

#[test]
#[expected_failure(abort_code = EBadTargetCell, location = aresrpg_combat::combat)]
fun glyph_center_rejects_a_trap() { resolve(13, true, false, vector[12]); abort 0 }

#[test]
#[expected_failure(abort_code = EBadTargetCell, location = aresrpg_combat::combat)]
fun trap_center_rejects_a_living_fighter() { resolve(0, false, true, vector[12]); abort 0 }

#[test]
#[expected_failure(abort_code = EBadTargetCell, location = aresrpg_combat::combat)]
fun one_cast_cannot_create_two_zones_at_one_center() {
  resolve(0, false, false, vector[12, 13]);
  abort 0
}

#[test]
fun map_wide_zone_area_overlap_is_legal_when_centers_differ() {
  assert_committed(resolve(13, false, false, vector[12]), 2);
}

#[test]
fun glyph_center_accepts_a_living_fighter() {
  assert_committed(resolve(0, false, true, vector[13]), 1);
}

#[test]
fun movement_inside_a_multi_cell_trap_fires_it() {
  assert!(combat::covered_trap_fires_on_move_for_testing(), 0);
}

#[test]
fun stepping_off_the_edge_of_a_trap_area_stays_silent() {
  assert!(combat::trap_edge_exit_for_testing(), 0);
}

#[test]
fun overlapping_damage_trap_resolves_before_push_trap() {
  let result = combat::layered_traps_damage_before_push_for_testing(false);
  assert!(result[0] < 100, 0);
  assert!(result[1] == result[2], 1);
}

#[test]
fun a_push_centered_on_its_target_is_a_soft_stop() {
  let result = combat::layered_traps_damage_before_push_for_testing(true);
  assert!(result == vector[100, result[2], result[2]], 0);
}

#[test]
fun fighter_death_removes_every_owned_zone() {
  assert!(combat::zones_after_owner_death_for_testing() == vector[1, 1], 0);
}
