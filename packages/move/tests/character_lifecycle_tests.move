// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
#[test_only]
module aresrpg::character_lifecycle_tests;

use aresrpg::{api, character::{Self, Character, NameRegistry}, version::{Self, Version}};
use kiosk::personal_kiosk;
use sui::{coin::{Self, Coin}, kiosk, sui::SUI, test_scenario};

const OWNER: address = @0xA11CE;

#[test]
fun paid_names_are_normalized_reserved_and_delivered_to_the_treasury() {
  let mut scenario = test_scenario::begin(OWNER);
  character::test_init(scenario.ctx());
  scenario.next_tx(OWNER);
  let mut registry = scenario.take_shared<NameRegistry>();
  let expected = character::test_derived_address(&registry, b"luna".to_string());
  let payment = coin::mint_for_testing<SUI>(1_000_000_000, scenario.ctx());
  let first = character::create_character(&mut registry, payment, b"LuNa".to_string(), b"senshi".to_string(), true,
    0, 16777215, 123, scenario.ctx());
  assert!(object::id_address(&first) == expected);
  assert!(first.name() == b"luna".to_string() && first.classe() == b"senshi".to_string());
  assert!(first.level() == 1 && first.available_points() == 0 && first.available_spell_points() == 0);
  character::destroy(first);
  assert!(character::test_name_exists(&registry, b"luna".to_string()));
  test_scenario::return_shared(registry);
  scenario.next_tx(@treasury);
  let proceeds = scenario.take_from_sender<Coin<SUI>>();
  assert!(proceeds.value() == 1_000_000_000);
  coin::burn_for_testing(proceeds);
  let mut registry = scenario.take_shared<NameRegistry>();
  let payment = coin::mint_for_testing<SUI>(1_000_000_000, scenario.ctx());
  let female = character::create_character(&mut registry, payment, b"nineteen_characters".to_string(), b"ikari".to_string(), false,
    1, 2, 3, scenario.ctx());
  assert!(female.name() == b"nineteen_characters".to_string());
  character::destroy(female);
  test_scenario::return_shared(registry);
  scenario.end();
}

#[test]
fun earned_levels_allocate_all_six_stats_through_the_kiosk_api_and_reset_exactly() {
  let mut scenario = test_scenario::begin(OWNER);
  version::test_init(scenario.ctx());
  scenario.next_tx(OWNER);
  let version = scenario.take_shared<Version>();
  let mut character = character::test_character(b"senshi".to_string(), 1, 0, scenario.ctx());
  character::add_experience(&mut character, 650);
  assert!(character.level() == 3 && character.available_points() == 10 && character.available_spell_points() == 2);
  character::add_experience(&mut character, 1);
  assert!(character.level() == 3 && character.available_points() == 10);
  let id = object::id(&character);
  let (mut kiosk, cap) = kiosk::new(scenario.ctx());
  let personal = personal_kiosk::new(&mut kiosk, cap, scenario.ctx());
  let cap = personal_kiosk::borrow(&personal);
  character::assert_personal_custody(&kiosk);
  kiosk.place(cap, character);
  api::raise_stat(&mut kiosk, cap, id, b"vitality".to_string(), 1, &version);
  api::raise_stat(&mut kiosk, cap, id, b"wisdom".to_string(), 3, &version);
  api::raise_stat(&mut kiosk, cap, id, b"strength".to_string(), 1, &version);
  api::raise_stat(&mut kiosk, cap, id, b"intelligence".to_string(), 1, &version);
  api::raise_stat(&mut kiosk, cap, id, b"chance".to_string(), 1, &version);
  api::raise_stat(&mut kiosk, cap, id, b"agility".to_string(), 1, &version);
  let mut character = kiosk.take<Character>(cap, id);
  assert!(character.vitality() == 1 && character.wisdom() == 1);
  assert!(character.strength() == 1 && character.intelligence() == 1 && character.chance() == 1 && character.agility() == 1);
  assert!(character.available_points() == 2);
  character::reset_stats(&mut character);
  assert!(character.available_points() == 10);
  assert!(character.vitality() == 0 && character.wisdom() == 0 && character.strength() == 0);
  assert!(character.intelligence() == 0 && character.chance() == 0 && character.agility() == 0);
  character::destroy(character);
  transfer::public_share_object(kiosk);
  personal_kiosk::transfer_to_sender(personal, scenario.ctx());
  test_scenario::return_shared(version);
  scenario.end();
}

fun invalid_mint(payment: u64, name: vector<u8>, classe: vector<u8>, colors: vector<u32>) {
  let mut ctx = tx_context::dummy();
  let mut registry = character::test_registry(&mut ctx);
  let coin = coin::mint_for_testing<SUI>(payment, &mut ctx);
  let character = character::create_character(&mut registry, coin, name.to_string(), classe.to_string(), true,
    colors[0], colors[1], colors[2], &ctx);
  character::destroy(character);
  std::unit_test::destroy(registry);
}

#[test, expected_failure(abort_code = 105, location = aresrpg::character)]
fun mint_rejects_wrong_payment() { invalid_mint(999_999_999, b"valid", b"senshi", vector[0, 0, 0]); }
#[test, expected_failure(abort_code = 103, location = aresrpg::character)]
fun mint_rejects_unknown_class() { invalid_mint(1_000_000_000, b"valid", b"mage", vector[0, 0, 0]); }
#[test, expected_failure(abort_code = 102, location = aresrpg::character)]
fun mint_rejects_short_name() { invalid_mint(1_000_000_000, b"abc", b"senshi", vector[0, 0, 0]); }
#[test, expected_failure(abort_code = 102, location = aresrpg::character)]
fun mint_rejects_long_name() { invalid_mint(1_000_000_000, b"abcdefghijklmnopqrst", b"senshi", vector[0, 0, 0]); }
#[test, expected_failure(abort_code = 102, location = aresrpg::character)]
fun mint_rejects_control_bytes() { invalid_mint(1_000_000_000, b"bad\nname", b"senshi", vector[0, 0, 0]); }
#[test, expected_failure(abort_code = 104, location = aresrpg::character)]
fun mint_rejects_first_color_overflow() { invalid_mint(1_000_000_000, b"valid", b"senshi", vector[16777216, 0, 0]); }
#[test, expected_failure(abort_code = 104, location = aresrpg::character)]
fun mint_rejects_second_color_overflow() { invalid_mint(1_000_000_000, b"valid", b"senshi", vector[0, 16777216, 0]); }
#[test, expected_failure(abort_code = 104, location = aresrpg::character)]
fun mint_rejects_third_color_overflow() { invalid_mint(1_000_000_000, b"valid", b"senshi", vector[0, 0, 16777216]); }

#[test, expected_failure(abort_code = sui::derived_object::EObjectAlreadyExists)]
fun deleting_a_paid_character_never_releases_its_name() {
  let mut ctx = tx_context::dummy();
  let mut registry = character::test_registry(&mut ctx);
  let first = character::create_character(&mut registry, coin::mint_for_testing<SUI>(1_000_000_000, &mut ctx),
    b"reserved".to_string(), b"senshi".to_string(), true, 0, 0, 0, &ctx);
  character::destroy(first);
  let second = character::create_character(&mut registry, coin::mint_for_testing<SUI>(1_000_000_000, &mut ctx),
    b"RESERVED".to_string(), b"senshi".to_string(), false, 0, 0, 0, &ctx);
  character::destroy(second);
  std::unit_test::destroy(registry);
}

fun invalid_stat(stat: vector<u8>, points: u16) {
  let mut ctx = tx_context::dummy();
  let mut character = character::test_character(b"senshi".to_string(), 2, 5, &mut ctx);
  character::raise_stat(&mut character, stat.to_string(), points);
  character::destroy(character);
}
#[test, expected_failure(abort_code = 109, location = aresrpg::character)]
fun stat_spend_must_be_positive() { invalid_stat(b"vitality", 0); }
#[test, expected_failure(abort_code = 106, location = aresrpg::character)]
fun stat_spend_cannot_exceed_capital() { invalid_stat(b"vitality", 6); }
#[test, expected_failure(abort_code = 107, location = aresrpg::character)]
fun unknown_stat_is_refused() { invalid_stat(b"luck", 1); }

#[test, expected_failure(abort_code = 108, location = aresrpg::character)]
fun ordinary_kiosk_cannot_carry_character_custody() {
  let mut ctx = tx_context::dummy();
  let (kiosk, cap) = kiosk::new(&mut ctx);
  character::assert_personal_custody(&kiosk);
  coin::burn_for_testing(kiosk.close_and_withdraw(cap, &mut ctx));
}
