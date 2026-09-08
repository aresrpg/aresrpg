// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
#[test_only]
module aresrpg_seed::registry_tests;
use aresrpg_control::admin;
use aresrpg_seed::{registry, item_rows};
use sui::test_scenario;

fun exercise_freeze(mint_after: bool) {
  let mut scenario = test_scenario::begin(@0xA);
  registry::test_init(scenario.ctx());
  scenario.next_tx(@0xA);
  let cap = admin::cap_for_testing(scenario.ctx());
  let mut root = scenario.take_shared<registry::Registry>();
  assert!(!registry::is_frozen(&root) && registry::revision(&root) == 0, 0);
  registry::bump(&cap, &mut root, b"test".to_string(), b"write".to_string(), scenario.ctx());
  registry::freeze_forever(&cap, &mut root);
  assert!(registry::is_frozen(&root) && registry::revision(&root) == 1, 1);
  if (mint_after) {
    let item = item_rows::add_item(&cap, &mut root, b"Late".to_string(), b"late".to_string(), b"resource".to_string(), 1, vector[], scenario.ctx());
    item_rows::share_item(item);
  };
  test_scenario::return_shared(root);
  admin::destroy_for_testing(cap);
  scenario.end();
}
#[test]
fun publication_starts_unfrozen_and_freeze_preserves_the_last_write_revision() { exercise_freeze(false); }
#[test, expected_failure(abort_code = 4101, location = aresrpg_seed::registry)]
fun frozen_registry_refuses_new_derived_content() { exercise_freeze(true); }
