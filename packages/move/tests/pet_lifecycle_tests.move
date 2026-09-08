// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
#[test_only]
module aresrpg::pet_lifecycle_tests;

use aresrpg::{api, character::{Self, Character}, equipment, item::{Self, Item}, pet, protected_policy, version};
use aresrpg_control::admin;
use aresrpg_math::item_stats;
use aresrpg_seed::{item_rows, registry};
use sui::{clock, kiosk, package::Publisher, random, test_scenario, transfer_policy};

const OWNER: address = @0xA11CE;
const BUYER: address = @0xB;
const DAY: u64 = 86_400_000;
public enum Case has copy, drop { Full, SameDay, WrongTemplate, WrongCategory, WrongDiet, NotPet, Capped, Statless }

fun run(case: Case) {
  let mut scenario = test_scenario::begin(OWNER);
  item::test_init(scenario.ctx());
  version::test_init(scenario.ctx());
  scenario.next_tx(OWNER);
  let publisher = scenario.take_from_sender<Publisher>();
  let (policy, policy_cap) = transfer_policy::new<Item>(&publisher, scenario.ctx());
  let protected = protected_policy::for_testing<Item>(&publisher, scenario.ctx());
  publisher.burn();
  let admin = admin::cap_for_testing(scenario.ctx());
  let mut root = registry::registry_for_testing(scenario.ctx());
  let mut template = item_rows::add_item(&admin, &mut root,
    b"Pet".to_string(), b"lifecycle_pet".to_string(),
    if (case == Case::NotPet) b"hat".to_string() else b"pet".to_string(), 1,
    vector[b"seed_grain".to_string()], scenario.ctx());
  let mut values = item_stats::zero().to_vector();
  *values.borrow_mut(0) = 32828;
  *values.borrow_mut(1) = 32708;
  let endpoint = item_stats::from_vector(values);
  if (case != Case::Statless) item_rows::set_stats(&admin, &mut root, &mut template, endpoint, endpoint, scenario.ctx());
  let food_template = item_rows::template_for_testing(
    if (case == Case::WrongDiet) b"other_food".to_string() else b"seed_grain".to_string(),
    if (case == Case::WrongCategory) b"consumable".to_string() else b"resource".to_string(), scenario.ctx());
  let character = character::test_character(b"senshi".to_string(), 1, 0, scenario.ctx());
  let character_id = object::id(&character);
  let (mut kiosk, cap) = kiosk::new(scenario.ctx());
  kiosk.place(&cap, character);
  let mut generator = random::new_generator_for_testing();
  let pet_item = item::mint(&template, 1, &mut generator, scenario.ctx());
  let pet_id = object::id(&pet_item);
  assert!(pet::power(&pet_item) == 0 && pet::scaled_stats(&pet_item) == item_stats::zero());
  let food = item::mint(&food_template, 62, &mut generator, scenario.ctx());
  let food_id = object::id(&food);
  item::deposit(&mut kiosk, &cap, &policy, option::none(), pet_item);
  item::deposit(&mut kiosk, &cap, &policy, option::none(), food);
  let version = scenario.take_shared<version::Version>();
  if (case != Case::NotPet) {
    api::equip_item(&mut kiosk, &cap, character_id, b"pet".to_string(), pet_id, &protected, &version, scenario.ctx());
    assert!(equipment::pet_equipped(kiosk.borrow(&cap, character_id)));
    assert!(equipment::folded(kiosk.borrow(&cap, character_id)) == item_stats::zero());
  };
  test_scenario::return_shared(version);
  transfer::public_transfer(kiosk, OWNER);
  transfer::public_transfer(cap, OWNER);
  let mut clock = clock::create_for_testing(scenario.ctx());
  let days = if (case == Case::Full || case == Case::Capped) 60 else 1;
  let mut day = 1;
  while (day <= days) {
    scenario.next_tx(OWNER);
    let mut kiosk = scenario.take_from_sender<kiosk::Kiosk>();
    let cap = scenario.take_from_sender<kiosk::KioskOwnerCap>();
    let version = scenario.take_shared<version::Version>();
    clock::set_for_testing(&mut clock, day * DAY);
    if (case != Case::NotPet) api::unequip_item(&mut kiosk, &cap, character_id, b"pet".to_string(),
      test_scenario::receiving_ticket_by_id<Item>(pet_id), &policy, &version);
    assert!(kiosk.is_locked(pet_id));
    api::feed_kiosk_pet(&mut kiosk, &cap, if (case == Case::WrongTemplate) &food_template else &template,
      pet_id, food_id, &protected, &version, &clock, scenario.ctx());
    let held: &Item = kiosk.borrow(&cap, pet_id);
    assert!(pet::power(held) == day);
    let scaled = pet::scaled_stats(held);
    if (case == Case::Statless) { assert!(scaled == item_stats::zero()); }
    else assert!(scaled.vitality() == 32768 + (day as u16) && scaled.wisdom() == 32768 - (day as u16));
    assert!(item::amount(kiosk.borrow(&cap, food_id)) == 62 - (day as u32));
    if (case == Case::SameDay) api::feed_kiosk_pet(&mut kiosk, &cap, &template, pet_id, food_id,
      &protected, &version, &clock, scenario.ctx());
    api::equip_item(&mut kiosk, &cap, character_id, b"pet".to_string(), pet_id, &protected, &version, scenario.ctx());
    assert!(equipment::folded(kiosk.borrow(&cap, character_id)) == scaled);
    test_scenario::return_shared(version);
    transfer::public_transfer(kiosk, OWNER);
    scenario.return_to_sender(cap);
    day = day + 1;
  };
  scenario.next_tx(OWNER);
  let mut kiosk = scenario.take_from_sender<kiosk::Kiosk>();
  let cap = scenario.take_from_sender<kiosk::KioskOwnerCap>();
  let version = scenario.take_shared<version::Version>();
  api::unequip_item(&mut kiosk, &cap, character_id, b"pet".to_string(),
    test_scenario::receiving_ticket_by_id<Item>(pet_id), &policy, &version);
  assert!(!equipment::pet_equipped(kiosk.borrow(&cap, character_id)));
  assert!(equipment::folded(kiosk.borrow(&cap, character_id)) == item_stats::zero());
  if (case == Case::Capped) {
    clock::set_for_testing(&mut clock, 61 * DAY);
    api::feed_kiosk_pet(&mut kiosk, &cap, &template, pet_id, food_id, &protected, &version, &clock, scenario.ctx());
  };
  let pet_item: Item = protected.extract_from_kiosk(&mut kiosk, &cap, pet_id, scenario.ctx());
  assert!(pet::power(&pet_item) == days);
  if (case == Case::Full) assert!(pet::scaled_stats(&pet_item) == endpoint);
  transfer::public_transfer(pet_item, BUYER);
  test_scenario::return_shared(version);
  let remaining: Item = protected.extract_from_kiosk(&mut kiosk, &cap, food_id, scenario.ctx());
  assert!(remaining.amount() == 62 - (days as u32));
  item::destroy_for_testing(remaining);
  character::destroy(kiosk.take(&cap, character_id));
  kiosk::close_and_withdraw(kiosk, cap, scenario.ctx()).into_balance().destroy_zero();
  item_rows::destroy_for_testing(template);
  item_rows::destroy_for_testing(food_template);
  protected_policy::destroy_for_testing(protected, scenario.ctx());
  transfer_policy::destroy_and_withdraw(policy, policy_cap, scenario.ctx()).into_balance().destroy_zero();
  clock::destroy_for_testing(clock);
  registry::destroy_for_testing(root);
  admin::destroy_for_testing(admin);
  scenario.next_tx(BUYER);
  let bought = scenario.take_from_sender<Item>();
  assert!(pet::power(&bought) == days);
  if (case == Case::Full) assert!(pet::scaled_stats(&bought) == endpoint);
  item::destroy_for_testing(bought);
  scenario.end();
}

#[test] fun sixty_daily_feeds_scale_both_signed_stats_and_survive_transfer() { run(Case::Full); }
#[test] fun statless_pets_stay_neutral_after_feeding_and_equipping() { run(Case::Statless); }
#[test, expected_failure(abort_code = 2503, location = aresrpg::pet)]
fun a_second_feed_in_the_same_utc_day_is_refused() { run(Case::SameDay); }
#[test, expected_failure(abort_code = 2505, location = aresrpg::pet)]
fun another_template_cannot_supply_a_diet() { run(Case::WrongTemplate); }
#[test, expected_failure(abort_code = 2502, location = aresrpg::pet)]
fun a_matching_name_outside_resources_is_not_food() { run(Case::WrongCategory); }
#[test, expected_failure(abort_code = 2502, location = aresrpg::pet)]
fun a_resource_outside_the_authored_diet_is_not_food() { run(Case::WrongDiet); }
#[test, expected_failure(abort_code = 2501, location = aresrpg::pet)]
fun a_non_pet_with_a_diet_still_cannot_be_fed() { run(Case::NotPet); }
#[test, expected_failure(abort_code = 2504, location = aresrpg::pet)]
fun feeding_beyond_sixty_is_refused_even_on_a_new_day() { run(Case::Capped); }
