// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
#[test_only]
module aresrpg::loot_box_tests;

use aresrpg::loot_box;
use sui::object;

#[test]
fun a_single_reward_preserves_its_authored_amount() {
  let aloe = object::id_from_address(@0xa10e);
  let (rolled, amount) = loot_box::test_pick(vector[aloe], vector[1], vector[50], 0);
  assert!(rolled == aloe);
  assert!(amount == 50);
}

#[test]
fun weighted_rows_preserve_the_selected_rows_amount() {
  let common = object::id_from_address(@0xc0);
  let rare = object::id_from_address(@0xa1);
  let (first, first_amount) = loot_box::test_pick(vector[common, rare], vector[3, 1], vector[2, 7], 2);
  let (last, last_amount) = loot_box::test_pick(vector[common, rare], vector[3, 1], vector[2, 7], 3);
  assert!(first == common && first_amount == 2);
  assert!(last == rare && last_amount == 7);
}
