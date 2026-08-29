// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
#[test_only]
module aresrpg::crafting_tests;

use aresrpg::{character, crafting, item, progression, protected_policy};
use aresrpg_math::{craft_batch, job_xp};
use aresrpg_seed::{item_rows, recipe_rows};
use sui::{
  event,
  kiosk,
  package::Publisher,
  random,
  test_scenario,
  transfer_policy,
};

const OWNER: address = @0xA11CE;

#[test]
fun base_craft_xp_depends_only_on_distinct_ingredient_slots() {
  assert!(crafting::test_craft_xp_for(2) == 10);
  assert!(crafting::test_craft_xp_for(3) == 25);
  assert!(crafting::test_craft_xp_for(4) == 50);
  assert!(crafting::test_craft_xp_for(5) == 100);
  assert!(crafting::test_craft_xp_for(6) == 250);
  assert!(crafting::test_craft_xp_for(7) == 500);
  assert!(crafting::test_craft_xp_for(8) == 1000);
  assert!(job_xp::craft_required_level(2) == 1);
  assert!(job_xp::craft_required_level(3) == 10);
  assert!(job_xp::craft_required_level(4) == 20);
  assert!(job_xp::craft_required_level(5) == 40);
  assert!(job_xp::craft_required_level(6) == 60);
  assert!(job_xp::craft_required_level(7) == 80);
  assert!(job_xp::craft_required_level(8) == 100);
}

#[test]
fun obsolete_recipes_stop_granting_xp_at_retro_slot_boundaries() {
  assert!(job_xp::craft_xp_at_level(2, 59) == 10);
  assert!(job_xp::craft_xp_at_level(2, 60) == 0);
  assert!(job_xp::craft_xp_at_level(3, 79) == 25);
  assert!(job_xp::craft_xp_at_level(3, 80) == 0);
  assert!(job_xp::craft_xp_at_level(4, 99) == 50);
  assert!(job_xp::craft_xp_at_level(4, 100) == 0);
  assert!(job_xp::craft_xp_at_level(5, 100) == 100);
}

#[test]
fun batch_limits_separate_stack_mints_from_unique_object_mints() {
  assert!(craft_batch::max_attempts(true) == 1000);
  assert!(craft_batch::max_attempts(false) == 1);
}

#[test]
fun aggregate_craft_burns_merges_banks_and_emits_once() {
  assert!(run_aggregate_craft(6) <= 6);
}

#[test]
fun maximum_stackable_craft_stays_bounded() {
  assert!(run_aggregate_craft(1_000) <= 1_000);
}

#[test]
fun single_stackable_craft_has_the_same_fixed_shape() {
  assert!(run_aggregate_craft(1) <= 1);
}

fun run_aggregate_craft(attempts: u16): u16 {
  let mut scenario = test_scenario::begin(OWNER);
  item::test_init(scenario.ctx());
  scenario.next_tx(OWNER);
  let publisher = scenario.take_from_sender<Publisher>();
  let (item_policy, item_policy_cap) = transfer_policy::new<item::Item>(&publisher, scenario.ctx());
  let protected = protected_policy::for_testing<item::Item>(&publisher, scenario.ctx());
  let (mut kiosk, kiosk_cap) = kiosk::new(scenario.ctx());

  let mut input_templates = vector[];
  let mut input_template_ids = vector[];
  let mut input_quantities = vector[];
  let mut input_index = 0u64;
  while (input_index < 8) {
    let template = item_rows::template_for_testing(
      b"ingredient".to_string(), b"resource".to_string(), scenario.ctx(),
    );
    input_template_ids.push_back(item_rows::template_id(&template));
    input_quantities.push_back(1);
    input_templates.push_back(template);
    input_index = input_index + 1;
  };
  let output_template = item_rows::template_for_testing(
    b"flour".to_string(),
    b"resource".to_string(),
    scenario.ctx(),
  );
  let recipe = recipe_rows::recipe_for_testing(
    item_rows::template_id(&output_template),
    input_template_ids,
    input_quantities,
    b"BAKER".to_string(),
    scenario.ctx(),
  );
  let mut character = character::test_character(b"senshi".to_string(), 1, 0, scenario.ctx());
  progression::bank_job_xp(&mut character, b"BAKER".to_string(), 581_687);
  let character_id = object::id(&character);
  let mut setup_gen = random::new_generator_from_seed_for_testing(b"setup");
  let mut input_ids = vector[];
  let mut mint_index = 0;
  while (mint_index < input_templates.length()) {
    let input = item::mint(
      &input_templates[mint_index], attempts as u32, &mut setup_gen, scenario.ctx(),
    );
    input_ids.push_back(object::id(&input));
    kiosk.place(&kiosk_cap, input);
    mint_index = mint_index + 1;
  };
  let output = item::mint(&output_template, 10, &mut setup_gen, scenario.ctx());
  let output_id = object::id(&output);
  kiosk.place(&kiosk_cap, character);
  kiosk.place(&kiosk_cap, output);

  let seed = b"aggregate-craft";
  let mut expected_gen = random::new_generator_from_seed_for_testing(seed);
  let rounding_roll = expected_gen.generate_u16_in_range(0, 9999);
  let variance_roll = expected_gen.generate_u16_in_range(0, 9999);
  let (expected_successes, expected_xp) = craft_batch::resolve(
    8, 581_687, attempts, rounding_roll, variance_roll,
  );
  let mut gen = random::new_generator_from_seed_for_testing(seed);
  crafting::craft(
    &recipe,
    &mut kiosk,
    &kiosk_cap,
    character_id,
    input_ids,
    &output_template,
    option::some(output_id),
    attempts,
    &protected,
    &item_policy,
    &mut gen,
    scenario.ctx(),
  );

  let output: &item::Item = kiosk.borrow(&kiosk_cap, output_id);
  assert!(item::amount(output) == 10 + (expected_successes as u32));
  let character: &character::Character = kiosk.borrow(&kiosk_cap, character_id);
  assert!(progression::job_xp_of(character, b"BAKER".to_string()) == 581_687 + expected_xp);
  let events = event::events_by_type<crafting::Crafted>();
  assert!(events.length() == 1);
  assert!(
    crafting::event_for_testing(
      &events[events.length() - 1],
      object::id(&recipe),
      character_id,
      item_rows::template_id(&output_template),
      OWNER,
    ) == vector[1, 1, 1, 1, attempts as u64, expected_successes as u64, expected_xp],
  );

  let character: character::Character = kiosk.take(&kiosk_cap, character_id);
  character::destroy(character);
  let output: item::Item = kiosk.take(&kiosk_cap, output_id);
  item::destroy_for_testing(output);
  kiosk::close_and_withdraw(kiosk, kiosk_cap, scenario.ctx()).into_balance().destroy_zero();
  protected_policy::destroy_for_testing(protected, scenario.ctx());
  transfer_policy::destroy_and_withdraw(item_policy, item_policy_cap, scenario.ctx()).into_balance().destroy_zero();
  recipe_rows::destroy_for_testing(recipe);
  while (!input_templates.is_empty()) item_rows::destroy_for_testing(input_templates.pop_back());
  input_templates.destroy_empty();
  item_rows::destroy_for_testing(output_template);
  publisher.burn();
  scenario.end();
  expected_successes
}
