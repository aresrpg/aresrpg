// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
#[test_only]
module aresrpg::crafting_lifecycle_tests;

use aresrpg::{api, character, crafting, item::{Self, Item}, progression, protected_policy, version};
use aresrpg_control::admin;
use aresrpg_seed::{item_rows, recipe_rows, registry};
use kiosk::personal_kiosk;
use sui::{event, kiosk, package::Publisher, random, test_scenario, transfer_policy};

const OWNER: address = @0xA11CE;

// Each attempt uses the real terminal Random API and persisted personal kiosk. A failed
// roll still consumes exactly two units and banks XP; only certified successes mint output.
fun run(attempts: u16, rounds: u64, merge: bool, invalid: u8) {
  let mut scenario = test_scenario::begin(@0x0);
  random::create_for_testing(scenario.ctx());
  scenario.next_tx(OWNER);
  item::test_init(scenario.ctx());
  version::test_init(scenario.ctx());
  scenario.next_tx(OWNER);
  let publisher = scenario.take_from_sender<Publisher>();
  let (policy, policy_cap) = transfer_policy::new<Item>(&publisher, scenario.ctx());
  let protected = protected_policy::for_testing<Item>(&publisher, scenario.ctx());
  publisher.burn();
  let admin = admin::cap_for_testing(scenario.ctx());
  let mut root = registry::registry_for_testing(scenario.ctx());
  let (mut kiosk, cap) = kiosk::new(scenario.ctx());
  let personal = personal_kiosk::new(&mut kiosk, cap, scenario.ctx());
  let cap = personal_kiosk::borrow(&personal);
  let character = character::test_character(b"senshi".to_string(), 1, 0, scenario.ctx());
  let character_id = object::id(&character);
  kiosk.place(cap, character);
  let mut generator = random::new_generator_from_seed_for_testing(b"craft-setup");
  let mut inputs = vector[];
  let mut input_templates = vector[];
  let mut template_ids = vector[];
  let mut quantities = vector[];
  let slots = if (invalid == 3) 3 else 2;
  let supply = (attempts as u32) * (rounds as u32) + 3;
  let names = vector[b"grain", b"water", b"herb"];
  let mut index = 0;
  while (index < slots) {
    let template = item_rows::template_for_testing(names[index].to_string(), b"resource".to_string(), scenario.ctx());
    template_ids.push_back(item_rows::template_id(&template));
    quantities.push_back(1);
    let input = item::mint(&template, if (invalid == 7 && index == 1) 1 else supply, &mut generator, scenario.ctx());
    inputs.push_back(object::id(&input));
    item::deposit(&mut kiosk, cap, &policy, option::none(), input);
    input_templates.push_back(template);
    index = index + 1;
  };
  let output = item_rows::template_for_testing(b"flour".to_string(), b"resource".to_string(), scenario.ctx());
  let mut recipe = recipe_rows::recipe_for_testing(item_rows::template_id(&output), template_ids, quantities, b"BAKER".to_string(), scenario.ctx());
  if (invalid == 5) recipe_rows::retire_recipe(&admin, &mut root, &mut recipe, scenario.ctx());
  let mut output_ids = vector[];
  let existing = if (merge) {
    let held = item::mint(&output, 10, &mut generator, scenario.ctx());
    let id = object::id(&held);
    item::deposit(&mut kiosk, cap, &policy, option::none(), held);
    if (invalid == 4) kiosk.list<Item>(cap, id, 1);
    output_ids.push_back(id);
    option::some(id)
  } else option::none();
  transfer::public_transfer(kiosk, OWNER);
  personal_kiosk::transfer_to_sender(personal, scenario.ctx());
  let mut total_successes = 0u64;
  let mut failed_attempts = 0u64;
  let mut round = 0u64;
  while (round < rounds) {
    scenario.next_tx(OWNER);
    let mut kiosk = scenario.take_from_sender<kiosk::Kiosk>();
    let personal = scenario.take_from_sender<personal_kiosk::PersonalKioskCap>();
    let version = scenario.take_shared<version::Version>();
    let randomness = scenario.take_shared<random::Random>();
    let ids = if (invalid == 1) vector[inputs[1], inputs[0]] else if (invalid == 6) vector[inputs[0], inputs[0]] else inputs;
    api::craft(&recipe, &mut kiosk, &personal, character_id, ids,
      if (invalid == 2) &input_templates[0] else &output, existing, attempts,
      &protected, &policy, &randomness, &version, scenario.ctx());
    let events = event::events_by_type<crafting::Crafted>();
    let witness = crafting::event_for_testing(&events[events.length() - 1], object::id(&recipe), character_id,
      item_rows::template_id(&output), OWNER);
    assert!(witness[0] == 1 && witness[1] == 1 && witness[2] == 1 && witness[3] == 1);
    assert!(witness[4] == (attempts as u64) && witness[5] <= (attempts as u64));
    assert!(witness[6] == 10 * (attempts as u64));
    total_successes = total_successes + witness[5];
    failed_attempts = failed_attempts + (attempts as u64) - witness[5];
    let cap = personal_kiosk::borrow(&personal);
    if (witness[5] > 0 && !merge) {
      let id = object::last_created(scenario.ctx());
      let minted: &Item = kiosk.borrow(cap, id);
      assert!(minted.amount() == (witness[5] as u32) && minted.template() == item_rows::template_id(&output));
      assert!(kiosk.is_locked(id));
      output_ids.push_back(id);
    };
    index = 0;
    while (index < inputs.length()) {
      let remaining: &Item = kiosk.borrow(cap, inputs[index]);
      assert!(remaining.amount() == supply - ((round + 1) as u32) * (attempts as u32));
      assert!(kiosk.is_locked(inputs[index]));
      index = index + 1;
    };
    assert!(progression::job_xp_of(kiosk.borrow(cap, character_id), b"BAKER".to_string()) == 10 * (attempts as u64) * (round + 1));
    if (merge) assert!(item::amount(kiosk.borrow(cap, *existing.borrow())) == 10 + (total_successes as u32));
    test_scenario::return_shared(version);
    test_scenario::return_shared(randomness);
    transfer::public_transfer(kiosk, OWNER);
    personal_kiosk::transfer_to_sender(personal, scenario.ctx());
    round = round + 1;
  };
  assert!(total_successes > 0);
  if (rounds > 1) assert!(failed_attempts > 0);
  scenario.next_tx(OWNER);
  let mut kiosk = scenario.take_from_sender<kiosk::Kiosk>();
  let personal = scenario.take_from_sender<personal_kiosk::PersonalKioskCap>();
  let cap = personal_kiosk::borrow(&personal);
  assert!((kiosk.item_count() as u64) == 1 + slots + output_ids.length());
  let mut minted_total = 0u64;
  while (!output_ids.is_empty()) {
    let held: Item = protected.extract_from_kiosk(&mut kiosk, cap, output_ids.pop_back(), scenario.ctx());
    minted_total = minted_total + (held.amount() as u64);
    item::destroy_for_testing(held);
  };
  output_ids.destroy_empty();
  assert!(minted_total == total_successes + if (merge) 10 else 0);
  while (!inputs.is_empty()) item::destroy_for_testing(protected.extract_from_kiosk(&mut kiosk, cap, inputs.pop_back(), scenario.ctx()));
  inputs.destroy_empty();
  character::destroy(kiosk.take(cap, character_id));
  transfer::public_transfer(kiosk, OWNER);
  personal_kiosk::transfer_to_sender(personal, scenario.ctx());
  while (!input_templates.is_empty()) item_rows::destroy_for_testing(input_templates.pop_back());
  input_templates.destroy_empty();
  item_rows::destroy_for_testing(output);
  recipe_rows::destroy_for_testing(recipe);
  protected_policy::destroy_for_testing(protected, scenario.ctx());
  transfer_policy::destroy_and_withdraw(policy, policy_cap, scenario.ctx()).into_balance().destroy_zero();
  registry::destroy_for_testing(root);
  admin::destroy_for_testing(admin);
  scenario.end();
}

#[test] fun new_outputs_match_successes_and_every_roll_pays_ingredients_and_xp() { run(1, 16, false, 0); }
#[test] fun bounded_batch_merges_only_its_awarded_units() { run(20, 1, true, 0); }
#[test, expected_failure(abort_code = 2321, location = aresrpg_math::craft_batch)]
fun wrong_ingredient_order_is_refused() { run(1, 1, false, 1); }
#[test, expected_failure(abort_code = 2323, location = aresrpg_math::craft_batch)]
fun foreign_output_template_is_refused() { run(1, 1, false, 2); }
#[test, expected_failure(abort_code = 2305, location = aresrpg_math::craft_batch)]
fun ingredient_slot_requirement_cannot_be_under_levelled() { run(1, 1, false, 3); }
#[test, expected_failure(abort_code = 2323, location = aresrpg_math::craft_batch)]
fun a_listed_output_stack_cannot_receive_new_supply() { run(1, 1, true, 4); }
#[test, expected_failure(abort_code = 2306, location = aresrpg_seed::recipe_rows)]
fun retired_recipe_is_refused_before_inputs_burn() { run(1, 1, false, 5); }
#[test, expected_failure(abort_code = 2320, location = aresrpg_math::craft_batch)]
fun empty_attempt_count_is_refused() { run(0, 1, false, 0); }

#[test, expected_failure(abort_code = 2321, location = aresrpg_math::craft_batch)]
fun a_repeated_first_stack_cannot_replace_the_second_ingredient() { run(1, 1, false, 6); }
#[test, expected_failure(abort_code = 2322, location = aresrpg_math::craft_batch)]
fun a_short_later_ingredient_aborts_the_entire_burn_plan() { run(2, 1, false, 7); }
