/// MOB AI TESTS — coverage for the spawn-derivation math (`scaled_hp`, `seeded_spawn_cell`, `draw_spawn_cell`)
/// and the total-idle fallback path. `nearest_target` is PRIVATE with no public wrapper — covered TRANSITIVELY:
/// `decide_turn` calls it only on the fully-stuck path (no viable attack/heal AND zero reposition budget), which
/// the last test below forces (empty spell kit + mp=0).
#[test_only]
module aresrpg_foundation::mob_ai_tests;

use aresrpg_foundation::mob_ai;
use aresrpg_foundation::combat_grid;
use aresrpg_foundation::prng;
use aresrpg_foundation::spell_effect::SpellLevel;

#[test]
fun t_scaled_hp_scaling_and_degenerate_range() {
  // base=100, min=10, max=20: 0.7x floor at level==min, 1.4x ceiling at level==max, midpoint in between.
  assert!(mob_ai::scaled_hp(100, 10, 20, 10) == 70, 0);
  assert!(mob_ai::scaled_hp(100, 10, 20, 15) == 105, 1);
  assert!(mob_ai::scaled_hp(100, 10, 20, 20) == 140, 2);
  assert!(mob_ai::scaled_hp(100, 10, 10, 15) == 100, 3); // degenerate range (max==min) -> base verbatim
}

#[test]
fun t_seeded_and_draw_spawn_cell_skip_blocked() {
  let mask = combat_grid::rect_mask(3, 1); // 3 cells: encode(0,0), encode(1,0), encode(2,0)
  let obstacles = vector[combat_grid::encode(0, 0)];
  let holes: vector<u64> = vector[];
  let starts: vector<u64> = vector[];

  // seeded_spawn_cell: state-threaded variant — never lands on the obstacle cell.
  let (cell, _state) = mob_ai::seeded_spawn_cell(&mask, &obstacles, &holes, &starts, prng::rng_seed(1));
  assert!(cell != combat_grid::encode(0, 0), 0);
  assert!(cell == combat_grid::encode(1, 0) || cell == combat_grid::encode(2, 0), 1);

  // draw_spawn_cell: the &mut u64 draw-chain twin, same skip behavior.
  let mut rng = prng::rng_seed(1);
  let cell2 = mob_ai::draw_spawn_cell(&mask, &obstacles, &holes, &starts, &mut rng);
  assert!(cell2 != combat_grid::encode(0, 0), 2);
  assert!(cell2 == combat_grid::encode(1, 0) || cell2 == combat_grid::encode(2, 0), 3);
}

#[test]
fun t_decide_turn_falls_back_to_idle_nearest_when_totally_stuck() {
  let mob = combat_grid::encode(5, 5);
  let near = combat_grid::encode(7, 7); // manhattan 4
  let far = combat_grid::encode(1, 1); // manhattan 8
  let targets = vector[near, far];
  let empty: vector<u64> = vector[];
  let no_spells: vector<SpellLevel> = vector[];
  let ww = mob_ai::new_weights(120, 80, 120, 40);
  let mut rng = prng::rng_seed(1);
  // ap=0, mp=0: no spell exists to cast and zero move budget -> total idle fallback (nearest_target).
  let (c, sp, tgt) = mob_ai::decide_turn(mob, 0, 0, &no_spells, &targets, &empty, &empty, &empty, &empty, 0, &ww, &mut rng);
  assert!(c == mob, 0); // idle in place
  assert!(sp.is_none(), 1); // no cast
  assert!(tgt == near, 2); // nearest_target picks the closer of the two
}
