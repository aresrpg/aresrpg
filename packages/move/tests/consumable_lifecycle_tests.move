// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
#[test_only]
module aresrpg::consumable_lifecycle_tests;

use aresrpg::{api, character::{Self, Character}, dungeon, item::{Self, Item}, progression, protected_policy, version, world};
use aresrpg_control::admin;
use aresrpg_math::{city_map, consumable_effect, dungeon_data, spell_effect};
use aresrpg_seed::{dungeon_content, item_rows, registry, spell_rows, world_content};
use sui::{clock, kiosk, package::Publisher, random, test_scenario, transfer_policy};

const OWNER: address = @0xA11CE;
public enum Case has copy, drop { Heal, Stats, Spells, Recall, City, Rooted, WrongTemplate, MissingEffect, LootBox, CityPlain, PlainCity }

fun run(case: Case, between_rooms: bool) {
  let mut scenario = test_scenario::begin(OWNER);
  item::test_init(scenario.ctx());
  version::test_init(scenario.ctx());
  let admin = admin::cap_for_testing(scenario.ctx());
  let mut root = registry::registry_for_testing(scenario.ctx());
  let level = spell_effect::new_spell_level(1, 0, 1, false, false, false, false, 0, 0, 0, 0, vector[], vector[]);
  spell_rows::add_spell(&admin, &mut root, b"reset_subject".to_string(), b"senshi".to_string(), 1,
    vector::tabulate!(6, |_| level), scenario.ctx());
  if (between_rooms) dungeon_content::add(&admin, &mut root, b"nest".to_string(),
    dungeon_data::new_dungeon(b"key".to_string(), vector[
      dungeon_data::new_room(vector[dungeon_data::new_room_mob(b"guard".to_string())]),
    ]), scenario.ctx());
  scenario.next_tx(OWNER);
  let dungeon_id = if (between_rooms) {
    let content = scenario.take_shared<dungeon_content::DungeonContent>();
    let id = object::id(&content);
    test_scenario::return_shared(content);
    id
  } else object::id_from_address(@0xD);
  let publisher = scenario.take_from_sender<Publisher>();
  let (policy, policy_cap) = transfer_policy::new<Item>(&publisher, scenario.ctx());
  let protected = protected_policy::for_testing<Item>(&publisher, scenario.ctx());
  publisher.burn();
  let mut content = world_content::create(&admin, &mut root, b"nauvis".to_string(), 1, scenario.ctx());
  world_content::set_cities(&admin, &mut root, &mut content,
    vector[city_map::new_city(b"thebes".to_string(), 50_512, 50_000, dungeon_id)], scenario.ctx());
  if (between_rooms) world::create(&admin, &mut root, &content, scenario.ctx());
  let mut template = item_rows::template_for_testing(b"potion".to_string(), b"consumable".to_string(), scenario.ctx());
  let wrong = item_rows::template_for_testing(b"other".to_string(), b"consumable".to_string(), scenario.ctx());
  let key_template = item_rows::template_for_testing(b"key".to_string(), b"resource".to_string(), scenario.ctx());
  let effect = match (case) {
    Case::Stats => consumable_effect::reset_stats(),
    Case::Spells => consumable_effect::reset_spells(),
    Case::Recall => consumable_effect::recall(),
    Case::City | Case::CityPlain => consumable_effect::city(b"thebes".to_string()),
    Case::LootBox => consumable_effect::loot_box(),
    _ => consumable_effect::heal(10),
  };
  if (case != Case::MissingEffect) item_rows::set_effect(&admin, &mut root, &mut template, effect, scenario.ctx());
  let mut clock = clock::create_for_testing(scenario.ctx());
  let mut character = character::test_character(b"senshi".to_string(), 10, 45, scenario.ctx());
  world::join_world(&mut character, &content, &clock);
  clock::increment_for_testing(&mut clock, 1_000);
  world::prove_move(&mut character, 50_001, 50_000, &clock);
  progression::set_hp(&mut character, 10, &clock);
  if (case == Case::Rooted) world::delay_checkpoint(&mut character, 1_000, &clock);
  if (case == Case::Spells) progression::reset_spells(&mut character);
  let character_id = object::id(&character);
  let (mut kiosk, cap) = kiosk::new(scenario.ctx());
  kiosk.place(&cap, character);
  let mut generator = random::new_generator_for_testing();
  let potion = item::mint(&template, 2, &mut generator, scenario.ctx());
  let potion_id = object::id(&potion);
  item::deposit(&mut kiosk, &cap, &policy, option::none(), potion);
  world_content::share(content);
  transfer::public_transfer(kiosk, OWNER);
  transfer::public_transfer(cap, OWNER);

  scenario.next_tx(OWNER);
  let mut kiosk = scenario.take_from_sender<kiosk::Kiosk>();
  let cap = scenario.take_from_sender<kiosk::KioskOwnerCap>();
  let version = scenario.take_shared<version::Version>();
  let spell = scenario.take_shared<spell_rows::SpellTemplate>();
  let content = scenario.take_shared<world_content::WorldContent>();
  if (between_rooms) {
    let world = scenario.take_shared<world::World>();
    let dungeon = scenario.take_shared<dungeon_content::DungeonContent>();
    let key = item::mint(&key_template, 1, &mut generator, scenario.ctx());
    let key_id = object::id(&key);
    kiosk.place(&cap, key);
    clock::increment_for_testing(&mut clock, 100_000);
    dungeon::enter(&world, &content, &dungeon, &protected, &mut kiosk, &cap, character_id, key_id, 77, &clock, scenario.ctx());
    progression::set_hp(kiosk.borrow_mut(&cap, character_id), 10, &clock);
    test_scenario::return_shared(world);
    test_scenario::return_shared(dungeon);
  };
  assert!(kiosk.is_locked(potion_id));
  if (case == Case::Stats) api::raise_stat(&mut kiosk, &cap, character_id, b"strength".to_string(), 10, &version);
  if (case == Case::Spells) {
    api::raise_spell(&mut kiosk, &cap, character_id, &spell, &version);
    assert!(progression::spell_level(kiosk.borrow(&cap, character_id), &spell) == 2);
  };
  if (case == Case::City || case == Case::PlainCity) {
    api::use_city_consumable(&mut kiosk, &cap, character_id, potion_id, &template, &content, &protected, &version, &clock, scenario.ctx());
  } else {
    api::use_consumable(&mut kiosk, &cap, character_id, potion_id, if (case == Case::WrongTemplate) &wrong else &template,
      &protected, &version, &clock, scenario.ctx());
  };
  assert!(item::amount(kiosk.borrow(&cap, potion_id)) == 1);
  if (case == Case::Heal) {
    assert!(progression::touch(kiosk.borrow_mut(&cap, character_id), &clock) == 20);
    // The remaining old unit adopts the current template effect; no item-side behavior copy exists.
    item_rows::set_effect(&admin, &mut root, &mut template, consumable_effect::heal(500), scenario.ctx());
    api::use_consumable(&mut kiosk, &cap, character_id, potion_id, &template, &protected, &version, &clock, scenario.ctx());
    assert!(!kiosk.has_item(potion_id));
  };
  test_scenario::return_shared(version);
  test_scenario::return_shared(spell);
  test_scenario::return_shared(content);
  transfer::public_transfer(kiosk, OWNER);
  scenario.return_to_sender(cap);

  scenario.next_tx(OWNER);
  let mut kiosk = scenario.take_from_sender<kiosk::Kiosk>();
  let cap = scenario.take_from_sender<kiosk::KioskOwnerCap>();
  let character: &Character = kiosk.borrow(&cap, character_id);
  if (case == Case::Stats) assert!(character.strength() == 0 && character.available_points() == 45);
  if (case == Case::Spells) {
    let spell = scenario.take_shared<spell_rows::SpellTemplate>();
    assert!(character.available_spell_points() == 9 && progression::spell_level(character, &spell) == 1);
    test_scenario::return_shared(spell);
  };
  if (case == Case::Recall || case == Case::City) {
    let (name, x, z) = world::current_checkpoint_for_testing(character);
    assert!(name == b"nauvis".to_string() && z == 50_000);
    assert!(x == if (case == Case::City) 50_512 else 50_000);
  };
  if (case == Case::Heal) { assert!(progression::touch(kiosk.borrow_mut(&cap, character_id), &clock) == 100); }
  else {
    let remaining: Item = protected.extract_from_kiosk(&mut kiosk, &cap, potion_id, scenario.ctx());
    assert!(remaining.amount() == 1);
    item::destroy_for_testing(remaining);
  };
  if (between_rooms) {
    let character: &Character = kiosk.borrow(&cap, character_id);
    assert!(dungeon::has_run(character));
    assert!(world::is_rooted(character, &clock));
    let (_, x, z) = world::current_checkpoint_for_testing(character);
    assert!(x == 50_512 && z == 50_000);
  };
  character::destroy(kiosk.take(&cap, character_id));
  kiosk::close_and_withdraw(kiosk, cap, scenario.ctx()).into_balance().destroy_zero();
  item_rows::destroy_for_testing(template);
  item_rows::destroy_for_testing(wrong);
  item_rows::destroy_for_testing(key_template);
  protected_policy::destroy_for_testing(protected, scenario.ctx());
  transfer_policy::destroy_and_withdraw(policy, policy_cap, scenario.ctx()).into_balance().destroy_zero();
  clock::destroy_for_testing(clock);
  registry::destroy_for_testing(root);
  admin::destroy_for_testing(admin);
  scenario.end();
}

#[test] fun healing_burns_exact_supply_and_reads_the_live_effect() { run(Case::Heal, false); }
#[test] fun stat_reset_restores_only_level_capital() { run(Case::Stats, false); }
#[test] fun spell_reset_clears_allocations_and_refunds_the_pool() { run(Case::Spells, false); }
#[test] fun recall_returns_to_the_current_world_center() { run(Case::Recall, false); }
#[test] fun city_potion_uses_its_authored_same_world_destination() { run(Case::City, false); }
#[test, expected_failure(abort_code = 2603, location = aresrpg::consumable)]
fun rooted_consumption_is_refused_before_burning() { run(Case::Rooted, false); }
#[test, expected_failure(abort_code = 2601, location = aresrpg::consumable)]
fun a_foreign_template_cannot_substitute_an_effect() { run(Case::WrongTemplate, false); }
#[test, expected_failure(abort_code = 2601, location = aresrpg::consumable)]
fun missing_live_effect_is_refused() { run(Case::MissingEffect, false); }
#[test, expected_failure(abort_code = 2604, location = aresrpg::consumable)]
fun plain_consume_cannot_open_a_random_box() { run(Case::LootBox, false); }
#[test, expected_failure(abort_code = 2605, location = aresrpg::consumable)]
fun plain_consume_cannot_skip_city_content() { run(Case::CityPlain, false); }
#[test, expected_failure(abort_code = 2605, location = aresrpg::consumable)]
fun city_consume_rejects_an_ordinary_effect() { run(Case::PlainCity, false); }

#[test] fun dungeon_staging_allows_healing_without_releasing_the_run() { run(Case::Heal, true); }
#[test] fun dungeon_staging_allows_stat_allocation_and_reset() { run(Case::Stats, true); }
#[test] fun dungeon_staging_allows_spell_upgrades_and_reset() { run(Case::Spells, true); }
#[test, expected_failure(abort_code = 2603, location = aresrpg::consumable)]
fun dungeon_staging_refuses_recall() { run(Case::Recall, true); }
#[test, expected_failure(abort_code = 2603, location = aresrpg::consumable)]
fun dungeon_staging_refuses_city_teleport() { run(Case::City, true); }
