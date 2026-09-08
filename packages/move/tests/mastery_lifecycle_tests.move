// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
#[test_only]
module aresrpg::mastery_lifecycle_tests;

use aresrpg::{api, character, mastery, party, version};
use aresrpg_control::admin;
use aresrpg_math::{city_map, item_stats};
use aresrpg_seed::{item_rows, registry, world_content};
use kiosk::personal_kiosk;
use sui::{clock, event, kiosk, random, test_scenario};

const OWNER: address = @0xA;
public enum Variant has copy, drop { NextDay, SameDay, DuplicateFirst, WrongOwner, TooLow, NoCity }

fun assignment(variant: Variant) {
  let mut scenario = test_scenario::begin(@0x0);
  version::test_init(scenario.ctx());
  random::create_for_testing(scenario.ctx());
  scenario.next_epoch(OWNER);
  let admin = admin::cap_for_testing(scenario.ctx());
  let mut root = registry::registry_for_testing(scenario.ctx());
  let mut content = world_content::create(&admin, &mut root, b"nauvis".to_string(), 50, scenario.ctx());
  if (variant != Variant::NoCity) world_content::set_cities(&admin, &mut root, &mut content,
    vector[city_map::new_city(b"town".to_string(), 50_000, 50_000, object::id_from_address(@0xD))], scenario.ctx());
  let mut registry = party::registry_for_testing(scenario.ctx());
  let clock = clock::create_for_testing(scenario.ctx());
  let (mut kiosk, cap) = kiosk::new(scenario.ctx());
  let personal = personal_kiosk::new(&mut kiosk, cap, scenario.ctx());
  let actor = character::test_character(b"senshi".to_string(), if (variant == Variant::TooLow) 1 else 50, 0, scenario.ctx());
  let id = object::id(&actor);
  kiosk.place(personal.borrow(), actor);
  world_content::share(content);
  transfer::public_share_object(kiosk);
  personal_kiosk::transfer_to_sender(personal, scenario.ctx());
  scenario.next_tx(OWNER);
  let content = scenario.take_shared<world_content::WorldContent>();
  let mut kiosk = scenario.take_shared<kiosk::Kiosk>();
  let personal = scenario.take_from_sender<personal_kiosk::PersonalKioskCap>();
  let version = scenario.take_shared<version::Version>();
  let randomness = scenario.take_shared<random::Random>();
  api::start_first_daily_quest(&mut registry, &content, &kiosk, &personal, id, &randomness, &version, &clock, scenario.ctx());
  assert!(event::events_by_type<mastery::MasteryUpdated>().length() == 1, 0);
  if (variant == Variant::DuplicateFirst)
    api::start_first_daily_quest(&mut registry, &content, &kiosk, &personal, id, &randomness, &version, &clock, scenario.ctx());
  test_scenario::return_shared(version);
  test_scenario::return_shared(randomness);
  scenario.next_tx(OWNER);
  let mut daily = scenario.take_from_sender<mastery::Mastery>();
  assert!(mastery::points_for_testing(&daily) == 0, 1);
  if (variant == Variant::NextDay) { scenario.next_epoch(OWNER); };
  if (variant == Variant::WrongOwner) { scenario.next_epoch(@0xB); };
  let version = scenario.take_shared<version::Version>();
  let randomness = scenario.take_shared<random::Random>();
  api::start_daily_quest(&mut daily, &content, &kiosk, &personal, id, &randomness, &version, &clock, scenario.ctx());
  assert!(mastery::points_for_testing(&daily) == 0, 2);
  assert!(event::events_by_type<mastery::MasteryUpdated>().length() == 1, 3);
  mastery::destroy_for_testing(daily);
  character::destroy(kiosk.take<character::Character>(personal.borrow(), id));
  test_scenario::return_shared(kiosk);
  personal_kiosk::transfer_to_sender(personal, scenario.ctx());
  test_scenario::return_shared(version);
  test_scenario::return_shared(randomness);
  test_scenario::return_shared(content);
  party::destroy_registry_for_testing(registry);
  registry::destroy_for_testing(root);
  admin::destroy_for_testing(admin);
  clock.destroy_for_testing();
  scenario.end();
}

#[test]
fun daily_assignment_persists_and_can_be_replaced_only_next_epoch() { assignment(Variant::NextDay); }

#[test, expected_failure(abort_code = 3103, location = aresrpg::mastery)]
fun same_day_assignment_cannot_be_rerolled() { assignment(Variant::SameDay); }

#[test, expected_failure(abort_code = 3101, location = aresrpg::mastery)]
fun the_sender_cannot_create_a_second_mastery() { assignment(Variant::DuplicateFirst); }

#[test, expected_failure(abort_code = 3102, location = aresrpg::mastery)]
fun another_sender_cannot_replace_the_owners_quest() { assignment(Variant::WrongOwner); }

#[test, expected_failure(abort_code = 3105, location = aresrpg::mastery)]
fun a_character_below_world_entry_level_cannot_take_its_quest() { assignment(Variant::TooLow); }

#[test, expected_failure(abort_code = 3104, location = aresrpg::mastery)]
fun a_world_without_city_dungeons_cannot_assign_a_quest() { assignment(Variant::NoCity); }

#[test, expected_failure(abort_code = 3110, location = aresrpg::mastery)]
fun a_mastery_offer_cannot_mint_random_stat_gear() {
  let mut scenario = test_scenario::begin(OWNER);
  let admin = admin::cap_for_testing(scenario.ctx());
  let mut root = registry::registry_for_testing(scenario.ctx());
  let mut template = item_rows::template_for_testing(b"hat".to_string(), b"hat".to_string(), scenario.ctx());
  item_rows::set_stats(&admin, &mut root, &mut template, item_stats::zero(), item_stats::zero(), scenario.ctx());
  mastery::new_offer(&admin, &mut root, &template, 1, true, scenario.ctx());
  abort 999
}
