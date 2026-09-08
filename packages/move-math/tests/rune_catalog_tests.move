// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
#[test_only]
module aresrpg_math::rune_catalog_tests;

use aresrpg_math::{forge, item_stats, prng, rune_catalog};

#[test]
fun every_rune_has_one_canonical_identity_and_supported_tier_amount() {
  let names = vector[b"vitality", b"wisdom", b"strength", b"intelligence", b"chance", b"agility",
    b"range", b"movement", b"action", b"critical", b"raw_damage", b"earth_resistance", b"fire_resistance", b"water_resistance", b"air_resistance"];
  assert!(rune_catalog::stat_count() == 15, 0);
  let mut stat = 0u8;
  while ((stat as u64) < names.length()) {
    let major = stat >= 6 && stat <= 10;
    assert!(rune_catalog::max_tier(stat) == (if (major) 1 else 3), 2);
    assert!(rune_catalog::stat_unit_weight(stat) > 0, 3);
    assert!(!rune_catalog::has_rune(stat, 0) && !rune_catalog::has_rune(stat, 4), 4);
    let mut tier = 1u8;
    while (tier <= 3) {
      let exists = !major || tier == 1;
      assert!(rune_catalog::has_rune(stat, tier) == exists, 5);
      if (exists) {
        let amount = if (stat == 0) { if (tier == 1) 3 else if (tier == 2) 10 else 30 }
          else if (tier == 1) 1 else if (tier == 2) 3 else 10;
        assert!(rune_catalog::rune_amount(stat, tier) == amount, 6);
        let mut slug = b"rune_".to_string();
        slug.append(names[stat as u64].to_string());
        slug.append(if (tier == 1) b"_ba".to_string() else if (tier == 2) b"_pa".to_string() else b"_ra".to_string());
        assert!(rune_catalog::slug(stat, tier) == slug, 7);
      };
      tier = tier + 1;
    };
    stat = stat + 1;
  };
}

#[test, expected_failure(abort_code = 1, location = aresrpg_math::rune_catalog)]
fun a_stat_outside_the_block_has_no_weight() { rune_catalog::stat_unit_weight(15); }

#[test, expected_failure(abort_code = 1, location = aresrpg_math::rune_catalog)]
fun a_stat_outside_the_block_has_no_tier() { rune_catalog::max_tier(255); }

#[test, expected_failure(abort_code = 1, location = aresrpg_math::rune_catalog)]
fun a_stat_outside_the_block_cannot_be_scribed() { forge::can_apply_rune(&item_stats::zero(), &item_stats::zero(), 15, 1); }

#[test, expected_failure(abort_code = 2, location = aresrpg_math::rune_catalog)]
fun an_ap_rune_has_no_pa_tier() { rune_catalog::rune_amount(8, 2); }

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
  let center = item_stats::shift();
  let mut current = item_stats::zero().to_vector();
  let mut maximum = current;
  *maximum.borrow_mut(0) = center + 100;
  *current.borrow_mut(0) = center + 401;
  assert!(forge::can_apply_rune(&item_stats::from_vector(current), &item_stats::from_vector(maximum), 0, 1));
  *current.borrow_mut(0) = center + 402;
  assert!(!forge::can_apply_rune(&item_stats::from_vector(current), &item_stats::from_vector(maximum), 0, 1));
  *maximum.borrow_mut(9) = center + 10;
  *current.borrow_mut(0) = center;
  *current.borrow_mut(9) = center + 10;
  assert!(!forge::can_apply_rune(&item_stats::from_vector(current), &item_stats::from_vector(maximum), 9, 1));
  *maximum.borrow_mut(11) = center + 10;
  *current.borrow_mut(9) = center;
  *current.borrow_mut(11) = center + 25;
  assert!(!forge::can_apply_rune(&item_stats::from_vector(current), &item_stats::from_vector(maximum), 11, 1));

}

#[test]
fun a_neutral_success_reports_only_the_points_actually_added() {
  let center = item_stats::shift();
  let mut current = item_stats::zero().to_vector();
  let mut maximum = current;
  *current.borrow_mut(0) = center + 400;
  *maximum.borrow_mut(0) = center + 100;
  let mut seen = false;
  let mut seed = 0;
  while (seed < 32) {
    let mut rng = prng::rng_seed(seed);
    let result = forge::apply_rune(item_stats::from_vector(current), item_stats::zero(), item_stats::from_vector(maximum), 0, 1, 10, &mut rng);
    if (forge::outcome(&result) == forge::outcome_ns()) {
      seen = true;
      assert!(forge::new_stats(&result).vitality() == center + 401);
      assert!(forge::applied_value(&result) == 1);
      assert!(forge::new_puits(&result) == 0);
    };
    seed = seed + 1;
  };
  assert!(seen);
}
