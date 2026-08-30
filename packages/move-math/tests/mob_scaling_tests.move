// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

#[test_only]
module aresrpg_math::mob_scaling_tests;

use aresrpg_math::{mob_data, mob_scaling, spell_effect};

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
