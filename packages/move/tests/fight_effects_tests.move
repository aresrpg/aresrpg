// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
#[test_only]
module aresrpg::fight_effects_tests;

use aresrpg::fight;
use sui::test_scenario;

const OWNER: address = @0xA11CE;

#[test]
fun mob_spell_numbers_scale_but_geometry_does_not() {
  assert!(fight::mob_effect_scaling_for_testing() == vector[60, 72, 160, 192, 3], 0);
}

#[test]
fun a_final_turn_buff_stays_visible_and_effective_until_that_turn_closes() {
  let mut scenario = test_scenario::begin(OWNER);
  // +2 AP and +50 Power remain in the live sheet at duration one, then expire at turn end.
  assert!(fight::final_turn_buff_for_testing(scenario.ctx()) == vector[8, 50, 2, 1, 0], 0);
  scenario.end();
}

#[test]
fun pool_removal_uses_the_next_pool_and_instant_active_removal_does_not_repeat() {
  let mut scenario = test_scenario::begin(OWNER);
  let result = fight::pool_removal_semantics_for_testing(scenario.ctx());
  assert!(result == vector[1, 2, 4, 0], 0);
  scenario.end();
}

#[test]
fun life_steal_drinks_exactly_half_of_what_landed() {
  let mut scenario = test_scenario::begin(OWNER);
  // 15 lands on the neutral target; the caster (at 40 hp) drinks 7 — never the full 15
  assert!(fight::life_steal_half_for_testing(scenario.ctx()) == vector[85, 47], 0);
  scenario.end();
}

#[test]
fun range_removal_reduces_modifiable_authored_reach() {
  let mut scenario = test_scenario::begin(OWNER);
  assert!(fight::range_removal_reaches_authored_max_for_testing(scenario.ctx()) == 2, 0);
  scenario.end();
}

#[test]
fun a_chatiment_gains_damage_up_to_its_cap_once_per_active_fighter_turn() {
  let mut scenario = test_scenario::begin(OWNER);
  // Mob damage 40 + 40 caps at 60; player damage feeds half and caps the next row at 30.
  // Both five-turn gains survive four affected turn ends and expire on the fifth.
  assert!(fight::chatiment_caps_for_testing(scenario.ctx()) == vector[2, 90, 140, 2, 0], 0);
  scenario.end();
}

#[test]
fun enemy_only_swap_refuses_allies_and_invisible_enemies() {
  let mut scenario = test_scenario::begin(OWNER);
  assert!(fight::swap_filter_for_testing(scenario.ctx()), 0);
  scenario.end();
}
