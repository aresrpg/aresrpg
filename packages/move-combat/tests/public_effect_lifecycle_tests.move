// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
#[test_only]
module aresrpg_combat::public_effect_lifecycle_tests;
use aresrpg_combat::{combat, public_lifecycle_tests};
use aresrpg_math::spell_effect;

fun spell(rows: vector<spell_effect::Effect>): spell_effect::SpellLevel {
  spell_effect::new_spell_level(1, 0, 40, false, false, false, false, 0, 0, 0, 0, rows, vector[])
}

fun row(kind: u8, value: u32, turns: u8, stat: u8): spell_effect::Effect {
  spell_effect::new_effect(kind, b"".to_string(), value, value, 0, 0, 0, 10000, turns, stat)
}

fun cast(state: &mut combat::State, rows: vector<spell_effect::Effect>, target: u64) {
  combat::cast(state, 0, &spell(rows), b"Effect".to_string(), target, 1);
}

#[test]
fun teleport_and_swap_apply_real_positions_without_advancing_the_turn() {
  let mut state = public_lifecycle_tests::active();
  cast(&mut state, vector[row(10, 0, 0, 0)], 104);
  assert!(combat::fighter_cell(&state, 0) == 104 && combat::active_fighter(&state) == 0, 0);
  cast(&mut state, vector[row(10, 0, 0, 0)], 200);
  assert!(combat::fighter_cell(&state, 0) == 104, 1);
  cast(&mut state, vector[row(11, 0, 0, 0)], 200);
  assert!(combat::fighter_cell(&state, 0) == 200 && combat::fighter_cell(&state, 1) == 104, 2);
  cast(&mut state, vector[row(11, 0, 0, 0)], 201);
  assert!(combat::fighter_cell(&state, 0) == 200 && combat::fighter_cell(&state, 1) == 104, 3);
  combat::move_active_fighter(&mut state, &vector[201, 202]);
  assert!(combat::fighter_cell(&state, 0) == 202, 4);
  combat::destroy(state);
}

#[test]
fun shielding_return_and_redirection_have_distinct_damage_destinations() {
  let mut state = public_lifecycle_tests::active();
  cast(&mut state, vector[row(14, 100, 2, 0)], 200);
  cast(&mut state, vector[row(0, 10, 0, 0)], 200);
  assert!(combat::fighter_hp(&state, 1) == 100, 0);
  cast(&mut state, vector[row(16, 0, 0, 0), row(18, 0, 2, 0)], 200);
  cast(&mut state, vector[row(0, 10, 0, 0)], 200);
  assert!(combat::fighter_hp(&state, 1) == 100 && combat::fighter_hp(&state, 0) == 90, 1);
  cast(&mut state, vector[row(16, 0, 0, 0), row(19, 0, 2, 0)], 200);
  cast(&mut state, vector[row(0, 10, 0, 0)], 200);
  assert!(combat::fighter_hp(&state, 1) == 100 && combat::fighter_hp(&state, 0) == 80, 2);
  combat::destroy(state);
}

#[test]
fun reflection_damages_the_attacker_and_dispel_removes_it() {
  let mut state = public_lifecycle_tests::active();
  cast(&mut state, vector[row(15, 7, 2, 0)], 200);
  cast(&mut state, vector[row(0, 10, 0, 0)], 200);
  assert!(combat::fighter_hp(&state, 0) == 93 && combat::fighter_hp(&state, 1) == 90, 0);
  cast(&mut state, vector[row(16, 0, 0, 0)], 200);
  cast(&mut state, vector[row(0, 10, 0, 0)], 200);
  assert!(combat::fighter_hp(&state, 0) == 93 && combat::fighter_hp(&state, 1) == 80, 1);
  combat::destroy(state);
}

#[test]
fun punishment_uses_current_hp_and_timed_healing_survives_until_its_tick() {
  let mut state = public_lifecycle_tests::active();
  cast(&mut state, vector[row(2, 50, 0, 0)], 100);
  cast(&mut state, vector[row(3, 10, 0, 0)], 200);
  assert!(combat::fighter_hp(&state, 0) == 50 && combat::fighter_hp(&state, 1) < 100, 0);
  cast(&mut state, vector[row(4, 5, 0, 12), row(4, 7, 2, 12)], 100);
  assert!(combat::fighter_hp(&state, 0) == 55, 1);
  let _ = combat::end_turn(&mut state, vector[2, 3, 4], 3001);
  let _ = combat::end_turn(&mut state, vector[2, 3, 4], 6001);
  assert!(combat::fighter_hp(&state, 0) == 62, 2);
  combat::destroy(state);
}

#[test]
fun every_element_respects_matching_resistance_buffs_and_steals() {
  vector[b"earth", b"fire", b"water", b"air", b""].do!(|element| {
    let mut state = public_lifecycle_tests::active();
    let element = element.to_string();
    let rows = vector[
      spell_effect::new_effect(4, element, 10, 10, 0, 0, 0, 10000, 2, 11),
      spell_effect::new_effect(5, element, 3, 3, 0, 0, 0, 10000, 2, 11),
      spell_effect::new_effect(6, element, 2, 2, 0, 0, 0, 10000, 2, 11),
      spell_effect::new_effect(0, element, 20, 20, 0, 0, 0, 10000, 0, 0),
    ];
    cast(&mut state, rows, 200);
    assert!(combat::fighter_hp(&state, 1) == 81, 0);
    combat::destroy(state);
  });
}

#[test]
fun two_identical_chatiments_share_a_cap_and_merge_gains() {
  let mut state = public_lifecycle_tests::active();
  cast(&mut state, vector[row(7, 20, 5, 0), row(7, 20, 5, 0)], 200);
  cast(&mut state, vector[row(0, 10, 0, 0), row(0, 10, 0, 0)], 200);
  assert!(combat::fighter_hp(&state, 1) == 80, 0);
  let _ = combat::end_turn(&mut state, vector[2, 3, 4], 3001);
  combat::cast(&mut state, 1, &spell(vector[
    spell_effect::new_effect(0, b"earth".to_string(), 20, 20, 0, 0, 0, 10000, 0, 0),
  ]), b"Retaliate".to_string(), 100, 1);
  // Two 10-damage player hits feed 5 strength each, not two duplicate 10-strength gains.
  assert!(combat::fighter_hp(&state, 0) == 78, 1);
  combat::destroy(state);
}

#[test]
fun cooling_spells_can_be_cast_again_after_the_cooldown_expires() {
  let mut state = public_lifecycle_tests::active();
  let level = spell_effect::new_spell_level(1, 0, 40, false, false, false, false, 0, 0, 1, 0,
    vector[row(0, 1, 0, 0)], vector[]);
  combat::cast(&mut state, 0, &level, b"Cooldown".to_string(), 200, 1);
  let _ = combat::end_turn(&mut state, vector[2, 3, 4], 3001);
  let _ = combat::end_turn(&mut state, vector[2, 3, 4], 6001);
  combat::cast(&mut state, 0, &level, b"Cooldown".to_string(), 200, 1);
  assert!(combat::fighter_hp(&state, 1) == 98, 0);
  combat::destroy(state);
}

#[test]
#[expected_failure(abort_code = 1725, location = aresrpg_combat::combat)]
fun movement_refuses_a_discontinuous_path() {
  let mut state = public_lifecycle_tests::active();
  combat::move_active_fighter(&mut state, &vector[102]);
  combat::destroy(state);
}

#[test]
fun ap_and_mp_pool_effects_apply_once_now_and_once_on_the_next_refill() {
  let mut state = public_lifecycle_tests::active();
  cast(&mut state, vector[row(4, 2, 2, 6), row(4, 2, 2, 7)], 100);
  assert!(combat::fighter_resources_for_testing(&state, 0) == vector[100, 7, 5, 2], 0);
  cast(&mut state, vector[row(20, 1, 2, 6), row(20, 1, 2, 7)], 100);
  assert!(combat::fighter_resources_for_testing(&state, 0) == vector[100, 5, 4, 4], 1);
  let _ = combat::end_turn(&mut state, vector[2, 3, 4], 3001);
  let _ = combat::end_turn(&mut state, vector[2, 3, 4], 6001);
  assert!(combat::fighter_resources_for_testing(&state, 0) == vector[100, 7, 4, 4], 2);
  let _ = combat::end_turn(&mut state, vector[2, 3, 4], 9001);
  let _ = combat::end_turn(&mut state, vector[2, 3, 4], 12001);
  assert!(combat::fighter_resources_for_testing(&state, 0) == vector[100, 6, 3, 0], 3);
  combat::destroy(state);
}

#[test]
fun mp_steal_retains_the_actual_removal_and_grants_exactly_that_amount() {
  let mut state = public_lifecycle_tests::active();
  cast(&mut state, vector[row(6, 3, 1, 7)], 200);
  let after = combat::fighter_resources_for_testing(&state, 0);
  let removed = after[2] - 3;
  assert!(removed <= 3, 0);
  let _ = combat::end_turn(&mut state, vector[2, 3, 4], 3001);
  assert!(combat::fighter_resources_for_testing(&state, 1)[2] == 3 - removed, 1);
  combat::destroy(state);
}

#[test]
fun a_failed_tackle_spends_the_live_pools_and_prevents_a_free_retry() {
  let mut state = public_lifecycle_tests::active();
  let stats = combat::player_fighter_stats(0, 0, 0, 10000, 0, 1, 100, &aresrpg_math::item_stats::zero());
  combat::add_fighter(&mut state, combat::new_player_fighter(1, 101, 100, stats));
  combat::move_active_fighter(&mut state, &vector[80]);
  assert!(combat::fighter_cell(&state, 0) == 100, 0);
  assert!(combat::fighter_resources_for_testing(&state, 0) == vector[100, 0, 0, 0], 1);
  combat::destroy(state);
}

#[test]
fun push_collision_and_pull_stopping_distance_use_the_same_movement_owner() {
  let mut state = public_lifecycle_tests::active();
  combat::add_fighter(&mut state, public_lifecycle_tests::player(1, 220));
  cast(&mut state, vector[row(8, 2, 0, 0)], 200);
  assert!(combat::fighter_hp(&state, 1) == 84 && combat::fighter_cell(&state, 1) == 200, 0);
  cast(&mut state, vector[row(9, 10, 0, 0)], 200);
  assert!(combat::fighter_cell(&state, 1) == 120 && combat::fighter_hp(&state, 1) == 84, 1);
  combat::destroy(state);
}

#[test]
fun trap_displacement_interrupts_the_remainder_of_a_declared_path() {
  let mut state = public_lifecycle_tests::active();
  let trap = spell_effect::new_effect(12, b"".to_string(), 0, 0, spell_effect::shape_circle(), 1, 0, 10000, 0, 0);
  cast(&mut state, vector[trap, row(8, 1, 0, 0)], 102);
  combat::move_active_fighter(&mut state, &vector[101, 102]);
  assert!(combat::fighter_cell(&state, 0) == 100, 0);
  assert!(combat::fighter_resources_for_testing(&state, 0)[2] == 2, 1);
  combat::destroy(state);
}

#[test]
fun active_mp_removal_does_not_install_an_instant_effect_for_the_next_turn() {
  let mut saw_removal = false;
  let mut saw_dodge = false;
  vector[1, 2, 3, 4, 5, 6, 7, 8].do!(|seed| {
    let mut state = public_lifecycle_tests::placement();
    let _ = combat::ready(&mut state, 0);
    let _ = combat::ready(&mut state, 1);
    let _ = combat::start(&mut state, vector[seed], 1);
    cast(&mut state, vector[row(5, 3, 0, 7)], 100);
    let pools = combat::fighter_resources_for_testing(&state, 0);
    assert!(pools[2] <= 3 && pools[3] == 0, 0);
    saw_removal = saw_removal || pools[2] < 3;
    saw_dodge = saw_dodge || pools[2] == 3;
    combat::destroy(state);
  });
  assert!(saw_removal && saw_dodge, 1);
}

#[test]
fun a_self_lethal_cost_skips_later_caster_only_buffs() {
  let mut state = public_lifecycle_tests::placement();
  combat::add_fighter(&mut state, public_lifecycle_tests::player(0, 101));
  let _ = combat::ready(&mut state, 0);
  let _ = combat::ready(&mut state, 1);
  let _ = combat::ready(&mut state, 2);
  let _ = combat::start(&mut state, vector[1, 2, 3], 1);
  let cost = spell_effect::new_effect(2, b"".to_string(), 100, 100, 0, 0, 4, 10000, 0, 0);
  let buff = spell_effect::new_effect(4, b"".to_string(), 2, 30, 0, 0, 4, 10000, 2, 9);
  cast(&mut state, vector[cost, buff], 200);
  assert!(combat::fighter_resources_for_testing(&state, 0)[3] == 0, 0);
  assert!(!combat::ended(&state) && combat::fighter_dead(&state, 0), 1);
  combat::destroy(state);
}

#[test]
fun mixed_chatiments_merge_only_matching_channels_and_ignore_unrelated_buffs() {
  let mut state = public_lifecycle_tests::active();
  cast(&mut state, vector[row(4, 1, 5, 4), row(7, 20, 5, 0), row(7, 20, 5, 3),
    row(7, 20, 5, 0), row(7, 20, 5, 3)], 200);
  cast(&mut state, vector[row(0, 10, 0, 0), row(0, 10, 0, 0)], 200);
  assert!(combat::fighter_resources_for_testing(&state, 1) == vector[80, 0, 0, 7], 0);
  let _ = combat::end_turn(&mut state, vector[2, 3, 4], 3001);
  combat::cast(&mut state, 1, &spell(vector[
    spell_effect::new_effect(0, b"earth".to_string(), 20, 20, 0, 0, 0, 10000, 0, 0),
  ]), b"Retaliate".to_string(), 100, 1);
  assert!(combat::fighter_hp(&state, 0) == 78, 1);
  combat::destroy(state);
}

#[test]
fun swapping_with_your_own_seat_is_a_noop() {
  let mut state = public_lifecycle_tests::active();
  cast(&mut state, vector[row(11, 0, 0, 0)], 100);
  assert!(combat::fighter_cell(&state, 0) == 100 && combat::fighter_cell(&state, 1) == 200, 0);
  combat::destroy(state);
}

#[test]
fun overkill_life_steal_drinks_only_the_hp_that_existed() {
  let mut state = public_lifecycle_tests::active();
  cast(&mut state, vector[row(2, 99, 0, 0)], 100);
  let steal = spell_effect::new_effect(6, b"earth".to_string(), 200, 200, 0, 0, 1, 10000, 0, 12);
  cast(&mut state, vector[steal], 200);
  assert!(combat::fighter_hp(&state, 0) == 51 && combat::ended(&state), 0);
  combat::destroy(state);
}

#[test]
fun lethal_reflection_cannot_be_undone_by_the_life_steal_heal() {
  let mut state = public_lifecycle_tests::active();
  cast(&mut state, vector[row(15, 10, 2, 0)], 200);
  cast(&mut state, vector[row(2, 99, 0, 0)], 100);
  let steal = spell_effect::new_effect(6, b"earth".to_string(), 10, 10, 0, 0, 1, 10000, 0, 12);
  cast(&mut state, vector[steal], 200);
  assert!(combat::fighter_dead(&state, 0) && combat::fighter_hp(&state, 0) == 0, 0);
  assert!(combat::winner(&state) == option::some(1), 1);
  combat::destroy(state);
}

#[test]
fun zero_self_damage_does_not_feed_a_reaction_buff() {
  let mut state = public_lifecycle_tests::active();
  cast(&mut state, vector[row(7, 20, 5, 0), row(2, 0, 0, 0)], 100);
  assert!(combat::fighter_resources_for_testing(&state, 0) == vector[100, 5, 3, 1], 0);
  combat::destroy(state);
}

#[test]
fun a_range_buff_extends_only_modifiable_spells() {
  let mut state = public_lifecycle_tests::active();
  cast(&mut state, vector[row(4, 1, 2, 5)], 100);
  let level = spell_effect::new_spell_level(1, 0, 4, true, false, false, false, 0, 0, 0, 0,
    vector[row(0, 1, 0, 0)], vector[]);
  combat::cast(&mut state, 0, &level, b"Extended".to_string(), 200, 1);
  assert!(combat::fighter_hp(&state, 1) == 99, 0);
  combat::destroy(state);
}
