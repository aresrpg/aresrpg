// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
#[test_only]
module aresrpg_combat::public_lifecycle_tests;
use aresrpg_combat::combat;
use aresrpg_math::{combat_grid, item_stats, mob_data, spell_effect};

public(package) fun player(team: u8, cell: u64): combat::Fighter {
  let stats = combat::player_fighter_stats(0, 0, 0, 0, 0, 1, 100, &item_stats::zero());
  let fighter = combat::new_player_fighter(team, cell, 100, stats);
  assert!(combat::level(&fighter) == 1, 0);
  combat::cap_fighter_hp(fighter, 100)
}

public(package) fun placement(): combat::State {
  let board = combat_grid::grid_spec(20, 19,
    vector[0xFFFFFFFFFFFFFFFF, 0xFFFFFFFFFFFFFFFF, 0xFFFFFFFFFFFFFFFF, 0xFFFFFFFFFFFFFFFF, 0xFFFFFFFFFFFFFFFF, 0x0FFFFFFFFFFFFFFF],
    vector[], vector[], vector[100, 101, 102, 103, 104, 105], vector[200, 201, 202, 203, 204, 205]);
  combat::new_state(board, vector[player(0, 100), player(1, 200)], 1)
}

public(package) fun active(): combat::State {
  let mut state = placement();
  assert!(!combat::ready(&mut state, 0), 0);
  assert!(combat::ready(&mut state, 1), 1);
  let used = combat::start(&mut state, vector[7, 8, 9], 1);
  assert!(used.is_empty(), 2);
  state
}

fun lethal(): spell_effect::SpellLevel {
  spell_effect::new_spell_level(1, 0, 40, false, false, false, false, 0, 0, 0, 0,
    vector[spell_effect::new_effect(0, b"earth".to_string(), 100, 100, 0, 0, 1, 10000, 0, 0)], vector[])
}

#[test]
fun placement_tracks_live_seats_and_start_cells() {
  let mut state = placement();
  assert!(combat::placement_started_ms(&state) == 1 && combat::in_placement(&state), 0);
  combat::set_placement_started_ms(&mut state, 5);
  assert!(combat::placement_started_ms(&state) == 5, 1);
  assert!(combat::player_count(&state, 0) == 1 && combat::player_count(&state, 1) == 1, 2);
  assert!(combat::first_free_start(&state, 0) == option::some(101), 3);
  assert!(combat::first_free_start(&state, 1) == option::some(201), 4);
  combat::place(&mut state, 0, 101);
  assert!(combat::fighter_cell(&state, 0) == 101 && combat::fighter_team(&state, 0) == 0, 5);
  combat::add_fighter(&mut state, player(0, 100));
  combat::add_fighter(&mut state, player(0, 102));
  vector[103, 104, 105].do!(|cell| combat::add_fighter(&mut state, player(0, cell)));
  assert!(combat::first_free_start(&state, 0).is_none(), 6);
  combat::forfeit(&mut state, 2);
  assert!(combat::first_free_start(&state, 0).is_none(), 7);
  assert!(combat::fighter_forfeited(&state, 2) && combat::fighter_settled(&state, 2), 8);
  assert!(!combat::is_closable(&state) && !combat::has_mobs(&state), 9);
  assert!(combat::winners_remaining(&state) == 0 && !combat::fighter_won(&state, 0), 10);
  combat::destroy(state);
}

#[test]
fun pvp_winners_and_losers_settle_once_before_close() {
  let mut state = active();
  combat::cast(&mut state, 0, &lethal(), b"Lethal".to_string(), 200, 1);
  assert!(combat::fighter_won(&state, 0) && !combat::fighter_won(&state, 1), 0);
  assert!(combat::winners_remaining(&state) == 1 && !combat::is_closable(&state), 1);
  assert!(combat::roll_and_split_drops(&mut state, 0, vector[]) == vector[0], 5);
  let (won, survived, hp, xp) = combat::settlement_values(&state, 0);
  assert!(won && survived && hp == 100 && xp == 0, 2);
  let (won, survived, hp, xp) = combat::settlement_values(&state, 1);
  assert!(!won && !survived && hp == 1 && xp == 0, 3);
  combat::mark_settled(&mut state, 1);
  combat::assert_last_settlers(&state, &vector[0]);
  combat::mark_settled(&mut state, 0);
  assert!(combat::winners_remaining(&state) == 0 && combat::is_closable(&state), 4);
  combat::assert_closable(&state);
  combat::destroy(state);
}

#[test]
fun mob_rewards_split_exact_loot_and_exclude_settled_players() {
  let board = combat_grid::generate(1, 0);
  let player_cell = board.start_cells_a()[0];
  let target = board.start_cells_b()[0];
  let shift = item_stats::shift() as u64;
  let stats = combat::new_fighter_stats(combat::new_sheet(0, 0, 0, 0, 0, 0, 0, 0, 1), 100, 1, 0, shift, shift, shift, shift);
  let snapshot = combat::new_mob_snapshot(b"reward_mob".to_string(), 1, vector[], 100,
    vector[mob_data::new_loot_entry(b"reward".to_string(), 10000, 2, 2)]);
  let mob = combat::cap_fighter_hp(combat::new_mob_fighter(1, target, stats, snapshot), 50);
  let mut state = combat::new_state(board, vector[player(0, player_cell), mob], 1);
  assert!(combat::has_mobs(&state) && combat::player_count(&state, 1) == 0, 0);
  assert!(combat::ready(&mut state, 0), 1);
  let _ = combat::start(&mut state, vector[1, 2, 3], 1);
  combat::cast(&mut state, 0, &lethal(), b"Lethal".to_string(), target, 1);
  let (won, survived, hp, xp) = combat::settlement_values(&state, 0);
  assert!(won && survived && hp == 100 && xp == 100, 2);
  assert!(combat::loot_random_draw_count(&state, 0) == 2, 3);
  assert!(combat::roll_and_split_drops(&mut state, 0, vector[0, 0]) == vector[0], 4);
  let drops = combat::fighter_drops(&state, 0);
  assert!(drops.length() == 1 && combat::drop_quantity(&drops[0]) == 2, 5);
  assert!(combat::drop_item_type(&drops[0]) == b"reward".to_string(), 6);
  assert!(combat::first_drop_type(&state, 0) == b"reward".to_string(), 7);
  assert!(combat::take_matching_drops(&mut state, 0, &b"reward".to_string()) == 2, 8);
  assert!(combat::take_matching_drops(&mut state, 0, &b"reward".to_string()) == 0, 9);
  combat::mark_settled(&mut state, 0);
  assert!(combat::roll_and_split_drops(&mut state, 0, vector[]).is_empty(), 10);
  combat::assert_closable(&state);
  combat::destroy(state);
}

#[test]
#[expected_failure(abort_code = 1706, location = aresrpg_combat::combat)]
fun placement_rejects_actions_before_start() {
  let mut state = placement();
  combat::cast(&mut state, 0, &lethal(), b"Lethal".to_string(), 200, 1);
  combat::destroy(state);
}

#[test]
#[expected_failure(abort_code = 1709, location = aresrpg_combat::combat)]
fun placement_refuses_an_occupied_start() {
  let mut state = placement();
  combat::place(&mut state, 0, 100);
  combat::destroy(state);
}

#[test]
#[expected_failure(abort_code = 1710, location = aresrpg_combat::combat)]
fun active_fights_cannot_settle() {
  let state = active();
  let (_, _, _, _) = combat::settlement_values(&state, 0);
  combat::destroy(state);
}

#[test]
#[expected_failure(abort_code = 1711, location = aresrpg_combat::combat)]
fun a_settled_loser_cannot_settle_twice() {
  let mut state = active();
  combat::forfeit(&mut state, 1);
  let (_, _, _, _) = combat::settlement_values(&state, 1);
  combat::destroy(state);
}

#[test]
#[expected_failure(abort_code = 1712, location = aresrpg_combat::combat)]
fun unsettled_winners_keep_the_fight_open() {
  let mut state = active();
  combat::forfeit(&mut state, 1);
  combat::assert_closable(&state);
  combat::destroy(state);
}

#[test]
#[expected_failure(abort_code = 1729, location = aresrpg_combat::combat)]
fun last_settlement_must_include_every_remaining_player() {
  let mut state = active();
  combat::cast(&mut state, 0, &lethal(), b"Lethal".to_string(), 200, 1);
  combat::assert_last_settlers(&state, &vector[0]);
  combat::destroy(state);
}

#[test]
fun mixed_level_rewards_exclude_forfeits_and_keep_failed_drops_absent() {
  let board = combat_grid::generate(1, 0);
  let shift = item_stats::shift() as u64;
  let stats = combat::new_fighter_stats(combat::new_sheet(0, 0, 0, 0, 0, 0, 0, 0, 5), 100, 1, 0,
    shift, shift, shift, shift);
  let mob_a = combat::new_mob_fighter(1, board.start_cells_b()[0], stats,
    combat::new_mob_snapshot(b"reward_a".to_string(), 5, vector[], 100,
      vector[mob_data::new_loot_entry(b"reward".to_string(), 10000, 2, 2)]));
  let mob_b = combat::new_mob_fighter(1, board.start_cells_b()[1], stats,
    combat::new_mob_snapshot(b"reward_b".to_string(), 5, vector[], 100,
      vector[mob_data::new_loot_entry(b"missing".to_string(), 1, 1, 1)]));
  let mut state = combat::new_state(board, vector[
    reward_player(10, board.start_cells_a()[0]), reward_player(1, board.start_cells_a()[1]),
    reward_player(1, board.start_cells_a()[2]), mob_a, mob_b,
  ], 1);
  combat::forfeit(&mut state, 2);
  let _ = combat::ready(&mut state, 0);
  let _ = combat::ready(&mut state, 1);
  let _ = combat::start(&mut state, vector[1, 2, 3], 1);
  let attack = spell_effect::new_spell_level(1, 0, 40, false, false, false, false, 0, 0, 0, 0,
    vector[spell_effect::new_effect(0, b"earth".to_string(), 100, 100, spell_effect::shape_allmap(), 0, 1, 10000, 0, 0)], vector[]);
  combat::cast(&mut state, 0, &attack, b"Victory".to_string(), board.start_cells_b()[0], 1);
  let (_, _, _, leader_xp) = combat::settlement_values(&state, 0);
  let (_, _, _, follower_xp) = combat::settlement_values(&state, 1);
  assert!(leader_xp == 181 && follower_xp == 18, 0);
  assert!(combat::winners_remaining(&state) == 2, 1);
  assert!(combat::roll_and_split_drops(&mut state, 0, vector[0, 0, 9999, 0]) == vector[0, 1], 2);
  assert!(combat::fighter_drops(&state, 0).length() == 1 && combat::fighter_drops(&state, 1).is_empty(), 3);
  assert!(combat::take_matching_drops(&mut state, 0, &b"reward".to_string()) == 2, 4);
  assert!(combat::fighter_drops(&state, 2).is_empty(), 5);
  combat::destroy(state);
}

fun reward_player(level: u64, cell: u64): combat::Fighter {
  combat::new_player_fighter(0, cell, 100,
    combat::player_fighter_stats(0, 0, 600, 0, 0, level, 100, &item_stats::zero()))
}
