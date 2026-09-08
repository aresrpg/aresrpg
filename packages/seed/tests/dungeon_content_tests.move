// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
#[test_only]
module aresrpg_seed::dungeon_content_tests;
use aresrpg_control::admin;
use aresrpg_math::dungeon_data;
use aresrpg_seed::{dungeon_content, registry};
use sui::test_scenario;

fun rebalance(name: vector<u8>, freeze: bool) {
  let mut scenario = test_scenario::begin(@0xA);
  let cap = admin::cap_for_testing(scenario.ctx());
  let mut root = registry::registry_for_testing(scenario.ctx());
  let first = dungeon_data::new_room(vector[dungeon_data::new_room_mob(b"fuwa".to_string())]);
  let boss = dungeon_data::new_room(vector[dungeon_data::new_room_mob(b"boss".to_string())]);
  let before = dungeon_data::new_dungeon(b"old_key".to_string(), vector[first]);
  dungeon_content::add(&cap, &mut root, b"nest".to_string(), before, scenario.ctx());
  scenario.next_tx(@0xA);
  let mut dungeon = scenario.take_shared<dungeon_content::DungeonContent>();
  let id = object::id(&dungeon);
  assert!(*dungeon_content::data(&dungeon) == before, 0);
  if (freeze) registry::freeze_forever(&cap, &mut root);
  let after = dungeon_data::new_dungeon(b"new_key".to_string(), vector[first, boss]);
  dungeon_content::overwrite(&cap, &mut root, &mut dungeon, name.to_string(), after, scenario.ctx());
  assert!(object::id(&dungeon) == id && dungeon_content::name(&dungeon) == b"nest".to_string(), 1);
  assert!(*dungeon_content::data(&dungeon) == after && registry::revision(&root) == 2, 2);
  test_scenario::return_shared(dungeon);
  registry::destroy_for_testing(root);
  admin::destroy_for_testing(cap);
  scenario.end();
}

#[test]
fun dungeon_rebalances_key_and_ordered_rooms_without_changing_identity() { rebalance(b"nest", false); }
#[test, expected_failure(abort_code = 4601, location = aresrpg_seed::dungeon_content)]
fun a_different_dungeon_cannot_replace_the_original() { rebalance(b"other", false); }
#[test, expected_failure(abort_code = 4101, location = aresrpg_seed::registry)]
fun freeze_closes_dungeon_rebalancing() { rebalance(b"nest", true); }
