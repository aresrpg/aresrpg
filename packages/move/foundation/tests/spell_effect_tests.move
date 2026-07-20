/// SPELL EFFECT TESTS — coverage for the getters/constructors/setters not exercised by the source-file inline
/// tests: kind/point/flag/stat-id constant getters, the movement and common combat convenience
/// constructors + the raw `flags()` field accessor, and the `SpellLevel` state getters + live-tune setters.
#[test_only]
module aresrpg_foundation::spell_effect_tests;

use aresrpg_foundation::spell_effect as eff;
use aresrpg_foundation::spell;

#[test]
fun t_kind_point_stat_id_constant_getters() {
  // kind discriminants not touched by the source inline tests.
  assert!(eff::k_carry() == 16, 0);
  assert!(eff::k_dispel() == 26, 1);
  // Shared statuses vector: numeric_invisibility_and_reveal_normalize.
  assert!(eff::k_invisibility() == 27, 25);
  assert!(eff::k_reveal() == 28, 26);
  assert!(eff::k_give_points() == 6, 2);
  assert!(eff::k_geometric_push() == 30, 24);
  assert!(eff::k_remove_state() == 23, 3);
  assert!(eff::k_reset_positions() == 18, 4);
  assert!(eff::k_steal_stat() == 10, 5);
  assert!(eff::k_swap_positions() == 15, 6);
  assert!(eff::k_teleport() == 14, 7);
  assert!(eff::k_throw() == 17, 8);
  // point kinds
  assert!(eff::point_ap() == 0, 9);
  assert!(eff::point_mp() == 1, 10);
  // AlterStat/StealStat stat ids
  assert!(eff::stat_agility() == 3, 11);
  assert!(eff::stat_chance() == 2, 12);
  assert!(eff::stat_crit() == 7, 13);
  assert!(eff::stat_heal() == 11, 14);
  assert!(eff::stat_intelligence() == 1, 15);
  assert!(eff::stat_max_hp() == 10, 16);
  assert!(eff::stat_percent_damage() == 8, 17);
  assert!(eff::stat_range() == 6, 18);
  assert!(eff::stat_raw_damage() == 9, 19);
  assert!(eff::stat_vitality() == 5, 20);
  assert!(eff::stat_wisdom() == 4, 21);
  // flag bits
  assert!(eff::flag_life_lost() == 16, 22);
  assert!(eff::flag_percent() == 2, 23);
}

#[test]
fun t_convenience_constructors_and_flags_getter() {
  let gp = eff::give_points(eff::point_mp(), 2);
  assert!(eff::kind(&gp) == eff::k_give_points(), 0);
  assert!(eff::stat(&gp) == eff::point_mp(), 1);
  assert!(eff::value(&gp) == 2, 2);
  assert!(eff::target_filter(&gp) == eff::tf_not_enemy(), 3);

  let ls = eff::life_steal(spell::el_fire(), 12);
  assert!(eff::kind(&ls) == eff::k_life_steal(), 4);
  assert!(eff::value(&ls) == 12, 5);
  assert!(eff::target_filter(&ls) == eff::tf_not_team(), 6);

  let pl = eff::pull(3);
  assert!(eff::kind(&pl) == eff::k_pull(), 7);
  assert!(eff::value(&pl) == 3, 8);

  let ps = eff::push(4);
  assert!(eff::kind(&ps) == eff::k_push(), 9);
  assert!(eff::value(&ps) == 4, 10);

  let geometric = eff::geometric_push(eff::shape_cross(), 3);
  assert!(eff::kind(&geometric) == eff::k_geometric_push(), 12);
  assert!(eff::value(&geometric) == 0, 13);
  assert!(eff::area_shape(&geometric) == eff::shape_cross(), 14);
  assert!(eff::area_size(&geometric) == 3, 15);
  assert!(eff::target_filter(&geometric) == eff::tf_none(), 16);
  assert!(eff::is_legal(&geometric), 17);

  // raw `flags()` field accessor (has_flag is already covered; this hits the bare getter).
  let dodgeable = eff::remove_points(eff::point_ap(), 1, true);
  assert!(eff::flags(&dodgeable) == eff::flag_dodge(), 11);
}

#[test]
fun t_spell_level_getters_and_setters() {
  let mut s = eff::new_spell_level(
    1, 4, 1, 4, false, false, true, false, 1, 1, 0, 50, true,
    vector[10, 11], vector[20],
    vector[eff::damage(spell::el_fire(), 5)], vector[],
  );
  assert!(eff::sl_ends_turn_on_fail(&s), 0);
  assert!(*eff::sl_required_states(&s) == vector[10, 11], 1);
  assert!(*eff::sl_forbidden_states(&s) == vector[20], 2);

  eff::set_ap_cost(&mut s, 7);
  assert!(eff::sl_ap_cost(&s) == 7, 3);

  eff::set_range(&mut s, 2, 6, true);
  assert!(eff::sl_range_min(&s) == 2, 4);
  assert!(eff::sl_range_max(&s) == 6, 5);
  assert!(eff::sl_modifiable_range(&s), 6);

  eff::set_limits(&mut s, 3, 2, 1, 80);
  assert!(eff::sl_casts_per_turn(&s) == 3, 7);
  assert!(eff::sl_casts_per_target(&s) == 2, 8);
  assert!(eff::sl_cooldown_turns(&s) == 1, 9);
  assert!(eff::sl_crit_rate(&s) == 80, 10);

  eff::set_effects(&mut s, vector[eff::heal(9)], vector[eff::heal(20)]);
  assert!(eff::sl_effects(&s).length() == 1, 11);
  let crits = eff::sl_crit_effects(&s);
  assert!(eff::value(crits.borrow(0)) == 20, 12);
}

#[test]
/// The point-drain doctrine ROWS — the inert bookkeeping the spell_board debt/credit folds read: `drain_row` is a
/// k_remove_points row carrying the POST-DODGE removed count in `value` (TF_NONE, un-flagged so it never
/// re-applies dodge), and `credit_row` is its k_give_points twin carrying the given count.
fun t_drain_and_credit_rows() {
  let dr = eff::drain_row(eff::point_ap(), 3, 2);
  assert!(eff::kind(&dr) == eff::k_remove_points(), 0);
  assert!(eff::stat(&dr) == eff::point_ap(), 1);
  assert!(eff::value(&dr) == 3, 2); // the actual removed count (never the requested)
  assert!(eff::turns(&dr) == 2, 3);
  assert!(eff::target_filter(&dr) == eff::tf_none(), 4); // inert — not a re-application
  assert!(eff::flags(&dr) == 0, 5); // NOT dodgeable (already post-dodge)

  let cr = eff::credit_row(eff::point_mp(), 4, 1);
  assert!(eff::kind(&cr) == eff::k_give_points(), 6);
  assert!(eff::stat(&cr) == eff::point_mp(), 7);
  assert!(eff::value(&cr) == 4, 8); // the given count
  assert!(eff::turns(&cr) == 1, 9);
  assert!(eff::target_filter(&cr) == eff::tf_none(), 10);
}
