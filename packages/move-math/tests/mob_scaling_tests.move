// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

#[test_only]
module aresrpg_math::mob_scaling_tests;

use aresrpg_math::{mob_data, mob_scaling, spell_effect};

#[test]
fun level_projection_scales_both_branches_and_preserves_cast_contract() {
  let damage = spell_effect::new_effect(0, b"fire".to_string(), 100, 200, spell_effect::shape_cross(), 2, 1, 7500, 0, 0);
  let push = spell_effect::new_effect(8, b"".to_string(), 2, 3, spell_effect::shape_line(), 3, 2, 5000, 0, 0);
  let authored = spell_effect::new_spell_level(4, 2, 7, true, false, true, false, 3, 2, 5, 20, vector[damage, push], vector[damage]);
  let scaled = mob_scaling::spell_level(&authored, 10, 20, 20);
  assert!(scaled.ap_cost() == 4 && scaled.range_min() == 2 && scaled.range_max() == 7, 1);
  assert!(scaled.modifiable_range() && !scaled.line_of_sight() && scaled.line_launch() && !scaled.free_cell(), 2);
  assert!(scaled.casts_per_turn() == 3 && scaled.casts_per_target() == 2 && scaled.cooldown_turns() == 5, 3);
  assert!(scaled.crit_1_in() == 20, 4);
  let base = scaled.effects();
  let critical = scaled.crit_effects();
  assert!(base.length() == 2 && critical.length() == 1, 5);
  assert!(base[0] == critical[0] && base[1] == push, 6);
  assert!(base[0].value() == 160 && base[0].value_max() == 320, 7);
  assert!(base[0].element() == b"fire".to_string(), 8);
  assert!(base[0].area_shape() == spell_effect::shape_cross() && base[0].area_size() == 2, 9);
  assert!(base[0].target_filter() == 1 && base[0].chance_bp() == 7500 && base[0].turns() == 0, 10);
  assert!(authored.effects()[0] == damage, 11);
}

#[test]
fun damage_reduction_and_reflection_scale_with_saturating_magnitudes() {
  let kinds = vector[14u8, 15];
  let mut index = 0;
  while (index < kinds.length()) {
    let row = spell_effect::new_effect(kinds[index], b"".to_string(), 0, 0xffff_ffff, 0, 0, 3, 10_000, 1, 0);
    let scaled = mob_scaling::effect(&row, 10, 20, 20);
    assert!(scaled.value() == 0 && scaled.value_max() == 0xffff_ffff, 1);
    assert!(scaled.turns() == 1 && scaled.kind() == kinds[index], 2);
    index = index + 1;
  };
  assert!(mob_scaling::loot(vector[], 10, 20, 15).is_empty(), 3);
}

#[test]
fun mob_numbers_scale_but_spell_geometry_does_not() {
  let damage = spell_effect::new_effect(
    0, b"earth".to_string(), 100, 120, spell_effect::shape_point(), 0, 1, 10_000, 0, 0,
  );
  let push = spell_effect::new_effect(
    8, b"".to_string(), 3, 3, spell_effect::shape_point(), 0, 1, 10_000, 0, 0,
  );
  let one_point_buff = spell_effect::new_effect(
    4, b"".to_string(), 1, 1, spell_effect::shape_circle(), 2, 3, 10_000, 2, 7,
  );
  let low = mob_scaling::effect(&damage, 10, 20, 10);
  let high = mob_scaling::effect(&damage, 10, 20, 20);
  let geometric = mob_scaling::effect(&push, 10, 20, 20);
  let scaled_buff = mob_scaling::effect(&one_point_buff, 10, 20, 10);
  assert!(low.value() == 60 && low.value_max() == 72);
  assert!(high.value() == 160 && high.value_max() == 192);
  assert!(geometric.value() == 3);
  assert!(scaled_buff.value() == 1 && scaled_buff.value_max() == 1);
}

#[test]
fun mob_loot_chance_uses_the_same_level_band() {
  let low = mob_scaling::loot(
    vector[mob_data::new_loot_entry(b"fang".to_string(), 5_000, 1, 2)],
    10,
    20,
    10,
  );
  let high = mob_scaling::loot(
    vector[mob_data::new_loot_entry(b"fang".to_string(), 5_000, 1, 2)],
    10,
    20,
    20,
  );
  assert!(mob_data::loot_chance_bp(&low[0]) == 4_000);
  assert!(mob_data::loot_chance_bp(&high[0]) == 6_000);
}
