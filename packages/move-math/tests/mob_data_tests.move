// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

#[test_only]
module aresrpg_math::mob_data_tests;

use aresrpg_math::mob_data;

#[test]
#[expected_failure(abort_code = 1206, location = aresrpg_math::mob_data)]
fun a_loot_hit_can_never_roll_zero_items() {
  mob_data::new_loot_entry(b"fang".to_string(), 5_000, 0, 1);
  abort 999
}
