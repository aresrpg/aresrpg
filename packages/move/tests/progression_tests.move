// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
#[test_only]
module aresrpg::progression_tests;

use aresrpg::{api, character::{Self, Character}, progression, version::{Self, Version}};
use aresrpg_control::admin;
use aresrpg_math::spell_effect;
use aresrpg_seed::{registry, spell_rows::{Self, SpellTemplate}};
use kiosk::personal_kiosk::{Self, PersonalKioskCap};
use sui::{clock, kiosk::{Self, Kiosk}, test_scenario::{Self, Scenario}};

const OWNER: address = @0xA11CE;

public struct Fixture {
  scenario: Scenario,
  version: Version,
  primary: SpellTemplate,
  secondary: SpellTemplate,
  kiosk: Kiosk,
  personal: PersonalKioskCap,
  character: ID,
}

fun publish_spell(scenario: &mut Scenario, name: vector<u8>, unlock: u8) {
  let cap = admin::cap_for_testing(scenario.ctx());
  let mut root = registry::registry_for_testing(scenario.ctx());
  let level = spell_effect::new_spell_level(1, 0, 1, false, false, false, false, 0, 0, 0, 0,
    vector[spell_effect::new_effect(0, b"earth".to_string(), 1, 1, 0, 0, 1, 10000, 0, 0)], vector[]);
  spell_rows::add_spell(&cap, &mut root, name.to_string(), b"senshi".to_string(), unlock,
    vector::tabulate!(6, |_| level), scenario.ctx());
  registry::destroy_for_testing(root);
  admin::destroy_for_testing(cap);
}

fun fixture(unlock: u8, xp: u64): Fixture {
  let mut scenario = test_scenario::begin(OWNER);
  version::test_init(scenario.ctx());
  publish_spell(&mut scenario, b"first_spell", unlock);
  scenario.next_tx(OWNER);
  let primary = scenario.take_shared<SpellTemplate>();
  let primary_id = object::id(&primary);
  test_scenario::return_shared(primary);
  publish_spell(&mut scenario, b"second_spell", 1);
  scenario.next_tx(OWNER);
  let primary = scenario.take_shared_by_id<SpellTemplate>(primary_id);
  let secondary = scenario.take_shared<SpellTemplate>();
  let version = scenario.take_shared<Version>();
  let mut character = character::test_character(b"senshi".to_string(), 1, 0, scenario.ctx());
  character::add_experience(&mut character, xp);
  let character_id = object::id(&character);
  let (mut kiosk, cap) = kiosk::new(scenario.ctx());
  let personal = personal_kiosk::new(&mut kiosk, cap, scenario.ctx());
  kiosk.place(personal_kiosk::borrow(&personal), character);
  Fixture { scenario, version, primary, secondary, kiosk, personal, character: character_id }
}

fun finish(fixture: Fixture) {
  let Fixture { mut scenario, version, primary, secondary, mut kiosk, personal, character } = fixture;
  character::destroy(kiosk.take<Character>(personal_kiosk::borrow(&personal), character));
  test_scenario::return_shared(version);
  test_scenario::return_shared(primary);
  test_scenario::return_shared(secondary);
  transfer::public_share_object(kiosk);
  personal_kiosk::transfer_to_sender(personal, scenario.ctx());
  scenario.end();
}

#[test]
fun spell_investment_costs_and_reset_use_the_public_kiosk_door() {
  let Fixture { scenario, version, primary, secondary, mut kiosk, personal, character: character_id } = fixture(1, 75_000);
  let cap = personal_kiosk::borrow(&personal);
  let character = kiosk.borrow_mut<Character>(cap, character_id);
  assert!(character.available_spell_points() == 15);
  progression::reset_spells(character);
  assert!(progression::spell_level(character, &primary) == 1);
  api::raise_spell(&mut kiosk, cap, character_id, &primary, &version);
  assert!(kiosk.borrow<Character>(cap, character_id).available_spell_points() == 14);
  assert!(progression::spell_level(kiosk.borrow<Character>(cap, character_id), &secondary) == 1);
  api::raise_spell(&mut kiosk, cap, character_id, &secondary, &version);
  api::raise_spell(&mut kiosk, cap, character_id, &primary, &version);
  let character = kiosk.borrow_mut<Character>(cap, character_id);
  assert!(progression::spell_level(character, &primary) == 3 && character.available_spell_points() == 11);
  progression::reset_spells(character);
  assert!(character.available_spell_points() == 15);
  assert!(progression::spell_level(character, &primary) == 1 && progression::spell_level(character, &secondary) == 1);
  finish(Fixture { scenario, version, primary, secondary, kiosk, personal, character: character_id });
}

#[test, expected_failure(abort_code = 1601, location = aresrpg::progression)]
fun an_unlearned_spell_cannot_receive_points() {
  let Fixture { scenario, version, primary, secondary, mut kiosk, personal, character: character_id } = fixture(2, 0);
  let cap = personal_kiosk::borrow(&personal);
  assert!(progression::spell_level(kiosk.borrow<Character>(cap, character_id), &primary) == 0);
  api::raise_spell(&mut kiosk, cap, character_id, &primary, &version);
  finish(Fixture { scenario, version, primary, secondary, kiosk, personal, character: character_id });
}
#[test, expected_failure(abort_code = 1603, location = aresrpg::progression)]
fun an_unfunded_spell_raise_cannot_mutate_the_book() {
  let Fixture { scenario, version, primary, secondary, mut kiosk, personal, character: character_id } = fixture(1, 0);
  api::raise_spell(&mut kiosk, personal_kiosk::borrow(&personal), character_id, &primary, &version);
  finish(Fixture { scenario, version, primary, secondary, kiosk, personal, character: character_id });
}
#[test, expected_failure(abort_code = 1602, location = aresrpg::progression)]
fun six_ranks_exhaust_fifteen_points_and_cannot_raise_further() {
  let Fixture { scenario, version, primary, secondary, mut kiosk, personal, character: character_id } = fixture(1, 75_000);
  let cap = personal_kiosk::borrow(&personal);
  let mut rank = 1u64;
  while (rank < 6) {
    api::raise_spell(&mut kiosk, cap, character_id, &primary, &version);
    rank = rank + 1;
  };
  let character = kiosk.borrow<Character>(cap, character_id);
  assert!(progression::spell_level(character, &primary) == 6 && character.available_spell_points() == 0);
  api::raise_spell(&mut kiosk, cap, character_id, &primary, &version);
  finish(Fixture { scenario, version, primary, secondary, kiosk, personal, character: character_id });
}

#[test]
fun lazy_hp_banks_whole_ticks_clamps_healing_and_never_subtracts_on_old_time() {
  let mut ctx = tx_context::dummy();
  let mut clock = clock::create_for_testing(&mut ctx);
  let mut character = character::test_character(b"senshi".to_string(), 1, 0, &mut ctx);
  assert!(progression::max_hp(&character) == 55 && progression::touch(&mut character, &clock) == 55);
  clock::set_for_testing(&mut clock, 1000);
  progression::set_hp(&mut character, 5, &clock);
  clock::set_for_testing(&mut clock, 1500);
  assert!(progression::touch(&mut character, &clock) == 5);
  clock::set_for_testing(&mut clock, 2100);
  assert!(progression::touch(&mut character, &clock) == 6);
  clock::set_for_testing(&mut clock, 3000);
  assert!(progression::touch(&mut character, &clock) == 7);
  progression::heal(&mut character, 3, &clock);
  assert!(progression::touch(&mut character, &clock) == 10);
  let mut older_clock = clock::create_for_testing(&mut ctx);
  clock::set_for_testing(&mut older_clock, 2000);
  assert!(progression::touch(&mut character, &older_clock) == 10);
  clock::destroy_for_testing(older_clock);
  progression::heal(&mut character, 1000, &clock);
  assert!(progression::touch(&mut character, &clock) == 55);
  clock::set_for_testing(&mut clock, 100_000);
  assert!(progression::touch(&mut character, &clock) == 55);
  character::add_experience(&mut character, 110);
  character::raise_stat(&mut character, b"vitality".to_string(), 5);
  assert!(progression::max_hp(&character) == 65);
  character::destroy(character);
  let mut fresh = character::test_character(b"senshi".to_string(), 1, 0, &mut ctx);
  progression::set_hp(&mut fresh, 1, &clock);
  assert!(progression::touch(&mut fresh, &clock) == 1);
  character::destroy(fresh);
  clock::destroy_for_testing(clock);
}

#[test]
fun job_xp_is_additive_independent_and_capped_by_the_native_level_curve() {
  let mut ctx = tx_context::dummy();
  let mut character = character::test_character(b"senshi".to_string(), 1, 0, &mut ctx);
  let farmer = b"FARMER".to_string();
  let baker = b"BAKER".to_string();
  assert!(progression::job_xp_of(&character, farmer) == 0 && progression::job_level_of(&character, farmer) == 1);
  progression::bank_job_xp(&mut character, farmer, 100);
  progression::bank_job_xp(&mut character, farmer, 581_587);
  assert!(progression::job_xp_of(&character, farmer) == 581_687);
  assert!(progression::job_level_of(&character, farmer) == 100);
  assert!(progression::job_xp_of(&character, baker) == 0);
  character::destroy(character);
}

#[test]
fun character_level_ups_restore_new_maximum_hp_but_other_xp_does_not() {
  let mut ctx = tx_context::dummy();
  let mut clock = clock::create_for_testing(&mut ctx);
  let mut character = character::test_character(b"senshi".to_string(), 1, 10, &mut ctx);
  character::raise_stat(&mut character, b"vitality".to_string(), 7);
  progression::set_hp(&mut character, 3, &clock);
  progression::award_experience(&mut character, 109, &clock);
  assert!(character.level() == 1 && progression::touch(&mut character, &clock) == 3);
  clock::set_for_testing(&mut clock, 250);
  progression::award_experience(&mut character, 1, &clock);
  assert!(character.level() == 2 && progression::touch(&mut character, &clock) == 67);
  progression::set_hp(&mut character, 1, &clock);
  progression::award_experience(&mut character, 75_000, &clock);
  assert!(character.level() > 3);
  let full_hp = progression::max_hp(&character);
  assert!(progression::touch(&mut character, &clock) == full_hp);
  progression::set_hp(&mut character, 3, &clock);
  progression::award_experience(&mut character, 0, &clock);
  assert!(progression::touch(&mut character, &clock) == 3);
  progression::bank_job_xp(&mut character, b"FARMER".to_string(), 1_000);
  assert!(progression::job_level_of(&character, b"FARMER".to_string()) > 1);
  assert!(progression::touch(&mut character, &clock) == 3);
  character::destroy(character);
  clock::destroy_for_testing(clock);
}
