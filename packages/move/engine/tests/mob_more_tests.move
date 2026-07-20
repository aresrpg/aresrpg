// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// Pure unit coverage for `mob`'s zero-covered getters: a bare `FightMob` (via the existing
/// `new_mob_for_testing` fixture) exercises `ap`; a `MobLootEntry` exercises its four field getters. No Scenario
/// needed — these are plain-data constructors + accessors.
#[test_only]
module aresrpg_fight::mob_more_tests;

use aresrpg_fight::mob;

#[test]
fun fight_mob_ap_getter() {
  let m = mob::new_mob_for_testing(5, 80, 100, 6, 3);
  assert!(mob::ap(&m) == 6);
}

#[test]
fun loot_entry_field_getters() {
  let e = mob::new_loot_entry(object::id_from_address(@0xF00D), 2500, 1, 3);
  assert!(mob::loot_entry_item_template(&e) == object::id_from_address(@0xF00D));
  assert!(mob::loot_entry_chance_bp(&e) == 2500);
  assert!(mob::loot_entry_min_qty(&e) == 1);
  assert!(mob::loot_entry_max_qty(&e) == 3);
}
