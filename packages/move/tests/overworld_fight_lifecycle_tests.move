// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// One real overworld lifecycle across zone, API, authority, combat, custody, events, XP/HP,
/// settlement, and Fight deletion. This is the core/combat integration contract.
#[test_only]
module aresrpg::overworld_fight_lifecycle_tests;

use aresrpg::{api, character, fight, item, progression, protected_policy, version, world, zone};
use aresrpg_control::admin;
use aresrpg_math::{combat_grid, item_stats, mob_data, world_map};
use aresrpg_seed::{board_catalog, mob_rows, registry, world_content};
use kiosk::personal_kiosk;
use sui::{clock, event, kiosk, package::Publisher, random, test_scenario, transfer_policy};

const OWNER: address = @0xA11CE;
const CENTER: u32 = 50_000;

fun board(): combat_grid::GridSpec {
  combat_grid::grid_spec(
    20,
    19,
    vector[
      0xFFFFFFFFFFFFFFFF,
      0xFFFFFFFFFFFFFFFF,
      0xFFFFFFFFFFFFFFFF,
      0xFFFFFFFFFFFFFFFF,
      0xFFFFFFFFFFFFFFFF,
      0x0FFFFFFFFFFFFFFF,
    ],
    vector[],
    vector[],
    vector[100, 101, 102, 103, 104, 105],
    vector[106, 107, 108, 109, 110, 111],
  )
}

#[test]
fun searched_group_fight_returns_both_characters_and_closes() {
  let mut scenario = test_scenario::begin(OWNER);
  item::test_init(scenario.ctx());
  version::test_init(scenario.ctx());
  scenario.next_tx(OWNER);

  let publisher = scenario.take_from_sender<Publisher>();
  let (character_policy, character_policy_cap) =
    transfer_policy::new<character::Character>(&publisher, scenario.ctx());
  let (item_policy, item_policy_cap) = transfer_policy::new<item::Item>(&publisher, scenario.ctx());
  let protected = protected_policy::for_testing<character::Character>(&publisher, scenario.ctx());
  publisher.burn();
  let version = scenario.take_shared<version::Version>();
  let (mut kiosk, kiosk_cap) = kiosk::new(scenario.ctx());
  let personal = personal_kiosk::new(&mut kiosk, kiosk_cap, scenario.ctx());
  let cap = admin::cap_for_testing(scenario.ctx());
  let mut root = registry::registry_for_testing(scenario.ctx());
  let mut content = world_content::create(&cap, &mut root, b"nauvis".to_string(), 1, scenario.ctx());
  world_content::set_mobs(
    &cap,
    &mut root,
    &mut content,
    vector[world_map::new_mob_row(b"training_mob".to_string(), 10_000, vector[0], vector[])],
    scenario.ctx(),
  );
  let mut catalog = board_catalog::catalog_for_testing(scenario.ctx());
  board_catalog::add_board(&cap, &mut root, &mut catalog, board(), scenario.ctx());
  let shift = item_stats::shift();
  mob_rows::add_mob(
    &cap,
    &mut root,
    mob_data::new_mob_data(
      b"Training Mob".to_string(), b"training_mob".to_string(), b"earth".to_string(),
      1, 1, 1, 6, 0, 0, 0, shift, shift, shift, shift, vector[], vector[], 10_000,
    ),
    scenario.ctx(),
  );
  world::create(&cap, &mut root, &content, scenario.ctx());
  let clock = clock::create_for_testing(scenario.ctx());
  let mut first = character::test_character(b"senshi".to_string(), 1, 0, scenario.ctx());
  let mut second = character::test_character(b"shugo".to_string(), 1, 0, scenario.ctx());
  world::join_world(&mut first, &content, &clock);
  world::join_world(&mut second, &content, &clock);
  let first_id = object::id(&first);
  let second_id = object::id(&second);
  let kiosk_cap = personal_kiosk::borrow(&personal);
  kiosk.place(kiosk_cap, first);
  kiosk.place(kiosk_cap, second);
  world_content::share(content);
  board_catalog::share_for_testing(catalog);
  clock::share_for_testing(clock);
  registry::destroy_for_testing(root);
  admin::destroy_for_testing(cap);
  transfer::public_transfer(character_policy, OWNER);
  transfer::public_transfer(character_policy_cap, OWNER);
  transfer::public_transfer(item_policy, OWNER);
  transfer::public_transfer(item_policy_cap, OWNER);
  transfer::public_transfer(protected, OWNER);
  transfer::public_transfer(kiosk, OWNER);
  personal_kiosk::transfer_to_sender(personal, scenario.ctx());
  test_scenario::return_shared(version);

  scenario.next_tx(OWNER);
  let mut kiosk = scenario.take_from_sender<kiosk::Kiosk>();
  let personal = scenario.take_from_sender<personal_kiosk::PersonalKioskCap>();
  let mut world = scenario.take_shared<world::World>();
  let content = scenario.take_shared<world_content::WorldContent>();
  let clock = scenario.take_shared<clock::Clock>();
  let mut generator = random::new_generator_from_seed_for_testing(b"zone-search");
  zone::create(
    kiosk.borrow_mut(personal_kiosk::borrow(&personal), first_id),
    CENTER,
    CENTER,
    &mut world,
    &mut generator,
    &clock,
  );
  transfer::public_transfer(kiosk, OWNER);
  personal_kiosk::transfer_to_sender(personal, scenario.ctx());
  test_scenario::return_shared(world);
  test_scenario::return_shared(content);
  test_scenario::return_shared(clock);

  scenario.next_tx(OWNER);
  let mut kiosk = scenario.take_from_sender<kiosk::Kiosk>();
  let personal = scenario.take_from_sender<personal_kiosk::PersonalKioskCap>();
  let protected = scenario.take_from_sender<protected_policy::AresRPG_TransferPolicy<character::Character>>();
  let mut zone = scenario.take_shared<zone::Zone>();
  let content = scenario.take_shared<world_content::WorldContent>();
  let catalog = scenario.take_shared<board_catalog::BoardCatalog>();
  let mob = scenario.take_shared<mob_rows::MobTemplate>();
  let version = scenario.take_shared<version::Version>();
  let mut clock = scenario.take_shared<clock::Clock>();
  clock::increment_for_testing(&mut clock, 1_000_000);
  let groups = zone::mob_groups(&zone, &content);
  let group_index = groups[0].group_index();
  let build = api::engage_fight(
    &mut kiosk,
    &personal,
    first_id,
    &mut zone,
    &content,
    group_index,
    0,
    &protected,
    &catalog,
    &version,
    &clock,
    scenario.ctx(),
  );
  let build = api::add_fight_mob(build, &mob);
  let mut first_turn_entropy = random::new_generator_from_seed_for_testing(b"first-turn");
  fight::launch(build, &mut first_turn_entropy, &clock, scenario.ctx());
  assert!(!kiosk.has_item(first_id), 0);
  assert!(event::events_by_type<fight::FightCreated>().length() == 1, 5);
  transfer::public_transfer(kiosk, OWNER);
  personal_kiosk::transfer_to_sender(personal, scenario.ctx());
  transfer::public_transfer(protected, OWNER);
  test_scenario::return_shared(zone);
  test_scenario::return_shared(content);
  test_scenario::return_shared(catalog);
  test_scenario::return_shared(mob);
  test_scenario::return_shared(version);
  test_scenario::return_shared(clock);

  scenario.next_tx(OWNER);
  let mut kiosk = scenario.take_from_sender<kiosk::Kiosk>();
  let personal = scenario.take_from_sender<personal_kiosk::PersonalKioskCap>();
  let protected = scenario.take_from_sender<protected_policy::AresRPG_TransferPolicy<character::Character>>();
  let character_policy = scenario.take_from_sender<transfer_policy::TransferPolicy<character::Character>>();
  let character_policy_cap = scenario.take_from_sender<transfer_policy::TransferPolicyCap<character::Character>>();
  let item_policy = scenario.take_from_sender<transfer_policy::TransferPolicy<item::Item>>();
  let item_policy_cap = scenario.take_from_sender<transfer_policy::TransferPolicyCap<item::Item>>();
  let mut fight = scenario.take_shared<fight::Fight>();
  let version = scenario.take_shared<version::Version>();
  let content = scenario.take_shared<world_content::WorldContent>();
  let catalog = scenario.take_shared<board_catalog::BoardCatalog>();
  let mob = scenario.take_shared<mob_rows::MobTemplate>();
  let world = scenario.take_shared<world::World>();
  let clock = scenario.take_shared<clock::Clock>();
  let kiosk_cap = personal_kiosk::borrow(&personal);
  api::place_fighter(&mut fight, 0, 105, &version, scenario.ctx());
  api::join_fight(
    &mut fight,
    &mut kiosk,
    kiosk_cap,
    second_id,
    0,
    0,
    &protected,
    &version,
    &clock,
    scenario.ctx(),
  );
  assert!(!kiosk.has_item(first_id) && !kiosk.has_item(second_id), 1);
  fight::ready_non_final(&mut fight, 0, scenario.ctx());
  assert!(fight::ready(&mut fight, 2, scenario.ctx()), 3);
  let mut turn_entropy = random::new_generator_from_seed_for_testing(b"fight-turns");
  fight::start(&mut fight, &mut turn_entropy, &clock);
  api::weapon_strike(&mut fight, 0, 106, &version, scenario.ctx());
  let mut loot_commit = random::new_generator_from_seed_for_testing(b"loot-commit");
  fight::seal_end(&mut fight, &mut loot_commit);
  let mut loot_entropy = random::new_generator_from_seed_for_testing(b"fight-loot");
  let fighters = vector[0, 2];
  fight::assert_last_settlers(&fight, &fighters, scenario.ctx());
  fight::settle_many(
    &mut fight,
    fighters,
    vector[0, 0],
    vector[],
    &mut kiosk,
    kiosk_cap,
    &character_policy,
    &item_policy,
    &mut loot_entropy,
    &clock,
    scenario.ctx(),
  );
  fight::close(fight, scenario.ctx());
  assert!(kiosk.has_item(first_id) && kiosk.has_item(second_id), 4);
  assert!(event::events_by_type<fight::FighterJoined>().length() == 1, 6);
  assert!(event::events_by_type<fight::FightStarted>().length() == 1, 7);
  assert!(event::events_by_type<fight::FightEnded>().length() == 1, 8);
  assert!(event::events_by_type<fight::FightClosed>().length() == 1, 9);

  let first: &mut character::Character = kiosk.borrow_mut(kiosk_cap, first_id);
  assert!(first.level() > 1 && progression::touch(first, &clock) > 0, 10);
  let second: &mut character::Character = kiosk.borrow_mut(kiosk_cap, second_id);
  assert!(second.level() > 1 && progression::touch(second, &clock) > 0, 11);

  character::destroy(protected.extract_from_kiosk(&mut kiosk, kiosk_cap, first_id, scenario.ctx()));
  character::destroy(protected.extract_from_kiosk(&mut kiosk, kiosk_cap, second_id, scenario.ctx()));
  transfer::public_transfer(kiosk, OWNER);
  personal_kiosk::transfer_to_sender(personal, scenario.ctx());
  protected_policy::destroy_for_testing(protected, scenario.ctx());
  transfer_policy::destroy_and_withdraw(character_policy, character_policy_cap, scenario.ctx())
    .into_balance().destroy_zero();
  transfer_policy::destroy_and_withdraw(item_policy, item_policy_cap, scenario.ctx())
    .into_balance().destroy_zero();
  test_scenario::return_shared(version);
  test_scenario::return_shared(content);
  test_scenario::return_shared(catalog);
  test_scenario::return_shared(mob);
  test_scenario::return_shared(world);
  test_scenario::return_shared(clock);
  scenario.end();
}
