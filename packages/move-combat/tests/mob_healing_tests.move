// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
#[test_only]
module aresrpg_combat::mob_healing_tests;
use aresrpg_combat::combat;
use aresrpg_math::{combat_grid, item_stats, spell_effect};

fun mob(cell: u64, hp: u64, kit: vector<combat::KitSpell>): combat::Fighter {
  let shift = item_stats::shift() as u64;
  let stats = combat::new_fighter_stats(combat::new_sheet(0, 0, 0, 0, 0, 0, 0, 0, 1), 100, 2, 0,
    shift, shift, shift, shift);
  combat::cap_fighter_hp(combat::new_mob_fighter(1, cell, stats,
    combat::new_mob_snapshot(b"healer".to_string(), 1, kit, 0, vector[])), hp)
}

fun healed(mob_hp: u64, ally_hp: u64): vector<u64> {
  let board = combat_grid::generate(1, 0);
  let stats = combat::player_fighter_stats(0, 0, 0, 0, 0, 1, 100, &item_stats::zero());
  let heal = spell_effect::new_effect(4, b"".to_string(), 10, 10, 0, 0, 3, 10000, 0, 12);
  let level = spell_effect::new_spell_level(2, 0, 40, false, false, false, false, 0, 0, 0, 0, vector[heal], vector[]);
  let kit = vector[combat::new_kit_spell(b"Heal".to_string(), 1, level)];
  let mut state = combat::new_state(board, vector[
    combat::new_player_fighter(0, board.start_cells_a()[0], 100, stats),
    mob(board.start_cells_b()[0], mob_hp, kit), mob(board.start_cells_b()[1], ally_hp, vector[]),
  ], 1);
  assert!(combat::ready(&mut state, 0), 0);
  let _ = combat::start(&mut state, vector[1, 2, 3], 1);
  let used = combat::end_turn(&mut state, vector[7, 8, 9], 3001);
  assert!(used.length() == 2 && combat::turn_seed_fighter(&used[0]) == 1, 1);
  assert!(combat::turn_seed_value(&used[0]) == 7 && combat::turn_seed_value(&used[1]) == 8, 2);
  let result = vector[combat::fighter_hp(&state, 1), combat::fighter_hp(&state, 2)];
  combat::destroy(state);
  result
}

#[test]
fun healing_selects_the_most_wounded_living_ally() {
  assert!(healed(100, 20) == vector[100, 30], 0);
  assert!(healed(10, 20) == vector[20, 20], 1);
  assert!(healed(100, 100) == vector[100, 100], 2);
}

fun skips_invalid_placement(critical: bool) {
  let board = combat_grid::generate(1, 0);
  let stats = combat::player_fighter_stats(0, 0, 0, 0, 0, 1, 100, &item_stats::zero());
  let hit = spell_effect::new_effect(0, b"earth".to_string(), 1, 1, 0, 0, 1, 10000, 0, 0);
  let trap = spell_effect::new_effect(12, b"".to_string(), 0, 0, 0, 0, 0, 10000, 0, 0);
  let invalid = spell_effect::new_spell_level(2, 0, 40, false, false, false, false, 0, 0, 0,
    if (critical) 2 else 0, if (critical) vector[hit] else vector[trap, hit],
    if (critical) vector[trap, hit] else vector[]);
  let fallback = spell_effect::new_spell_level(2, 0, 40, false, false, false, false, 0, 0, 0, 0, vector[hit], vector[]);
  let kit = vector[combat::new_kit_spell(b"Occupied Trap".to_string(), 1, invalid),
    combat::new_kit_spell(b"Fallback".to_string(), 1, fallback)];
  let mut state = combat::new_state(board, vector[
    combat::new_player_fighter(0, board.start_cells_a()[0], 100, stats),
    mob(board.start_cells_b()[0], 100, kit),
  ], 1);
  let _ = combat::ready(&mut state, 0);
  let _ = combat::start(&mut state, vector[1, 2, 3], 1);
  let _ = combat::end_turn(&mut state, vector[7, 8, 9], 3001);
  assert!(combat::fighter_hp(&state, 0) == 99, 0);
  combat::destroy(state);
}

#[test]
fun invalid_normal_and_critical_traps_do_not_strand_a_mob_turn() {
  skips_invalid_placement(false);
  skips_invalid_placement(true);
}
