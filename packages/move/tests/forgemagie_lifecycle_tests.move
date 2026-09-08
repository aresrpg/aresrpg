// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
#[test_only]
module aresrpg::forgemagie_lifecycle_tests;

use aresrpg::{api, character, forgemagie, item, protected_policy, version};
use aresrpg_control::admin;
use aresrpg_math::{item_stats, rune_catalog};
use aresrpg_seed::{item_rows, registry};
use kiosk::personal_kiosk;
use sui::{event, kiosk, package::Publisher, random, test_scenario, transfer_policy};

const OWNER: address = @0xA;
public enum CrushCase has copy, drop { Redeem, EarlyDiscard, WrongTemplate, NoStats, Pet, Empty }
public enum ScribeCase has copy, drop { Success, Capped, WrongGear, NoStats, NoJob, WrongTier }

fun setup(): test_scenario::Scenario {
  let mut scenario = test_scenario::begin(@0x0);
  random::create_for_testing(scenario.ctx());
  version::test_init(scenario.ctx());
  scenario.next_tx(OWNER);
  item::test_init(scenario.ctx());
  scenario.next_tx(OWNER);
  scenario
}

fun crush(case: CrushCase) {
  let mut scenario = setup();
  let publisher = scenario.take_from_sender<Publisher>();
  let (policy, policy_cap) = transfer_policy::new<item::Item>(&publisher, scenario.ctx());
  let protected = protected_policy::for_testing<item::Item>(&publisher, scenario.ctx());
  let admin = admin::cap_for_testing(scenario.ctx());
  let mut root = registry::registry_for_testing(scenario.ctx());
  let mut gear_template = item_rows::template_for_testing(b"crush_gear".to_string(),
    if (case == CrushCase::Pet) b"pet".to_string() else b"hat".to_string(), scenario.ctx());
  if (case != CrushCase::NoStats) {
    let mut values = item_stats::zero().to_vector();
    *values.borrow_mut(2) = item_stats::shift() + 40;
    let stats = item_stats::from_vector(values);
    item_rows::set_stats(&admin, &mut root, &mut gear_template, stats, stats, scenario.ctx());
  };
  let (mut kiosk, cap) = kiosk::new(scenario.ctx());
  let personal = personal_kiosk::new(&mut kiosk, cap, scenario.ctx());
  let mut generator = random::new_generator_for_testing();
  let gear = item::mint(&gear_template, 1, &mut generator, scenario.ctx());
  let gear_id = object::id(&gear);
  kiosk.lock(personal.borrow(), &policy, gear);
  let mut templates = vector[];
  let mut target_ids = vector[];
  let mut tier = 1u8;
  while (tier <= 3) {
    let template = item_rows::template_for_testing(rune_catalog::slug(2, tier), b"rune".to_string(), scenario.ctx());
    let target = item::mint_plain(&template, 1, scenario.ctx());
    target_ids.push_back(object::id(&target));
    kiosk.lock(personal.borrow(), &policy, target);
    templates.push_back(template);
    tier = tier + 1;
  };
  let randomness = scenario.take_shared<random::Random>();
  let version = scenario.take_shared<version::Version>();
  api::crush_gear(&mut kiosk, &personal,
    if (case == CrushCase::Empty) vector[] else vector[gear_id], &protected, &randomness, &version, scenario.ctx());
  assert!(kiosk.has_item(gear_id) == (case == CrushCase::Empty), 0);
  assert!(event::events_by_type<forgemagie::GearCrushed>().length() == 1, 1);
  transfer::public_share_object(kiosk);
  personal_kiosk::transfer_to_sender(personal, scenario.ctx());
  test_scenario::return_shared(randomness);
  test_scenario::return_shared(version);
  scenario.next_tx(OWNER);
  let mut kiosk = scenario.take_shared<kiosk::Kiosk>();
  let personal = scenario.take_from_sender<personal_kiosk::PersonalKioskCap>();
  let version = scenario.take_shared<version::Version>();
  let mut claim = scenario.take_from_sender<forgemagie::CrushClaim>();
  api::reveal_crush_claim(&mut claim, &version);
  api::reveal_crush_claim(&mut claim, &version);
  assert!(event::events_by_type<forgemagie::CrushRevealed>().length() == 2, 2);
  if (case == CrushCase::EarlyDiscard) {
    api::discard_crush_claim(claim, &version);
    abort 999
  };
  if (case == CrushCase::WrongTemplate) {
    api::redeem_rune(&mut claim, &templates[0], 1, 1, option::none(), &mut kiosk, personal.borrow(), &policy, &version, scenario.ctx());
    abort 999
  };
  let mut recovered = 0u64;
  tier = 1;
  while (tier <= 3) {
    let index = (tier - 1) as u64;
    api::redeem_rune(&mut claim, &templates[index], 2, tier, option::some(target_ids[index]),
      &mut kiosk, personal.borrow(), &policy, &version, scenario.ctx());
    let quantity = kiosk.borrow<item::Item>(personal.borrow(), target_ids[index]).amount();
    recovered = recovered + ((quantity - 1) as u64) * rune_catalog::rune_amount(2, tier);
    api::redeem_rune(&mut claim, &templates[index], 2, tier, option::some(target_ids[index]),
      &mut kiosk, personal.borrow(), &policy, &version, scenario.ctx());
    assert!(kiosk.borrow<item::Item>(personal.borrow(), target_ids[index]).amount() == quantity, 3);
    tier = tier + 1;
  };
  assert!(recovered == (if (case == CrushCase::Empty) 0 else 10), 4);
  api::discard_crush_claim(claim, &version);
  test_scenario::return_shared(kiosk);
  personal_kiosk::transfer_to_sender(personal, scenario.ctx());
  test_scenario::return_shared(version);
  protected_policy::destroy_for_testing(protected, scenario.ctx());
  transfer_policy::destroy_and_withdraw(policy, policy_cap, scenario.ctx()).into_balance().destroy_zero();
  templates.do!(|template| item_rows::destroy_for_testing(template));
  item_rows::destroy_for_testing(gear_template);
  registry::destroy_for_testing(root);
  admin::destroy_for_testing(admin);
  publisher.burn();
  scenario.end();
}

#[test]
fun committed_crush_reveals_once_redeems_each_owed_type_once_and_closes() { crush(CrushCase::Redeem); }

#[test]
fun an_empty_crush_claim_has_no_yield_and_can_close() { crush(CrushCase::Empty); }

#[test, expected_failure(abort_code = 2709, location = aresrpg::forgemagie)]
fun unpaid_rune_rows_prevent_claim_destruction() { crush(CrushCase::EarlyDiscard); }

#[test, expected_failure(abort_code = 2711, location = aresrpg::forgemagie)]
fun claim_coordinates_cannot_substitute_another_rune_template() { crush(CrushCase::WrongTemplate); }

#[test, expected_failure(abort_code = 2710, location = aresrpg::forgemagie)]
fun statless_gear_cannot_be_crushed() { crush(CrushCase::NoStats); }

#[test, expected_failure(abort_code = 2705, location = aresrpg::forgemagie)]
fun a_pet_cannot_enter_the_gear_crusher() { crush(CrushCase::Pet); }

fun scribe(case: ScribeCase) {
  let mut scenario = setup();
  let publisher = scenario.take_from_sender<Publisher>();
  let (policy, policy_cap) = transfer_policy::new<item::Item>(&publisher, scenario.ctx());
  let protected = protected_policy::for_testing<item::Item>(&publisher, scenario.ctx());
  let admin = admin::cap_for_testing(scenario.ctx());
  let mut root = registry::registry_for_testing(scenario.ctx());
  let mut template = item_rows::template_for_testing(b"scribe_gear".to_string(),
    if (case == ScribeCase::NoJob) b"pet".to_string() else b"hat".to_string(), scenario.ctx());
  if (case != ScribeCase::NoStats) {
    let mut values = item_stats::zero().to_vector();
    *values.borrow_mut(9) = item_stats::shift() + 10;
    item_rows::set_stats(&admin, &mut root, &mut template, item_stats::zero(), item_stats::from_vector(values), scenario.ctx());
  };
  let other = item_rows::template_for_testing(b"other".to_string(), b"hat".to_string(), scenario.ctx());
  let rune_template = item_rows::template_for_testing(rune_catalog::slug(9, 1), b"rune".to_string(), scenario.ctx());
  let (mut kiosk, cap) = kiosk::new(scenario.ctx());
  let personal = personal_kiosk::new(&mut kiosk, cap, scenario.ctx());
  let mut generator = random::new_generator_from_seed_for_testing(b"capped-scribe");
  let mut gear = item::mint(&template, 1, &mut generator, scenario.ctx());
  if (case != ScribeCase::NoStats) item::set_stats(&mut gear, item_stats::zero(), 0);
  if (case == ScribeCase::Capped) {
    let mut values = item_stats::zero().to_vector();
    *values.borrow_mut(9) = item_stats::shift() + 10;
    item::set_stats(&mut gear, item_stats::from_vector(values), 0);
  };
  let gear_id = object::id(&gear);
  kiosk.lock(personal.borrow(), &policy, gear);
  let rune = item::mint_plain(&rune_template, 8, scenario.ctx());
  let rune_id = object::id(&rune);
  kiosk.lock(personal.borrow(), &policy, rune);
  let actor = character::test_character(b"senshi".to_string(), 1, 0, scenario.ctx());
  let actor_id = object::id(&actor);
  kiosk.place(personal.borrow(), actor);
  let randomness = scenario.take_shared<random::Random>();
  let version = scenario.take_shared<version::Version>();
  let mut count = 0u64;
  while (count < 8) {
    api::scribe_rune(&mut kiosk, &personal, actor_id, gear_id,
      if (case == ScribeCase::WrongGear) &other else &template, rune_id, 9,
      if (case == ScribeCase::WrongTier) 2 else 1, &protected, &randomness, &version, scenario.ctx());
    count = count + 1;
  };
  assert!(!kiosk.has_item(rune_id), 0);
  assert!(kiosk.borrow<item::Item>(personal.borrow(), gear_id).stats().critical() > item_stats::shift(), 1);
  assert!(event::events_by_type<forgemagie::RuneScribed>().length() == 8, 2);
  character::destroy(kiosk.take<character::Character>(personal.borrow(), actor_id));
  transfer::public_share_object(kiosk);
  personal_kiosk::transfer_to_sender(personal, scenario.ctx());
  test_scenario::return_shared(randomness);
  test_scenario::return_shared(version);
  protected_policy::destroy_for_testing(protected, scenario.ctx());
  transfer_policy::destroy_and_withdraw(policy, policy_cap, scenario.ctx()).into_balance().destroy_zero();
  item_rows::destroy_for_testing(template);
  item_rows::destroy_for_testing(other);
  item_rows::destroy_for_testing(rune_template);
  registry::destroy_for_testing(root);
  admin::destroy_for_testing(admin);
  publisher.burn();
  scenario.end();
}

#[test]
fun public_scribe_burns_one_rune_per_result_and_advances_supported_capped_stats() { scribe(ScribeCase::Success); }

#[test, expected_failure(abort_code = 2703, location = aresrpg::forgemagie)]
fun existing_capped_stats_still_refuse_their_limit() { scribe(ScribeCase::Capped); }

#[test, expected_failure(abort_code = 2704, location = aresrpg::forgemagie)]
fun another_gear_template_cannot_authorize_scribing() { scribe(ScribeCase::WrongGear); }

#[test, expected_failure(abort_code = 2704, location = aresrpg::forgemagie)]
fun scribing_requires_a_rolled_stat_block() { scribe(ScribeCase::NoStats); }

#[test, expected_failure(abort_code = 2705, location = aresrpg::forgemagie)]
fun scribing_requires_a_gear_profession() { scribe(ScribeCase::NoJob); }

#[test, expected_failure(abort_code = 2711, location = aresrpg::forgemagie)]
fun unsupported_rune_tiers_are_rejected_before_the_roll() { scribe(ScribeCase::WrongTier); }
