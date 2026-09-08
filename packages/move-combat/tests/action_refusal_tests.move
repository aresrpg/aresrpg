// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
#[test_only]
module aresrpg_combat::action_refusal_tests;
use aresrpg_combat::{combat, public_lifecycle_tests};
use aresrpg_math::spell_effect;

fun spell(cost: u8, range: u8, sight: bool, line: bool, per_turn: u8, per_target: u8, cooldown: u8): spell_effect::SpellLevel {
  spell_effect::new_spell_level(cost, 0, range, false, sight, line, false, per_turn, per_target, cooldown, 0,
    vector[spell_effect::new_effect(0, b"earth".to_string(), 1, 1, 0, 0, 0, 10000, 0, 0)], vector[])
}

fun attempt(fighter: u64, level: spell_effect::SpellLevel, target: u64) {
  let mut state = public_lifecycle_tests::active();
  combat::cast(&mut state, fighter, &level, b"Attempt".to_string(), target, 1);
  combat::destroy(state);
}

#[test]
#[expected_failure(abort_code = 1706, location = aresrpg_combat::combat)]
fun another_seat_cannot_cast() { attempt(1, spell(1, 40, false, false, 0, 0, 0), 100); }

#[test]
#[expected_failure(abort_code = 1715, location = aresrpg_combat::combat)]
fun a_spell_cannot_spend_unavailable_ap() { attempt(0, spell(7, 40, false, false, 0, 0, 0), 200); }

#[test]
#[expected_failure(abort_code = 1720, location = aresrpg_combat::combat)]
fun a_spell_cannot_target_outside_the_grid() { attempt(0, spell(1, 40, false, false, 0, 0, 0), 380); }

#[test]
#[expected_failure(abort_code = 1716, location = aresrpg_combat::combat)]
fun spell_range_is_authoritative() { attempt(0, spell(1, 1, false, false, 0, 0, 0), 200); }

#[test]
#[expected_failure(abort_code = 1718, location = aresrpg_combat::combat)]
fun a_line_only_spell_cannot_target_diagonally() { attempt(0, spell(1, 40, false, true, 0, 0, 0), 201); }

#[test]
#[expected_failure(abort_code = 1717, location = aresrpg_combat::combat)]
fun a_living_body_blocks_sight() {
  let mut state = public_lifecycle_tests::active();
  combat::add_fighter(&mut state, public_lifecycle_tests::player(0, 160));
  combat::cast(&mut state, 0, &spell(1, 40, true, false, 0, 0, 0), b"Sight".to_string(), 200, 1);
  combat::destroy(state);
}

fun repeated(level: spell_effect::SpellLevel) {
  let mut state = public_lifecycle_tests::active();
  combat::cast(&mut state, 0, &level, b"Repeat".to_string(), 200, 1);
  combat::cast(&mut state, 0, &level, b"Repeat".to_string(), 200, 1);
  combat::destroy(state);
}

#[test]
#[expected_failure(abort_code = 1721, location = aresrpg_combat::combat)]
fun the_per_turn_cap_refuses_a_second_cast() { repeated(spell(1, 40, false, false, 1, 0, 0)); }

#[test]
#[expected_failure(abort_code = 1721, location = aresrpg_combat::combat)]
fun the_per_target_cap_refuses_a_second_cast() { repeated(spell(1, 40, false, false, 0, 1, 0)); }

#[test]
#[expected_failure(abort_code = 1721, location = aresrpg_combat::combat)]
fun the_cooldown_refuses_a_second_cast() { repeated(spell(1, 40, false, false, 0, 0, 1)); }

#[test]
fun a_critical_cast_uses_only_its_critical_rows() {
  let mut state = public_lifecycle_tests::active();
  let level = spell_effect::new_spell_level(1, 0, 40, false, true, true, false, 0, 0, 0, 2,
    vector[spell_effect::new_effect(0, b"earth".to_string(), 1, 1, 0, 0, 0, 10000, 0, 0)],
    vector[spell_effect::new_effect(0, b"earth".to_string(), 2, 2, 0, 0, 0, 10000, 0, 0)]);
  combat::cast(&mut state, 0, &level, b"Critical".to_string(), 200, 1);
  assert!(combat::fighter_hp(&state, 1) == 98, 0);
  combat::destroy(state);
}

#[test]
#[expected_failure(abort_code = 1723, location = aresrpg_combat::combat)]
fun an_unready_fight_refuses_an_early_start() {
  let mut state = public_lifecycle_tests::placement();
  let _ = combat::start(&mut state, vector[1, 2], 60000);
  combat::destroy(state);
}

#[test]
fun force_start_respects_the_placement_deadline() {
  let mut state = public_lifecycle_tests::placement();
  let _ = combat::start(&mut state, vector[1, 2], 60001);
  assert!(!combat::in_placement(&state) && combat::active_fighter(&state) == 0, 0);
  combat::destroy(state);
}

#[test]
fun placement_forfeits_preserve_stable_seats_and_skip_the_dead_queue_head() {
  let mut state = public_lifecycle_tests::placement();
  combat::add_fighter(&mut state, public_lifecycle_tests::player(0, 101));
  combat::forfeit(&mut state, 0);
  assert!(combat::player_count(&state, 0) == 1, 0);
  let _ = combat::ready(&mut state, 1);
  let _ = combat::ready(&mut state, 2);
  let _ = combat::start(&mut state, vector[1, 2, 3], 1);
  assert!(combat::active_fighter(&state) == 1 && combat::fighter_forfeited(&state, 0), 1);
  combat::destroy(state);
}

#[test]
#[expected_failure(abort_code = 1724, location = aresrpg_combat::combat)]
fun normal_end_turn_preserves_the_timing_floor() {
  let mut state = public_lifecycle_tests::active();
  let _ = combat::end_turn(&mut state, vector[1, 2], 3000);
  combat::destroy(state);
}

#[test]
#[expected_failure(abort_code = 1724, location = aresrpg_combat::combat)]
fun crank_cannot_skip_an_unexpired_live_turn() {
  let mut state = public_lifecycle_tests::active();
  let _ = combat::crank(&mut state, vector[1, 2], 3001);
  combat::destroy(state);
}

#[test]
#[expected_failure(abort_code = 1706, location = aresrpg_combat::combat)]
fun active_fights_cannot_return_to_placement() {
  let mut state = public_lifecycle_tests::active();
  combat::place(&mut state, 0, 101);
  combat::destroy(state);
}

#[test]
#[expected_failure(abort_code = 1706, location = aresrpg_combat::combat)]
fun active_fights_cannot_ready_again() {
  let mut state = public_lifecycle_tests::active();
  let _ = combat::ready(&mut state, 0);
  combat::destroy(state);
}

#[test]
#[expected_failure(abort_code = 1706, location = aresrpg_combat::combat)]
fun a_started_fight_cannot_restart() {
  let mut state = public_lifecycle_tests::active();
  let _ = combat::start(&mut state, vector[1, 2], 60001);
  combat::destroy(state);
}

fun forfeited_placement(): combat::State {
  let mut state = public_lifecycle_tests::placement();
  combat::add_fighter(&mut state, public_lifecycle_tests::player(0, 101));
  combat::forfeit(&mut state, 0);
  state
}

#[test]
#[expected_failure(abort_code = 1709, location = aresrpg_combat::combat)]
fun a_forfeited_seat_cannot_ready() {
  let mut state = forfeited_placement();
  let _ = combat::ready(&mut state, 0);
  combat::destroy(state);
}

#[test]
#[expected_failure(abort_code = 1709, location = aresrpg_combat::combat)]
fun a_forfeited_seat_cannot_reposition() {
  let mut state = forfeited_placement();
  combat::place(&mut state, 0, 102);
  combat::destroy(state);
}

#[test]
#[expected_failure(abort_code = 1711, location = aresrpg_combat::combat)]
fun a_forfeited_seat_cannot_forfeit_again() {
  let mut state = forfeited_placement();
  combat::forfeit(&mut state, 0);
  combat::destroy(state);
}

#[test]
fun the_other_team_can_reposition_inside_its_own_band() {
  let mut state = public_lifecycle_tests::placement();
  combat::place(&mut state, 1, 201);
  assert!(combat::fighter_cell(&state, 1) == 201, 0);
  combat::destroy(state);
}

#[test]
#[expected_failure(abort_code = 1710, location = aresrpg_combat::combat)]
fun marking_settlement_requires_an_ended_fight() {
  let mut state = public_lifecycle_tests::active();
  combat::mark_settled(&mut state, 0);
  combat::destroy(state);
}

#[test]
#[expected_failure(abort_code = 1711, location = aresrpg_combat::combat)]
fun marking_settlement_twice_is_refused() {
  let mut state = public_lifecycle_tests::active();
  combat::forfeit(&mut state, 1);
  combat::mark_settled(&mut state, 0);
  combat::mark_settled(&mut state, 0);
  combat::destroy(state);
}

#[test]
#[expected_failure(abort_code = 1710, location = aresrpg_combat::combat)]
fun an_active_fight_has_no_last_settlement() {
  let state = public_lifecycle_tests::active();
  combat::assert_last_settlers(&state, &vector[0, 1]);
  combat::destroy(state);
}

#[test]
#[expected_failure(abort_code = 1710, location = aresrpg_combat::combat)]
fun an_active_fight_cannot_close() {
  let state = public_lifecycle_tests::active();
  combat::assert_closable(&state);
  combat::destroy(state);
}

#[test]
#[expected_failure(abort_code = 1710, location = aresrpg_combat::combat)]
fun an_ended_fight_cannot_forfeit_again() {
  let mut state = public_lifecycle_tests::active();
  combat::forfeit(&mut state, 1);
  combat::forfeit(&mut state, 0);
  combat::destroy(state);
}

#[test]
fun a_dead_active_seat_can_be_cranked_without_the_live_stall_timeout() {
  let mut state = combat::self_lethal_state_for_testing();
  let _ = combat::crank(&mut state, vector[1, 2, 3], 0);
  assert!(combat::active_fighter(&state) == 1, 0);
  combat::destroy(state);
}

#[test]
#[expected_failure(abort_code = 1723, location = aresrpg_combat::combat)]
fun a_fight_cannot_start_without_a_living_opponent() {
  let board = aresrpg_math::combat_grid::generate(1, 0);
  let mut state = combat::new_state(board, vector[public_lifecycle_tests::player(0, board.start_cells_a()[0])], 1);
  let _ = combat::ready(&mut state, 0);
  let _ = combat::start(&mut state, vector[1, 2], 1);
  combat::destroy(state);
}
