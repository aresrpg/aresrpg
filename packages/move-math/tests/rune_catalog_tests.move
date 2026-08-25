// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
#[test_only]
module aresrpg_math::rune_catalog_tests;

use aresrpg_math::{forge, rune_catalog};

#[test]
fun retro_unit_weights_are_exact_in_the_shared_scaled_domain() {
  assert!(rune_catalog::weight_scale() == 20);
  assert!(rune_catalog::stat_unit_weight(0) == 5);    // Vitality 0.25
  assert!(rune_catalog::stat_unit_weight(1) == 60);   // Wisdom 3
  assert!(rune_catalog::stat_unit_weight(2) == 20);   // Strength 1
  assert!(rune_catalog::stat_unit_weight(6) == 1_020);// Range 51
  assert!(rune_catalog::stat_unit_weight(7) == 1_800);// MP 90
  assert!(rune_catalog::stat_unit_weight(8) == 2_000);// AP 100
  assert!(rune_catalog::stat_unit_weight(9) == 600);  // Critical 30
  assert!(rune_catalog::stat_unit_weight(10) == 400); // Damage 20
  assert!(rune_catalog::stat_unit_weight(11) == 80);  // Percentage resistance 4
  assert!(rune_catalog::rune_weight(0, rune_catalog::tier_ba()) == 20);  // Vi 1
  assert!(rune_catalog::rune_weight(0, rune_catalog::tier_pa()) == 60);  // Pa Vi 3
  assert!(rune_catalog::rune_weight(0, rune_catalog::tier_ra()) == 160); // Ra Vi 8
}

#[test]
fun overmage_caps_keep_the_retro_101_weight_limit() {
  assert!(forge::gain_capped(100, 500, 100, 0) == 504); // 101 / 0.25 = 404 over
  assert!(forge::gain_capped(10, 10, 10, 9) == 13);     // 101 / 30 = 3 over
  assert!(forge::gain_capped(10, 100, 10, 11) == 35);   // 101 / 4 = 25 over
}
