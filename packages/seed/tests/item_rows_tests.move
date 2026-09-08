// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
#[test_only]
module aresrpg_seed::item_rows_tests;

use aresrpg_control::admin;
use aresrpg_math::{consumable_effect, item_damages, item_stats};
use aresrpg_seed::{item_rows, registry};
use sui::test_scenario;

#[test]
fun published_item_rebalances_without_changing_identity_and_clears_attachments() {
  let mut scenario = test_scenario::begin(@0xA);
  let cap = admin::cap_for_testing(scenario.ctx());
  let mut root = registry::registry_for_testing(scenario.ctx());
  let mut item = item_rows::add_item(&cap, &mut root, b"Old".to_string(), b"sword".to_string(), b"sword".to_string(), 1, vector[], scenario.ctx());
  let id = item_rows::template_id(&item);
  assert!(!item_rows::has_stats(&item) && item_rows::damage_lines(&item).is_empty(), 0);
  let lo = item_stats::zero();
  let mut values = lo.to_vector();
  *values.borrow_mut(0) = values[0] + 10;
  let hi = item_stats::from_vector(values);
  item_rows::set_stats(&cap, &mut root, &mut item, lo, hi, scenario.ctx());
  let old_damage = item_damages::new(1, 2, b"damage".to_string(), b"earth".to_string());
  item_rows::set_damages(&cap, &mut root, &mut item, vector[old_damage], scenario.ctx());
  item_rows::share_item(item);
  scenario.next_tx(@0xA);
  let mut item = scenario.take_shared<item_rows::ItemTemplate>();
  assert!(item_rows::stats_min(&item) == lo && item_rows::stats_max(&item) == hi, 1);
  assert!(item_rows::damage_lines(&item) == vector[old_damage], 2);
  item_rows::overwrite_item(&cap, &mut root, &mut item, b"New".to_string(), 20, vector[b"food".to_string()], scenario.ctx());
  item_rows::set_stats(&cap, &mut root, &mut item, hi, hi, scenario.ctx());
  let new_damage = item_damages::new(3, 4, b"damage".to_string(), b"fire".to_string());
  item_rows::set_damages(&cap, &mut root, &mut item, vector[new_damage], scenario.ctx());
  assert!(item_rows::template_id(&item) == id && item_rows::template_type(&item) == b"sword".to_string(), 3);
  assert!(item_rows::template_category(&item) == b"sword".to_string(), 4);
  assert!(item_rows::template_name(&item) == b"New".to_string() && item_rows::template_level(&item) == 20, 5);
  assert!(item_rows::pet_foods(&item) == vector[b"food".to_string()], 6);
  assert!(item_rows::stats_min(&item) == hi && item_rows::stats_max(&item) == hi, 7);
  assert!(item_rows::damage_lines(&item) == vector[new_damage], 8);
  item_rows::clear_stats(&cap, &mut root, &mut item, scenario.ctx());
  item_rows::clear_damages(&cap, &mut root, &mut item, scenario.ctx());
  assert!(!item_rows::has_stats(&item) && item_rows::damage_lines(&item).is_empty(), 9);
  let revision = registry::revision(&root);
  item_rows::clear_stats(&cap, &mut root, &mut item, scenario.ctx());
  item_rows::clear_damages(&cap, &mut root, &mut item, scenario.ctx());
  assert!(registry::revision(&root) == revision && revision == 8, 10);
  test_scenario::return_shared(item);
  registry::destroy_for_testing(root);
  admin::destroy_for_testing(cap);
  scenario.end();
}

fun consumable_lifecycle(freeze: bool) {
  let mut scenario = test_scenario::begin(@0xA);
  let cap = admin::cap_for_testing(scenario.ctx());
  let mut root = registry::registry_for_testing(scenario.ctx());
  let mut item = item_rows::add_item(&cap, &mut root, b"Box".to_string(), b"box".to_string(), b"consumable".to_string(), 1, vector[], scenario.ctx());
  assert!(item_rows::consumable_effect(&item).is_none(), 0);
  item_rows::set_effect(&cap, &mut root, &mut item, consumable_effect::loot_box(), scenario.ctx());
  item_rows::share_item(item);
  scenario.next_tx(@0xA);
  let mut item = scenario.take_shared<item_rows::ItemTemplate>();
  assert!(item_rows::consumable_effect(&item) == option::some(consumable_effect::loot_box()), 1);
  if (freeze) registry::freeze_forever(&cap, &mut root);
  item_rows::set_effect(&cap, &mut root, &mut item, consumable_effect::reset_stats(), scenario.ctx());
  assert!(item_rows::consumable_effect(&item) == option::some(consumable_effect::reset_stats()), 2);
  item_rows::clear_effect(&cap, &mut root, &mut item, scenario.ctx());
  assert!(item_rows::consumable_effect(&item).is_none(), 3);
  item_rows::clear_effect(&cap, &mut root, &mut item, scenario.ctx());
  assert!(registry::revision(&root) == 4, 4);
  test_scenario::return_shared(item);
  registry::destroy_for_testing(root);
  admin::destroy_for_testing(cap);
  scenario.end();
}

#[test]
fun consumable_effect_is_live_replaceable_and_removable() { consumable_lifecycle(false); }

#[test, expected_failure(abort_code = 4101, location = aresrpg_seed::registry)]
fun freeze_refuses_changes_to_an_existing_consumable() { consumable_lifecycle(true); }

#[test, expected_failure(abort_code = 4501, location = aresrpg_seed::item_rows)]
fun unknown_categories_cannot_be_published() {
  let mut ctx = tx_context::dummy();
  let cap = admin::cap_for_testing(&mut ctx);
  let mut root = registry::registry_for_testing(&mut ctx);
  let item = item_rows::add_item(&cap, &mut root, b"Bad".to_string(), b"bad".to_string(), b"invented".to_string(), 1, vector[], &ctx);
  item_rows::share_item(item);
  abort 999
}

#[test, expected_failure(abort_code = 4504, location = aresrpg_seed::item_rows)]
fun equipment_cannot_gain_a_consumable_effect() {
  let mut ctx = tx_context::dummy();
  let cap = admin::cap_for_testing(&mut ctx);
  let mut root = registry::registry_for_testing(&mut ctx);
  let mut item = item_rows::template_for_testing(b"hat".to_string(), b"hat".to_string(), &mut ctx);
  item_rows::set_effect(&cap, &mut root, &mut item, consumable_effect::loot_box(), &ctx);
  abort 999
}

#[test, expected_failure(abort_code = 4503, location = aresrpg_seed::item_rows)]
fun inverted_stat_ranges_cannot_poison_future_mints() {
  let mut ctx = tx_context::dummy();
  let cap = admin::cap_for_testing(&mut ctx);
  let mut root = registry::registry_for_testing(&mut ctx);
  let mut item = item_rows::template_for_testing(b"hat".to_string(), b"hat".to_string(), &mut ctx);
  let max = item_stats::zero();
  let mut values = max.to_vector();
  *values.borrow_mut(0) = values[0] + 1;
  item_rows::set_stats(&cap, &mut root, &mut item, item_stats::from_vector(values), max, &ctx);
  abort 999
}
