// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
#[test_only]
module aresrpg::fight_build_coverage_tests;
use aresrpg::{api, character, fight, item, protected_policy, world, zone};
use aresrpg_combat::combat;
use aresrpg_control::admin;
use aresrpg_math::{combat_grid, dungeon_data, item_stats, mob_data, world_map};
use aresrpg_seed::{board_catalog, dungeon_content, mob_rows, registry, world_content};
use kiosk::personal_kiosk;
use sui::{clock, kiosk, package::Publisher, random, test_scenario, transfer_policy};

const OWNER: address = @0xA11CE;

public enum Case has copy, drop {
  Overworld, InvalidAccess, MissingGroup, WrongWorld, WrongMob, Unfilled, ExtraMob, JoinMobSide,
  Dungeon, DungeonAccess, DungeonTooLarge, DungeonJoinDoor, DungeonSettleDoor, DungeonForfeitDoor,
}

fun is_dungeon(case: Case): bool {
  case == Case::Dungeon || case == Case::DungeonAccess || case == Case::DungeonTooLarge
    || case == Case::DungeonJoinDoor || case == Case::DungeonSettleDoor || case == Case::DungeonForfeitDoor
}

fun lifecycle(case: Case) {
  let mut scenario = test_scenario::begin(@0x0);
  random::create_for_testing(scenario.ctx());
  scenario.next_tx(OWNER);
  item::test_init(scenario.ctx());
  scenario.next_tx(OWNER);
  let publisher = scenario.take_from_sender<Publisher>();
  let protected = protected_policy::for_testing<character::Character>(&publisher, scenario.ctx());
  let (policy, policy_cap) = transfer_policy::new<character::Character>(&publisher, scenario.ctx());
  publisher.burn();
  let cap = admin::cap_for_testing(scenario.ctx());
  let mut root = registry::registry_for_testing(scenario.ctx());
  let mut content = world_content::create(&cap, &mut root, b"nauvis".to_string(), 1, scenario.ctx());
  let other_content = world_content::create(&cap, &mut root, b"incarnam".to_string(), 1, scenario.ctx());
  world_content::set_mobs(&cap, &mut root, &mut content,
    vector[world_map::new_mob_row(b"coverage_mob".to_string(), 10000, vector[0], vector[])], scenario.ctx());
  world::create(&cap, &mut root, &content, scenario.ctx());
  let mut catalog = board_catalog::catalog_for_testing(scenario.ctx());
  board_catalog::add_board(&cap, &mut root, &mut catalog, combat_grid::generate(1, 0), scenario.ctx());
  let shift = item_stats::shift();
  mob_rows::add_mob(&cap, &mut root, mob_data::new_mob_data(
    b"Coverage Mob".to_string(), if (case == Case::WrongMob) b"foreign_mob".to_string() else b"coverage_mob".to_string(),
    b"earth".to_string(), 1, 1, 1, 6, 0, 0, 0, shift, shift, shift, shift, vector[], vector[], 10, false), scenario.ctx());
  let count = if (case == Case::DungeonTooLarge) 7 else 2;
  dungeon_content::add(&cap, &mut root, b"coverage_dungeon".to_string(), dungeon_data::new_dungeon(
    b"key".to_string(), vector[dungeon_data::new_room(vector::tabulate!(count,
      |_| dungeon_data::new_room_mob(b"coverage_mob".to_string())))]), scenario.ctx());
  let mut clock = clock::create_for_testing(scenario.ctx());
  clock::set_for_testing(&mut clock, 1);
  let (mut kiosk, kiosk_cap) = kiosk::new(scenario.ctx());
  let personal = personal_kiosk::new(&mut kiosk, kiosk_cap, scenario.ctx());
  let kiosk_cap = personal_kiosk::borrow(&personal);
  let mut creator = character::test_character(b"senshi".to_string(), 1, 0, scenario.ctx());
  let mut attacker = character::test_character(b"senshi".to_string(), 1, 0, scenario.ctx());
  world::join_world(&mut creator, &content, &clock);
  world::join_world(&mut attacker, if (case == Case::WrongWorld) &other_content else &content, &clock);
  let creator_id = object::id(&creator);
  let attacker_id = object::id(&attacker);
  kiosk.place(kiosk_cap, creator);
  kiosk.place(kiosk_cap, attacker);
  let content_id = object::id(&content);
  let other_content_id = object::id(&other_content);
  world_content::share(content);
  world_content::share(other_content);
  board_catalog::share_for_testing(catalog);
  registry::destroy_for_testing(root);
  admin::destroy_for_testing(cap);
  scenario.next_tx(OWNER);
  let mut world = scenario.take_shared<world::World>();
  let mut entropy = random::new_generator_from_seed_for_testing(b"zone");
  zone::create(kiosk.borrow_mut<character::Character>(kiosk_cap, creator_id), 50000, 50000,
    &mut world, &mut entropy, &clock);
  test_scenario::return_shared(world);
  scenario.next_tx(OWNER);
  let world = scenario.take_shared<world::World>();
  let mut zone = scenario.take_shared<zone::Zone>();
  let mob = scenario.take_shared<mob_rows::MobTemplate>();
  let randomness = scenario.take_shared<random::Random>();
  let content = scenario.take_shared_by_id<world_content::WorldContent>(content_id);
  let other_content = scenario.take_shared_by_id<world_content::WorldContent>(other_content_id);
  let catalog = scenario.take_shared<board_catalog::BoardCatalog>();
  let dungeon = scenario.take_shared<dungeon_content::DungeonContent>();
  clock::increment_for_testing(&mut clock, 1000000);
  let groups = zone::mob_groups(&zone, &content);
  let group_index = if (case == Case::MissingGroup) 999 else groups[0].group_index();
  let mut remaining = if (is_dungeon(case)) count else groups[0].group_members().length();
  let access = if (case == Case::InvalidAccess || case == Case::DungeonAccess) 2 else 0;
  let mut build = if (is_dungeon(case)) {
    fight::dungeon_build(&protected, &mut kiosk, kiosk_cap, attacker_id, &world, &dungeon,
      50000, 50000, 1, 1, access, &catalog, &clock, scenario.ctx())
  } else {
    fight::engage(&protected, &mut kiosk, kiosk_cap, attacker_id, &mut zone, &content,
      group_index, access, &catalog, &clock, scenario.ctx())
  };
  if (case == Case::Unfilled) {
    api::launch_fight(build, &randomness, &clock, scenario.ctx());
    abort 999
  };
  while (remaining > 0) {
    build = fight::add_mob(build, &mob);
    remaining = remaining - 1;
  };
  if (case == Case::ExtraMob) { let _extra = fight::add_mob(build, &mob); abort 999 };
  api::launch_fight(build, &randomness, &clock, scenario.ctx());
  assert!(!kiosk.has_item(attacker_id), 0);
  test_scenario::return_shared(world);
  test_scenario::return_shared(zone);
  test_scenario::return_shared(mob);
  test_scenario::return_shared(randomness);
  test_scenario::return_shared(dungeon);
  test_scenario::return_shared(content);
  test_scenario::return_shared(other_content);
  test_scenario::return_shared(catalog);
  scenario.next_tx(OWNER);
  let mut fight = scenario.take_shared<fight::Fight>();
  assert!(fight::fight_world(&fight) == b"nauvis".to_string(), 1);
  if (is_dungeon(case)) {
    let tag = fight::dungeon_tag(&fight).destroy_some();
    assert!(fight::dungeon_name(&tag) == b"coverage_dungeon".to_string() && fight::dungeon_room(&tag) == 1, 2);
  } else assert!(fight::dungeon_tag(&fight).is_none(), 3);
  if (case == Case::DungeonJoinDoor) fight::assert_join_door_open(&fight);
  if (case == Case::DungeonSettleDoor) fight::assert_settle_door_open(&fight);
  if (case == Case::DungeonForfeitDoor) fight::assert_forfeit_door_open(&fight);
  if (case == Case::JoinMobSide) fight::join(&mut fight, &protected, &mut kiosk, kiosk_cap,
    creator_id, 1, 0, true, &clock, scenario.ctx());
  fight::forfeit(&mut fight, 0, &mut kiosk, kiosk_cap, &policy, &clock, scenario.ctx());
  assert!(kiosk.has_item(attacker_id) && combat::fighter_forfeited(fight::combat_for_testing(&fight), 0), 4);
  fight::close(fight, scenario.ctx());
  transfer::public_transfer(kiosk, OWNER);
  personal_kiosk::transfer_to_sender(personal, scenario.ctx());
  protected_policy::destroy_for_testing(protected, scenario.ctx());
  transfer_policy::destroy_and_withdraw(policy, policy_cap, scenario.ctx()).destroy_zero();
  clock::destroy_for_testing(clock);
  scenario.end();
}

#[test]
fun ordinary_group_construction_preserves_custody_and_allows_recovery() { lifecycle(Case::Overworld) }
#[test]
fun a_two_mob_dungeon_build_preserves_its_room_tag_and_allows_recovery() { lifecycle(Case::Dungeon) }
#[test, expected_failure(abort_code = 1726, location = aresrpg::fight)]
fun overworld_build_rejects_an_invalid_access_mode() { lifecycle(Case::InvalidAccess) }
#[test, expected_failure(abort_code = 1702, location = aresrpg::fight)]
fun overworld_build_rejects_a_missing_group() { lifecycle(Case::MissingGroup) }
#[test, expected_failure(abort_code = 1701, location = aresrpg::fight)]
fun overworld_build_rejects_a_character_from_another_world() { lifecycle(Case::WrongWorld) }
#[test, expected_failure(abort_code = 1703, location = aresrpg::fight)]
fun build_rejects_a_template_that_does_not_match_the_pending_mob() { lifecycle(Case::WrongMob) }
#[test, expected_failure(abort_code = 1704, location = aresrpg::fight)]
fun launch_rejects_an_unfilled_mob_manifest() { lifecycle(Case::Unfilled) }
#[test, expected_failure(abort_code = 1703, location = aresrpg::fight)]
fun a_completed_manifest_cannot_accept_an_extra_mob() { lifecycle(Case::ExtraMob) }
#[test, expected_failure(abort_code = 1726, location = aresrpg::fight)]
fun players_cannot_join_the_monster_side() { lifecycle(Case::JoinMobSide) }
#[test, expected_failure(abort_code = 1726, location = aresrpg::fight)]
fun dungeon_build_rejects_an_invalid_access_mode() { lifecycle(Case::DungeonAccess) }
#[test, expected_failure(abort_code = 1705, location = aresrpg::fight)]
fun an_authored_dungeon_room_cannot_exceed_board_capacity() { lifecycle(Case::DungeonTooLarge) }
#[test, expected_failure(abort_code = 1730, location = aresrpg::fight)]
fun dungeon_join_must_use_its_manager() { lifecycle(Case::DungeonJoinDoor) }
#[test, expected_failure(abort_code = 1730, location = aresrpg::fight)]
fun dungeon_settlement_must_use_its_manager() { lifecycle(Case::DungeonSettleDoor) }
#[test, expected_failure(abort_code = 1730, location = aresrpg::fight)]
fun dungeon_forfeit_must_use_its_manager() { lifecycle(Case::DungeonForfeitDoor) }
