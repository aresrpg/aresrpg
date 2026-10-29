// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
#[test_only]
module aresrpg_combat::periodic_effect_tests;

use aresrpg_combat::combat;
use aresrpg_math::{combat_grid, item_stats, spell_effect};

public(package) fun active(): combat::State {
  let board = combat_grid::grid_spec(20, 19,
    vector[0xFFFFFFFFFFFFFFFF, 0xFFFFFFFFFFFFFFFF, 0xFFFFFFFFFFFFFFFF, 0xFFFFFFFFFFFFFFFF, 0xFFFFFFFFFFFFFFFF, 0x0FFFFFFFFFFFFFFF],
    vector[], vector[], vector[100, 101, 102, 103, 104, 105], vector[200, 201, 202, 203, 204, 205]);
  let stats = combat::player_fighter_stats(0, 0, 0, 0, 0, 200, 1000, &item_stats::zero());
  let mut state = combat::new_state(board, vector[
    combat::new_player_fighter(0, 100, 100, stats),
    combat::new_player_fighter(0, 101, 100, stats),
    combat::new_player_fighter(1, 200, 1000, stats),
  ], 1);
  let _ = combat::ready(&mut state, 0);
  let _ = combat::ready(&mut state, 1);
  let _ = combat::ready(&mut state, 2);
  let _ = combat::start(&mut state, vector[7, 8, 9], 1);
  state
}

public(package) fun next_round(state: &mut combat::State, round: u64) {
  let mut turn = 0;
  while (turn < 3) {
    let _ = combat::end_turn(state, vector[2, 3, 4], round * 9000 + turn * 3000 + 3001);
    turn = turn + 1;
  };
}

#[test]
fun all_or_nothing_heals_its_caster_and_ally_twice() {
  let mut state = active();
  // Authored level-one All or Nothing: enemy poison and allied regeneration, both two turns.
  let spell = spell_effect::new_spell_level(6, 0, 0, false, false, false, false, 0, 0, 4, 50, vector[
    spell_effect::new_effect(5, b"earth".to_string(), 2, 7, 1, 8, 1, 10000, 2, 12),
    spell_effect::new_effect(4, b"".to_string(), 11, 20, 1, 8, 3, 10000, 2, 12),
  ], vector[
    spell_effect::new_effect(5, b"earth".to_string(), 3, 14, 1, 8, 1, 10000, 2, 12),
    spell_effect::new_effect(4, b"".to_string(), 21, 40, 1, 8, 3, 10000, 2, 12),
  ]);
  combat::cast(&mut state, 0, &spell, b"All or Nothing".to_string(), 100, 1);
  assert!(combat::fighter_hp(&state, 0) == 100 && combat::fighter_hp(&state, 1) == 100, 0);
  next_round(&mut state, 0);
  let first_caster = combat::fighter_hp(&state, 0);
  let first_ally = combat::fighter_hp(&state, 1);
  let first_enemy = combat::fighter_hp(&state, 2);
  assert!(first_caster > 100 && first_ally > 100 && first_enemy < 1000, 1);
  next_round(&mut state, 1);
  assert!(combat::fighter_hp(&state, 0) == 100 + 2 * (first_caster - 100), 2);
  assert!(combat::fighter_hp(&state, 1) == 100 + 2 * (first_ally - 100), 3);
  assert!(combat::fighter_hp(&state, 2) == 1000 - 2 * (1000 - first_enemy), 4);
  next_round(&mut state, 2);
  assert!(combat::fighter_hp(&state, 0) == 100 + 2 * (first_caster - 100), 5);
  assert!(combat::fighter_resources_for_testing(&state, 0)[3] == 0, 6);
  combat::destroy(state);
}

#[test]
fun periodic_hp_counts_ticks_for_active_and_inactive_recipients() {
  vector[4, 5, 6].do!(|kind| {
    vector[1, 2, 3].do!(|turns| {
      let mut state = active();
      let element = if (kind == 4) b"" else b"earth";
      let spell = spell_effect::new_spell_level(1, 0, 0, false, false, false, false, 0, 0, 0, 0, vector[
        spell_effect::new_effect(kind, element.to_string(), 7, 7, 1, 8, 3, 10000, turns, 12),
      ], vector[]);
      combat::cast(&mut state, 0, &spell, b"Periodic".to_string(), 100, 1);
      let mut round = 0;
      while (round <= (turns as u64)) {
        next_round(&mut state, round);
        let ticks = if (round < (turns as u64)) round + 1 else turns as u64;
        let expected = if (kind == 4) 100 + 7 * ticks else 100 - 7 * ticks;
        assert!(combat::fighter_hp(&state, 0) == expected, 0);
        assert!(combat::fighter_hp(&state, 1) == expected, 1);
        round = round + 1;
      };
      combat::destroy(state);
    });
  });
}
