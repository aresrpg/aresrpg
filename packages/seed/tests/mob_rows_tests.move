// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
#[test_only]
module aresrpg_seed::mob_rows_tests;
use aresrpg_control::admin;
use aresrpg_math::mob_data;
use aresrpg_seed::{mob_rows, registry};
use sui::test_scenario;

fun mob(slug: vector<u8>, hp: u64): mob_data::MobData {
  mob_data::new_mob_data(b"Mob".to_string(), slug.to_string(), b"earth".to_string(),
    1, 10, hp, 6, 3, 0, 0, 32768, 32768, 32768, 32768, vector[],
    vector[mob_data::new_loot_entry(b"fang".to_string(), 10000, 1, 2)], 12, false)
}

fun rebalance(slug: vector<u8>, freeze: bool) {
  let mut scenario = test_scenario::begin(@0xA);
  let cap = admin::cap_for_testing(scenario.ctx());
  let mut root = registry::registry_for_testing(scenario.ctx());
  let before = mob(b"fuwa", 100);
  mob_rows::add_mob(&cap, &mut root, before, scenario.ctx());
  scenario.next_tx(@0xA);
  let mut template = scenario.take_shared<mob_rows::MobTemplate>();
  let id = object::id(&template);
  let snapshot = *mob_rows::data(&template);
  assert!(snapshot == before, 0);
  if (freeze) registry::freeze_forever(&cap, &mut root);
  let after = mob(slug, 200);
  mob_rows::overwrite_mob(&cap, &mut root, &mut template, after, scenario.ctx());
  assert!(object::id(&template) == id && *mob_rows::data(&template) == after, 1);
  assert!(snapshot == before && mob_data::hp(&snapshot) == 100, 2);
  assert!(registry::revision(&root) == 2, 3);
  test_scenario::return_shared(template);
  registry::destroy_for_testing(root);
  admin::destroy_for_testing(cap);
  scenario.end();
}

#[test]
fun rebalance_preserves_identity_and_previous_fight_snapshot() { rebalance(b"fuwa", false); }
#[test, expected_failure(abort_code = 4301, location = aresrpg_seed::mob_rows)]
fun another_species_cannot_replace_a_mob() { rebalance(b"other", false); }
#[test, expected_failure(abort_code = 4101, location = aresrpg_seed::registry)]
fun frozen_mobs_cannot_be_rebalanced() { rebalance(b"fuwa", true); }
