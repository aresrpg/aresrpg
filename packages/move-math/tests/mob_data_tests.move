// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

#[test_only]
module aresrpg_math::mob_data_tests;

use aresrpg_math::{mob_data, spell_effect};

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
  );
}
