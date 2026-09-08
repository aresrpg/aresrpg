// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
#[test_only]
module aresrpg_seed::spell_rows_tests;
use aresrpg_control::admin;
use aresrpg_math::spell_effect;
use aresrpg_seed::{spell_rows, registry};
use sui::test_scenario;

fun levels(cost: u8, count: u64): vector<spell_effect::SpellLevel> {
  vector::tabulate!(count, |index| {
    let value = (index + 1) as u32;
    let row = spell_effect::new_effect(0, b"earth".to_string(), value, value + 1, 0, 0, 1, 10000, 0, 0);
    spell_effect::new_spell_level(cost, 1, 3, false, true, false, false, 0, 0, 0, 0, vector[row], vector[])
  })
}

fun rebalance(count: u64, freeze: bool) {
  let mut scenario = test_scenario::begin(@0xA);
  let cap = admin::cap_for_testing(scenario.ctx());
  let mut root = registry::registry_for_testing(scenario.ctx());
  let before = levels(3, 6);
  spell_rows::add_spell(&cap, &mut root, b"strike".to_string(), b"senshi".to_string(), 10, before, scenario.ctx());
  scenario.next_tx(@0xA);
  let mut spell = scenario.take_shared<spell_rows::SpellTemplate>();
  let id = object::id(&spell);
  let mut level = 1;
  while (level <= 6) {
    assert!(spell_rows::level_of(&spell, level) == before[level - 1], 0);
    level = level + 1;
  };
  if (freeze) registry::freeze_forever(&cap, &mut root);
  let after = levels(2, count);
  spell_rows::overwrite_spell(&cap, &mut root, &mut spell, after, scenario.ctx());
  assert!(object::id(&spell) == id && spell_rows::name(&spell) == b"strike".to_string(), 1);
  assert!(spell_rows::classe(&spell) == b"senshi".to_string() && spell_rows::unlock_level(&spell) == 10, 2);
  assert!(spell_rows::max_spell_level(&spell) == 6 && registry::revision(&root) == 2, 3);
  level = 1;
  while (level <= 6) {
    assert!(spell_rows::level_of(&spell, level) == after[level - 1], 4);
    level = level + 1;
  };
  test_scenario::return_shared(spell);
  registry::destroy_for_testing(root);
  admin::destroy_for_testing(cap);
  scenario.end();
}

#[test]
fun spell_rebalance_preserves_class_ladder_and_replaces_every_level() { rebalance(6, false); }
#[test, expected_failure(abort_code = 4402, location = aresrpg_seed::spell_rows)]
fun a_partial_level_table_cannot_replace_a_spell() { rebalance(5, false); }
#[test, expected_failure(abort_code = 4101, location = aresrpg_seed::registry)]
fun freeze_closes_spell_rebalancing() { rebalance(6, true); }

fun reject_creation(classe: vector<u8>, count: u64) {
  let mut ctx = tx_context::dummy();
  let cap = admin::cap_for_testing(&mut ctx);
  let mut root = registry::registry_for_testing(&mut ctx);
  spell_rows::add_spell(&cap, &mut root, b"invalid".to_string(), classe.to_string(), 1, levels(2, count), &ctx);
  abort 999
}
#[test, expected_failure(abort_code = 4401, location = aresrpg_seed::spell_rows)]
fun spells_require_a_real_class() { reject_creation(b"invented", 6); }
#[test, expected_failure(abort_code = 4402, location = aresrpg_seed::spell_rows)]
fun newly_published_spells_require_all_six_levels() { reject_creation(b"senshi", 5); }
