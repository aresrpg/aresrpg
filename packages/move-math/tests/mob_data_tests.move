// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

#[test_only]
module aresrpg_math::mob_data_tests;

use aresrpg_math::{mob_data, spell_effect};

fun mob(low: u8, high: u8, element: std::string::String, spells: vector<mob_data::MobSpell>, loot: vector<mob_data::LootEntry>): mob_data::MobData {
  mob_data::new_mob_data(b"Tofu".to_string(), b"tofu".to_string(), element,
    low, high, 120, 6, 4, 15, 25, 32769, 32766, 32771, 32764, spells, loot, 55, false)
}

fun spell(cost: u8): mob_data::MobSpell {
  let row = spell_effect::new_effect(0, b"earth".to_string(), 2, 5, 0, 0, 1, 10_000, 0, 0);
  mob_data::new_mob_spell(b"Peck".to_string(), spell_effect::new_spell_level(cost, 1, 2, false, true, false, false, 0, 0, 0, 20, vector[row], vector[row, row]))
}

#[test]
fun mob_template_preserves_fight_and_reward_inputs() {
  let peck = spell(2);
  let loot = mob_data::new_loot_entry(b"feather".to_string(), 2500, 2, 4);
  let data = mob(1, 10, b"air".to_string(), vector[peck, spell(3)], vector[loot]);
  assert!(mob_data::name(&data) == b"Tofu".to_string() && mob_data::mob_type(&data) == b"tofu".to_string(), 1);
  assert!(mob_data::element(&data) == b"air".to_string(), 2);
  assert!(mob_data::level_min(&data) == 1 && mob_data::level_max(&data) == 10, 3);
  assert!(mob_data::hp(&data) == 120 && mob_data::ap(&data) == 6 && mob_data::mp(&data) == 4, 4);
  assert!(mob_data::agility(&data) == 15 && mob_data::wisdom(&data) == 25, 5);
  assert!(mob_data::earth_resistance(&data) == 32769 && mob_data::fire_resistance(&data) == 32766, 6);
  assert!(mob_data::water_resistance(&data) == 32771 && mob_data::air_resistance(&data) == 32764, 7);
  assert!(mob_data::xp(&data) == 55 && !mob_data::is_boss(&data), 8);
  let spells = mob_data::spells(&data);
  assert!(spells.length() == 2 && mob_data::spell_name(&spells[0]) == b"Peck".to_string(), 9);
  assert!(mob_data::spell_level(&spells[0]) == mob_data::spell_level(&peck), 10);
  assert!(mob_data::loot(&data) == vector[loot], 11);
  assert!(mob_data::loot_item_type(&loot) == b"feather".to_string(), 12);
  assert!(mob_data::loot_chance_bp(&loot) == 2500, 13);
  assert!(mob_data::loot_min_qty(&loot) == 2 && mob_data::loot_max_qty(&loot) == 4, 14);
  let unarmed = mob(1, 1, b"earth".to_string(), vector[], vector[]);
  assert!(mob_data::spells(&unarmed).is_empty() && mob_data::loot(&unarmed).is_empty(), 15);
}

#[test]
fun normal_branch_work_and_cheapest_spell_bound_the_whole_kit() {
  let row = spell_effect::new_effect(0, b"earth".to_string(), 2, 5, 0, 0, 1, 10_000, 0, 0);
  let normal_heavy = mob_data::new_mob_spell(b"Wide".to_string(), spell_effect::new_spell_level(
    6, 1, 2, false, true, false, false, 0, 0, 0, 20, vector[row, row, row], vector[row],
  ));
  let data = mob(1, 10, b"earth".to_string(), vector[normal_heavy, spell(2)], vector[]);
  assert!(mob_data::spells(&data).length() == 2, 0);
}

#[test, expected_failure(abort_code = 1201, location = aresrpg_math::mob_data)]
fun inverted_level_band_is_refused() { mob(10, 1, b"earth".to_string(), vector[], vector[]); }

#[test, expected_failure(abort_code = 1202, location = aresrpg_math::mob_data)]
fun more_than_five_spells_is_refused() {
  let row = spell(6);
  mob(1, 1, b"earth".to_string(), vector[row, row, row, row, row, row], vector[]);
}

#[test, expected_failure(abort_code = 1203, location = aresrpg_math::mob_data)]
fun more_than_sixteen_loot_rows_is_refused() {
  let mut loot = vector[];
  while (loot.length() < 17) loot.push_back(mob_data::new_loot_entry(b"feather".to_string(), 1, 1, 1));
  mob(1, 1, b"earth".to_string(), vector[], loot);
}

#[test, expected_failure(abort_code = 1204, location = aresrpg_math::mob_data)]
fun unknown_mob_element_is_refused() { mob(1, 1, b"ice".to_string(), vector[], vector[]); }

#[test, expected_failure(abort_code = 1205, location = aresrpg_math::mob_data)]
fun loot_probability_cannot_exceed_one_hundred_percent() { mob_data::new_loot_entry(b"feather".to_string(), 10_001, 1, 1); }

#[test, expected_failure(abort_code = 1206, location = aresrpg_math::mob_data)]
fun inverted_loot_quantity_is_refused() { mob_data::new_loot_entry(b"feather".to_string(), 1, 2, 1); }

#[test]
#[expected_failure(abort_code = 1206, location = aresrpg_math::mob_data)]
fun a_loot_hit_can_never_roll_zero_items() {
  mob_data::new_loot_entry(b"fang".to_string(), 5_000, 0, 1);
  abort 999
}

#[test]
#[expected_failure(abort_code = 1207, location = aresrpg_math::mob_data)]
fun a_mob_kit_rejects_more_than_ten_conservative_row_casts() {
  let row = spell_effect::new_effect(
    0, b"earth".to_string(), 1, 1, spell_effect::shape_allmap(), 0, 1, 10_000, 0, 0,
  );
  let level = spell_effect::new_spell_level(
    2, 0, 1, false, false, false, false, 0, 0, 0, 0,
    vector[row, row, row, row],
    vector[],
  );
  mob_data::new_mob_data(
    b"Overworker".to_string(), b"overworker".to_string(), b"earth".to_string(),
    1, 1, 100, 6, 3, 0, 0, 32768, 32768, 32768, 32768,
    vector[mob_data::new_mob_spell(b"Too much".to_string(), level)],
    vector[],
    1,
   false);
}
