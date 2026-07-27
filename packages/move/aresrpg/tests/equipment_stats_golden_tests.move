// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// Move-side executable twins of `packages/sim/test/vectors/equipment_stats_golden.json` for centered gear folds.
#[test_only]
module aresrpg::equipment_stats_golden_tests;

use aresrpg::{equipment, equipment_stats, item_stats::{Self, ItemStatistics}};
use aresrpg_foundation::spell;

fun item(strength: u16, movement: u16, action: u16): ItemStatistics {
  let c = item_stats::shift();
  item_stats::new(c, c, strength, c, c, c, c, movement, action, c, c, c, c, c, c, c, c)
}

fun apply_item(positive_cache: &spell::Stats, malus_cache: &spell::Stats, s: &ItemStatistics): (spell::Stats, spell::Stats) {
  let (positive, negative) = equipment_stats::z504(s);
  (spell::stats_add(positive_cache, &positive), spell::stats_add(malus_cache, &negative))
}

#[test]
/// Vector: below_center_malus_subtracts.
fun below_center_malus_subtracts() {
  let c = item_stats::shift();
  let (positive, malus) = apply_item(&spell::stats_zero(), &spell::stats_zero(), &item(c + 30, c, c));
  let (positive, malus) = apply_item(&positive, &malus, &item(c - 20, c, c));
  let base = spell::new_stats(10, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
  assert!(spell::stat_strength(&equipment_stats::z17(&base, &positive, &malus)) == 20, 0);

  // The disjoint aggregate is order-independent.
  let (reverse_positive, reverse_malus) = apply_item(&spell::stats_zero(), &spell::stats_zero(), &item(c - 20, c, c));
  let (reverse_positive, reverse_malus) = apply_item(&reverse_positive, &reverse_malus, &item(c + 30, c, c));
  assert!(spell::stat_strength(&equipment_stats::z17(&base, &reverse_positive, &reverse_malus)) == 20, 1);
}

#[test]
/// Vector: malus_saturates_without_u64_underflow.
fun malus_saturates_without_u64_underflow() {
  let c = item_stats::shift();
  // Stored zero is the maximum representable -32768 line: both centered subtraction and the final u64 floor run.
  let negative = item(0, c, 0);
  let (positive, malus) = apply_item(&spell::stats_zero(), &spell::stats_zero(), &negative);
  let base = spell::new_stats(3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
  assert!(spell::stat_strength(&equipment_stats::z17(&base, &positive, &malus)) == 0, 0);
  assert!(equipment_stats::z18(3, spell::stat_ap_bonus(&positive), spell::stat_ap_bonus(&malus)) == 0, 1);

  // A post-upgrade item removes its malus; an unmarked legacy item cannot manufacture a positive line.
  let restored_malus = equipment_stats::remove_malus(&malus, &malus, true);
  assert!(spell::stat_strength(&equipment_stats::z17(&base, &positive, &restored_malus)) == 3, 2);
  let legacy_malus = equipment_stats::remove_malus(&spell::stats_zero(), &malus, false);
  assert!(spell::stat_strength(&equipment_stats::z17(&base, &positive, &legacy_malus)) == 3, 3);
}

#[test]
/// Vector: action_movement_fold_into_turn_refill.
fun action_movement_fold_into_turn_refill() {
  let c = item_stats::shift();
  let (positive, malus) = apply_item(&spell::stats_zero(), &spell::stats_zero(), &item(c, c + 1, c + 1));
  let (ap, mp) = equipment::test_fold_action_movement(6, 3, &positive, &malus);
  assert!(ap == 7, 0);
  assert!(mp == 4, 1);
}

#[test]
/// Vector: invented_critical_keys_are_ignored. Canonical `critical` alone folds into combat `critical_hit`.
fun invented_critical_keys_are_ignored() {
  let c = item_stats::shift();
  // Shared vector: base critical_hit 4 + canonical critical 2; invented aliases carry +100 each but fold nowhere.
  let canonical = item_stats::new(c, c, c, c, c, c, c, c, c, c + 2, c, c + 100, c + 100, c, c, c, c);
  let (positive, negative) = equipment_stats::z504(&canonical);
  assert!(spell::stat_critical_hit(&positive) == 2, 0);
  assert!(spell::stat_critical_hit(&negative) == 0, 1);
  let base = spell::new_stats(0, 0, 0, 0, 0, 4, 0, 0, 0, 0, 0);
  assert!(spell::stat_critical_hit(&equipment_stats::z17(&base, &positive, &negative)) == 6, 2);
}
