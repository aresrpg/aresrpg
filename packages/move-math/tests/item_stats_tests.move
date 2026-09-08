// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
#[test_only]
module aresrpg_math::item_stats_tests;

use aresrpg_math::item_stats;

#[test]
fun authored_stat_columns_keep_their_identity_through_vector_storage() {
  let stats = item_stats::new(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15);
  assert!(stats.to_vector() == vector[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], 1);
  let restored = item_stats::from_vector(stats.to_vector());
  assert!(vector[
    restored.vitality(), restored.wisdom(), restored.strength(), restored.intelligence(),
    restored.chance(), restored.agility(), restored.range(), restored.movement(),
    restored.action(), restored.critical(), restored.raw_damage(), restored.earth_resistance(),
    restored.fire_resistance(), restored.water_resistance(), restored.air_resistance(),
  ] == stats.to_vector(), 2);
}

#[test]
fun equipment_fold_cancels_before_clamping_and_is_order_independent() {
  let positive = item_stats::new(65535, 65535, 32780, 32768, 32768, 32768, 32768, 32768, 32768, 32768, 32768, 32768, 32768, 32768, 32768);
  let negative = item_stats::new(0, 32767, 32748, 32768, 32768, 32768, 32768, 32768, 32768, 32768, 32768, 32768, 32768, 32768, 32768);
  let folded = item_stats::fold(&vector[positive, positive, negative]);
  assert!(folded.vitality() == 65534, 1);
  assert!(folded.wisdom() == 65535, 2);
  assert!(folded.strength() == 32772, 3);
  assert!(folded == item_stats::fold(&vector[negative, positive, positive]), 4);
  let penalties = item_stats::fold(&vector[negative, negative]);
  assert!(penalties.vitality() == 0 && penalties.strength() == 32728, 5);
  assert!(item_stats::fold(&vector[]) == item_stats::zero(), 6);
  assert!(item_stats::shift() == 32768, 7);
}

#[test]
fun crushing_raw_values_exclude_maluses_without_mutating_the_signed_block() {
  let current = item_stats::new(32765, 32768, 32778, 65535, 32768, 32768, 32768, 32768, 32768, 32768, 32768, 32768, 32768, 32768, 32768);
  assert!(current.to_raw() == vector[0, 0, 10, 32767, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 1);
  assert!(current.vitality() == 32765 && current.intelligence() == 65535, 2);
}

#[test]
fun scaling_and_base_application_preserve_signed_stat_semantics() {
  let stats = item_stats::new(32773, 32763, 32768, 32768, 32768, 32768, 32768, 32768, 32768, 32768, 32768, 32768, 32768, 32768, 32768);
  let scaled = stats.scale_from_center(1, 2);
  assert!(scaled.vitality() == 32770 && scaled.wisdom() == 32766, 1);
  assert!(scaled.strength() == 32768, 2);
  assert!(stats.scale_from_center(0, 1) == item_stats::zero(), 3);
  assert!(item_stats::apply_centered_to_base(10, 32773) == 15, 4);
  assert!(item_stats::apply_centered_to_base(10, 32763) == 5, 5);
  assert!(item_stats::apply_centered_to_base(5, 32763) == 1, 6);
  assert!(item_stats::apply_centered_to_base(2, 0) == 1, 7);
}
