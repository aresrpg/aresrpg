// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

#[test_only]
module aresrpg::forgemagie_tests;

use aresrpg::{character, forgemagie};

#[test]
fun natural_ap_can_be_lost_and_restored_repeatedly_through_kiosk_custody() {
  use aresrpg::{item, protected_policy};
  use aresrpg_control::admin;
  use aresrpg_math::item_stats;
  use aresrpg_seed::{item_rows, registry};
  use sui::{kiosk, package::Publisher, random, test_scenario};

  let mut scenario = test_scenario::begin(@0xA11CE);
  item::test_init(scenario.ctx());
  scenario.next_tx(@0xA11CE);
  let publisher = scenario.take_from_sender<Publisher>();
  let protected = protected_policy::for_testing<item::Item>(&publisher, scenario.ctx());
  let (mut kiosk, kiosk_cap) = kiosk::new(scenario.ctx());
  let cap = admin::cap_for_testing(scenario.ctx());
  let mut root = registry::registry_for_testing(scenario.ctx());
  let mut gear_template = item_rows::template_for_testing(b"scribe_sword".to_string(), b"sword".to_string(), scenario.ctx());
  let center = item_stats::shift();
  let maximum = item_stats::new(
    center, center, center + 1000, center, center, center, center, center,
    center + 1, center, center, center, center, center, center,
  );
  item_rows::set_stats(&cap, &mut root, &mut gear_template, item_stats::zero(), maximum, scenario.ctx());
  let rune_template = item_rows::template_for_testing(b"rune_strength_ra".to_string(), b"rune".to_string(), scenario.ctx());
  let ap_template = item_rows::template_for_testing(b"rune_action_ba".to_string(), b"rune".to_string(), scenario.ctx());
  let mut generator = random::new_generator_from_seed_for_testing(b"repeat-ap-repairs");
  let mut gear = item::mint(&gear_template, 1, &mut generator, scenario.ctx());
  let initial = item_stats::new(
    center, center, center, center, center, center, center, center,
    center + 1, center, center, center, center, center, center,
  );
  item::set_stats(&mut gear, initial, 0);
  let gear_id = object::id(&gear);
  let rune = item::mint(&rune_template, 256, &mut generator, scenario.ctx());
  let rune_id = object::id(&rune);
  let ap_runes = item::mint(&ap_template, 256, &mut generator, scenario.ctx());
  let ap_id = object::id(&ap_runes);
  let character = character::test_character(b"senshi".to_string(), 1, 0, scenario.ctx());
  let character_id = object::id(&character);
  kiosk.place(&kiosk_cap, character);
  kiosk.place(&kiosk_cap, gear);
  kiosk.place(&kiosk_cap, rune);
  kiosk.place(&kiosk_cap, ap_runes);
  let mut restorations = 0u64;
  let mut attempts = 0u64;
  while (restorations < 6 && attempts < 256) {
    let has_ap = item::stats(kiosk.borrow<item::Item>(&kiosk_cap, gear_id)).action() == center + 1;
    let (selected_rune, stat, tier) = if (has_ap) (rune_id, 2u8, 3u8) else (ap_id, 8u8, 1u8);
    forgemagie::scribe(&mut kiosk, &kiosk_cap, character_id, gear_id, &gear_template, selected_rune, stat, tier, &protected, &mut generator, scenario.ctx());
    let restored = item::stats(kiosk.borrow<item::Item>(&kiosk_cap, gear_id)).action() == center + 1;
    if (!has_ap && restored) restorations = restorations + 1;
    attempts = attempts + 1;
  };
  assert!(restorations == 6, 0);
  character::destroy(kiosk.take(&kiosk_cap, character_id));
  item::destroy_for_testing(kiosk.take(&kiosk_cap, gear_id));
  item::destroy_for_testing(kiosk.take(&kiosk_cap, rune_id));
  item::destroy_for_testing(kiosk.take(&kiosk_cap, ap_id));
  kiosk::close_and_withdraw(kiosk, kiosk_cap, scenario.ctx()).into_balance().destroy_zero();
  protected_policy::destroy_for_testing(protected, scenario.ctx());
  item_rows::destroy_for_testing(gear_template);
  item_rows::destroy_for_testing(rune_template);
  item_rows::destroy_for_testing(ap_template);
  registry::destroy_for_testing(root);
  admin::destroy_for_testing(cap);
  publisher.burn();
  scenario.end();
}

#[test]
fun a_fresh_character_can_runeforge_every_gear_profession() {
  let mut ctx = tx_context::dummy();
  let character = character::test_character(b"senshi".to_string(), 1, 0, &mut ctx);
  let categories = vector[
    b"sword".to_string(), b"bow".to_string(), b"hat".to_string(),
    b"belt".to_string(), b"ring".to_string(), b"amulet".to_string(),
  ];
  let mut index = 0;
  while (index < categories.length()) {
    forgemagie::assert_scribe_job_for_testing(&character, categories[index]);
    index = index + 1;
  };
  character::destroy(character);
}

#[test]
fun stat_bearing_crafted_gear_is_crushable() {
  forgemagie::assert_crushable_for_testing(b"sword".to_string(), true);
}

#[test]
fun caller_coordinates_may_name_the_exact_owned_rune() {
  forgemagie::assert_rune_identity_for_testing(b"rune_agility_ba".to_string(), 5, 1);
}

#[test]
#[expected_failure(abort_code = 2711, location = aresrpg::forgemagie)]
fun caller_coordinates_cannot_relabel_a_rune() {
  forgemagie::assert_rune_identity_for_testing(b"rune_agility_ba".to_string(), 2, 3);
  abort 999
}

#[test]
#[expected_failure(abort_code = 2705, location = aresrpg::forgemagie)]
fun a_pet_is_not_gear_and_cannot_be_crushed() {
  forgemagie::assert_crushable_for_testing(b"pet".to_string(), true);
  abort 999
}

#[test]
#[expected_failure(abort_code = 2705, location = aresrpg::forgemagie)]
fun a_stackable_key_is_not_gear_even_if_bad_content_gave_it_stats() {
  forgemagie::assert_crushable_for_testing(b"key".to_string(), true);
  abort 999
}

#[test]
fun scribing_tracks_only_puits_without_banking_profession_experience() {
  use aresrpg::{item, progression, protected_policy};
  use aresrpg_control::admin;
  use aresrpg_math::item_stats;
  use aresrpg_seed::{item_rows, registry};
  use sui::{kiosk, package::Publisher, random, test_scenario};

  let mut scenario = test_scenario::begin(@0xA11CE);
  item::test_init(scenario.ctx());
  scenario.next_tx(@0xA11CE);
  let publisher = scenario.take_from_sender<Publisher>();
  let protected = protected_policy::for_testing<item::Item>(&publisher, scenario.ctx());
  let (mut kiosk, kiosk_cap) = kiosk::new(scenario.ctx());
  let cap = admin::cap_for_testing(scenario.ctx());
  let mut root = registry::registry_for_testing(scenario.ctx());
  let mut gear_template = item_rows::template_for_testing(b"scribe_sword".to_string(), b"sword".to_string(), scenario.ctx());
  let center = item_stats::shift();
  let maximum = item_stats::new(
    center + 1000, center, center, center, center, center, center, center,
    center, center, center, center, center, center, center,
  );
  item_rows::set_stats(&cap, &mut root, &mut gear_template, item_stats::zero(), maximum, scenario.ctx());
  let rune_template = item_rows::template_for_testing(b"rune_vitality_ba".to_string(), b"rune".to_string(), scenario.ctx());
  let mut generator = random::new_generator_from_seed_for_testing(b"no-scribe-xp");
  let mut gear = item::mint(&gear_template, 1, &mut generator, scenario.ctx());
  item::set_stats(&mut gear, item_stats::zero(), 0);
  let gear_id = object::id(&gear);
  let rune = item::mint(&rune_template, 16, &mut generator, scenario.ctx());
  let rune_id = object::id(&rune);
  let mut character = character::test_character(b"senshi".to_string(), 1, 0, scenario.ctx());
  progression::bank_job_xp(&mut character, b"FORGER".to_string(), 123);
  let character_id = object::id(&character);
  kiosk.place(&kiosk_cap, character);
  kiosk.place(&kiosk_cap, gear);
  kiosk.place(&kiosk_cap, rune);
  let mut attempts = 0u64;
  let mut unchanged = false;
  while (attempts < 16) {
    let gear: &item::Item = kiosk.borrow(&kiosk_cap, gear_id);
    let before = item::rolled_state_bytes_for_testing(gear);
    let before_stats = item::stats(gear);
    forgemagie::scribe(&mut kiosk, &kiosk_cap, character_id, gear_id, &gear_template, rune_id, 0, 1, &protected, &mut generator, scenario.ctx());
    let gear: &item::Item = kiosk.borrow(&kiosk_cap, gear_id);
    let after = item::rolled_state_bytes_for_testing(gear);
    assert!(before != after, 4);
    unchanged = unchanged || item::stats(gear) == before_stats;
    attempts = attempts + 1;
  };
  assert!(unchanged, 5);
  let gear: &item::Item = kiosk.borrow(&kiosk_cap, gear_id);
  assert!(item::puits(gear) == 0, 3);
  assert!(item::stats(gear).vitality() > center, 1); // At least one successful application exercised the old banking branch.
  let character: &character::Character = kiosk.borrow(&kiosk_cap, character_id);
  assert!(progression::job_xp_of(character, b"FORGER".to_string()) == 123, 2);
  character::destroy(kiosk.take(&kiosk_cap, character_id));
  item::destroy_for_testing(kiosk.take(&kiosk_cap, gear_id));
  kiosk::close_and_withdraw(kiosk, kiosk_cap, scenario.ctx()).into_balance().destroy_zero();
  protected_policy::destroy_for_testing(protected, scenario.ctx());
  item_rows::destroy_for_testing(gear_template);
  item_rows::destroy_for_testing(rune_template);
  registry::destroy_for_testing(root);
  admin::destroy_for_testing(cap);
  publisher.burn();
  scenario.end();
}
