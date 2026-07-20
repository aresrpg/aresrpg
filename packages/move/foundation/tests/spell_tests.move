/// SPELL MODULE TESTS — coverage for the `Stats` §5h-fidelity/D172 gear-fold surface not exercised by the
/// source-file inline damage/heal/crit pipeline tests: the extension-field getters on a zero block, the
/// `set_ext_gear` writer, `stats_add`/`stats_sub` (the equip fold-in/fold-out), and `sub_stat`/`sub_resist`.
/// `sat_sub`/`stats_sub_floor` are PRIVATE (module-internal saturating subtract helpers) — covered transitively:
/// `sub_stat`/`sub_resist` call `sat_sub`; `stats_sub` calls `stats_sub_floor`.
#[test_only]
module aresrpg_foundation::spell_tests;

use aresrpg_foundation::spell;

#[test]
fun t_el_water() {
  assert!(spell::el_water() == 1, 0);
}

#[test]
fun t_stats_zero_getters_including_ext_fields() {
  let z = spell::stats_zero();
  assert!(spell::stat_agility(&z) == 0, 0);
  assert!(spell::stat_air_resistance(&z) == 0, 1);
  assert!(spell::stat_ap_dodge(&z) == 0, 2);
  assert!(spell::stat_chance(&z) == 0, 3);
  assert!(spell::stat_critical_hit(&z) == 0, 4);
  assert!(spell::stat_earth_resistance(&z) == 0, 5);
  assert!(spell::stat_fire_resistance(&z) == 0, 6);
  assert!(spell::stat_flat_resist(&z) == 0, 7);
  assert!(spell::stat_mp_dodge(&z) == 0, 8);
  assert!(spell::stat_neutral_resistance(&z) == 0, 9);
  assert!(spell::stat_range(&z) == 0, 10);
  assert!(spell::stat_vitality(&z) == 0, 11);
  assert!(spell::stat_water_resistance(&z) == 0, 12);
  assert!(spell::stat_wisdom(&z) == 0, 13);
}

#[test]
fun t_set_ext_gear_and_stats_add_fold_in() {
  let mut a = spell::new_stats(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11);
  spell::set_ext_gear(&mut a, 12, 13, 14, 15); // wisdom, ap_bonus, mp_bonus, vitality
  let mut b = spell::new_stats(1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1);
  spell::set_ext_gear(&mut b, 1, 1, 1, 1);
  let sum = spell::stats_add(&a, &b);
  assert!(spell::stat_strength(&sum) == 2, 0);
  assert!(spell::stat_air_resistance(&sum) == 12, 1); // 11 + 1
  assert!(spell::stat_wisdom(&sum) == 13, 2); // 12 + 1
  assert!(spell::stat_ap_bonus(&sum) == 14, 3); // 13 + 1
  assert!(spell::stat_mp_bonus(&sum) == 15, 4); // 14 + 1
  assert!(spell::stat_vitality(&sum) == 16, 5); // 15 + 1
}

#[test]
fun t_stats_sub_sub_stat_sub_resist_floor_at_zero() {
  // stats_add/stats_sub round-trip: subtracting the same block back to zero (stats_sub_floor's normal branch).
  let mut a = spell::new_stats(5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5);
  spell::set_ext_gear(&mut a, 5, 5, 5, 5);
  let mut b = spell::new_stats(2, 10, 2, 2, 2, 2, 2, 2, 2, 2, 2); // intelligence 10 > a's 5
  spell::set_ext_gear(&mut b, 2, 2, 2, 2);
  let diff = spell::stats_sub(&a, &b);
  assert!(spell::stat_strength(&diff) == 3, 0); // 5 - 2

  // sub_stat direct — normal subtract then floor-at-zero (exercises sat_sub both branches).
  let mut c = spell::new_stats(5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5);
  spell::sub_stat(&mut c, 0, 2); // strength 5 - 2 = 3
  assert!(spell::stat_strength(&c) == 3, 1);
  spell::sub_stat(&mut c, 1, 10); // intelligence 5 - 10 floors to 0
  assert!(spell::stat_intelligence(&c) == 0, 2);

  // sub_resist direct — same saturating shape, element-keyed.
  let mut d = spell::new_stats(0, 0, 0, 0, 0, 0, 0, 5, 5, 5, 5);
  spell::sub_resist(&mut d, spell::el_fire(), 2);
  assert!(spell::stat_fire_resistance(&d) == 3, 3);
  spell::sub_resist(&mut d, spell::el_water(), 10); // floors to 0
  assert!(spell::stat_water_resistance(&d) == 0, 4);
}
