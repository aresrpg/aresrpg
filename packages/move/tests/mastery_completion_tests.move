// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
#[test_only]
module aresrpg::mastery_completion_tests;
use aresrpg::{api, character, fight, item, mastery, party, protected_policy, version, world};
use aresrpg_combat::combat;
use aresrpg_control::admin;
use aresrpg_math::{city_map, combat_grid, dungeon_data, item_stats, mob_data};
use aresrpg_seed::{board_catalog, dungeon_content, mob_rows, registry, world_content};
use kiosk::personal_kiosk;
use sui::{clock, event, kiosk, package::Publisher, random, test_scenario, transfer_policy};

const OWNER: address = @0xA;
public enum Case has copy, drop {
  Valid, StaleEpoch, BeforeAssignment, SameTimestamp, NonWinner, NonDungeon,
  WrongWorld, WrongProvidedDungeon, WrongFightDungeon, NotFinalRoom,
}

fun uses_other_dungeon(case: Case): bool {
  case == Case::WrongFightDungeon || case == Case::WrongProvidedDungeon
}

fun board(): combat_grid::GridSpec {
  combat_grid::grid_spec(20, 19,
    vector[0xFFFFFFFFFFFFFFFF, 0xFFFFFFFFFFFFFFFF, 0xFFFFFFFFFFFFFFFF, 0xFFFFFFFFFFFFFFFF, 0xFFFFFFFFFFFFFFFF, 0x0FFFFFFFFFFFFFFF],
    vector[], vector[], vector[105, 104, 103, 102, 101, 100], vector[106, 107, 108, 109, 110, 111])
}

fun create_fight(
  case: Case,
  protected: &protected_policy::AresRPG_TransferPolicy<character::Character>,
  kiosk: &mut kiosk::Kiosk,
  cap: &kiosk::KioskOwnerCap,
  actor: ID,
  opponent: ID,
  world: &world::World,
  dungeon: &dungeon_content::DungeonContent,
  mob: &mob_rows::MobTemplate,
  catalog: &board_catalog::BoardCatalog,
  clock: &clock::Clock,
  entropy: &mut random::RandomGenerator,
  ctx: &mut TxContext,
) {
  let x = if (uses_other_dungeon(case)) 52048 else 50000;
  let current_world = world::prove_move(kiosk.borrow_mut<character::Character>(cap, actor), x, 50000, clock);
  assert!(current_world == world.name(), 10);
  if (case == Case::NonDungeon) {
    fight::challenge(protected, kiosk, cap, actor, opponent, 50000, 50000, 0, catalog, entropy, clock, ctx);
  } else {
    let build = fight::dungeon_build(protected, kiosk, cap, actor, world, dungeon,
      x, 50000, 1, 1, 0, catalog, clock, ctx);
    fight::launch(fight::add_mob(build, mob), entropy, clock, ctx);
  };
}

fun completion(case: Case) {
  let mut scenario = test_scenario::begin(OWNER);
  item::test_init(scenario.ctx());
  version::test_init(scenario.ctx());
  scenario.next_epoch(OWNER);
  let publisher = scenario.take_from_sender<Publisher>();
  let protected = protected_policy::for_testing<character::Character>(&publisher, scenario.ctx());
  let (policy, policy_cap) = transfer_policy::new<character::Character>(&publisher, scenario.ctx());
  publisher.burn();
  let admin = admin::cap_for_testing(scenario.ctx());
  let mut root = registry::registry_for_testing(scenario.ctx());
  let room = dungeon_data::new_room(vector[dungeon_data::new_room_mob(b"mastery_guard".to_string())]);
  dungeon_content::add(&admin, &mut root, b"mastery_target".to_string(), dungeon_data::new_dungeon(
    b"key".to_string(), if (case == Case::NotFinalRoom) vector[room, room] else vector[room]), scenario.ctx());
  let shift = item_stats::shift();
  mob_rows::add_mob(&admin, &mut root, mob_data::new_mob_data(b"Mastery Guard".to_string(), b"mastery_guard".to_string(),
    b"earth".to_string(), 1, 1, 1, 1, 0, 0, 0, shift, shift, shift, shift, vector[], vector[], 1, false), scenario.ctx());
  let content = world_content::create(&admin, &mut root, b"nauvis".to_string(), 1, scenario.ctx());
  let other_content = world_content::create(&admin, &mut root, b"incarnam".to_string(), 1, scenario.ctx());
  world::create(&admin, &mut root, if (case == Case::WrongWorld) &other_content else &content, scenario.ctx());
  let mut catalog = board_catalog::catalog_for_testing(scenario.ctx());
  board_catalog::add_board(&admin, &mut root, &mut catalog, board(), scenario.ctx());
  let mut clock = clock::create_for_testing(scenario.ctx());
  clock::set_for_testing(&mut clock, 1);
  let (mut kiosk, kiosk_cap) = kiosk::new(scenario.ctx());
  let personal = personal_kiosk::new(&mut kiosk, kiosk_cap, scenario.ctx());
  let kiosk_cap = personal_kiosk::borrow(&personal);
  let mut actor = character::test_character(b"senshi".to_string(), 1, 0, scenario.ctx());
  let mut assignment_actor = character::test_character(b"senshi".to_string(), 1, 0, scenario.ctx());
  world::join_world(&mut actor, if (case == Case::WrongWorld) &other_content else &content, &clock);
  world::join_world(&mut assignment_actor, &content, &clock);
  let actor_id = object::id(&actor);
  let assignment_actor_id = object::id(&assignment_actor);
  kiosk.place(kiosk_cap, actor);
  kiosk.place(kiosk_cap, assignment_actor);
  let content_id = object::id(&content);
  let other_content_id = object::id(&other_content);
  board_catalog::share_for_testing(catalog);
  world_content::share(other_content);
  world_content::share(content);
  scenario.next_tx(OWNER);
  let target = scenario.take_shared<dungeon_content::DungeonContent>();
  let target_id = object::id(&target);
  let mut content = scenario.take_shared_by_id<world_content::WorldContent>(content_id);
  let mut other_content = scenario.take_shared_by_id<world_content::WorldContent>(other_content_id);
  world_content::set_cities(&admin, &mut root, &mut content,
    vector[city_map::new_city(b"target_city".to_string(), 50000, 50000, target_id)], scenario.ctx());
  world_content::set_cities(&admin, &mut root, &mut other_content,
    vector[city_map::new_city(b"target_city".to_string(), 50000, 50000, target_id)], scenario.ctx());
  test_scenario::return_shared(content);
  test_scenario::return_shared(other_content);
  test_scenario::return_shared(target);
  dungeon_content::add(&admin, &mut root, b"other_target".to_string(),
    dungeon_data::new_dungeon(b"other_key".to_string(), vector[room]), scenario.ctx());
  scenario.next_tx(OWNER);
  let other = scenario.take_shared<dungeon_content::DungeonContent>();
  assert!(dungeon_content::name(&other) == b"other_target".to_string(), 11);
  let other_id = object::id(&other);
  let target = scenario.take_shared_by_id<dungeon_content::DungeonContent>(target_id);
  let world = scenario.take_shared<world::World>();
  let mut content = scenario.take_shared_by_id<world_content::WorldContent>(content_id);
  let catalog = scenario.take_shared<board_catalog::BoardCatalog>();
  let mob = scenario.take_shared<mob_rows::MobTemplate>();
  let mut registry = party::registry_for_testing(scenario.ctx());
  let mut entropy = random::new_generator_from_seed_for_testing(b"mastery-completion");
  let selected_dungeon = if (uses_other_dungeon(case)) &other else &target;
  if (case == Case::BeforeAssignment) {
    clock::set_for_testing(&mut clock, 99);
    create_fight(case, &protected, &mut kiosk, kiosk_cap, actor_id, assignment_actor_id,
      &world, selected_dungeon, &mob, &catalog, &clock, &mut entropy, scenario.ctx());
  };
  clock::set_for_testing(&mut clock, 100);
  mastery::start_first(&mut registry, &content, kiosk.borrow<character::Character>(kiosk_cap, assignment_actor_id),
    &mut entropy, &clock, scenario.ctx());
  if (uses_other_dungeon(case)) world_content::set_cities(&admin, &mut root, &mut content,
    vector[city_map::new_city(b"target_city".to_string(), 50000, 50000, target_id),
      city_map::new_city(b"other_city".to_string(), 52048, 50000, other_id)], scenario.ctx());
  if (case != Case::BeforeAssignment) {
    clock::set_for_testing(&mut clock, if (case == Case::SameTimestamp) 100 else 1000000);
    create_fight(case, &protected, &mut kiosk, kiosk_cap, actor_id, assignment_actor_id,
      &world, selected_dungeon, &mob, &catalog, &clock, &mut entropy, scenario.ctx());
  };
  registry::destroy_for_testing(root);
  admin::destroy_for_testing(admin);
  test_scenario::return_shared(target);
  test_scenario::return_shared(other);
  test_scenario::return_shared(world);
  test_scenario::return_shared(content);
  test_scenario::return_shared(catalog);
  test_scenario::return_shared(mob);
  scenario.next_tx(OWNER);
  let mut daily = scenario.take_from_sender<mastery::Mastery>();
  let mut fight = scenario.take_shared<fight::Fight>();
  if (case == Case::NonDungeon) {
    fight::join(&mut fight, &protected, &mut kiosk, kiosk_cap, assignment_actor_id, 1, 0, true, &clock, scenario.ctx());
    fight::forfeit(&mut fight, 1, &mut kiosk, kiosk_cap, &policy, &mut entropy, &clock, scenario.ctx());
  } else if (case != Case::NonWinner) {
    let _ = fight::ready(&mut fight, 0, scenario.ctx());
    fight::start(&mut fight, &mut entropy, &clock);
    fight::strike(&mut fight, 0, 106, scenario.ctx());
    fight::end_turn(&mut fight, &mut entropy, &clock, scenario.ctx());
    assert!(fight::fighter_won(&fight, 0), 0);
  };
  if (case == Case::StaleEpoch) {
    test_scenario::return_shared(fight);
    scenario.next_epoch(OWNER);
    fight = scenario.take_shared<fight::Fight>();
  };
  let provided = scenario.take_shared_by_id<dungeon_content::DungeonContent>(
    if (case == Case::WrongProvidedDungeon) other_id else target_id);
  let version = scenario.take_shared<version::Version>();
  if (case == Case::WrongProvidedDungeon) {
    let tag = fight::dungeon_tag(&fight).destroy_some();
    assert!(fight::dungeon_name(&tag) == dungeon_content::name(&provided), 12);
  };
  let before = event::events_by_type<mastery::MasteryUpdated>().length();
  let completed = api::complete_daily_quest_if_eligible(&mut daily, &fight, 0, &provided, &version, scenario.ctx());
  assert!(completed == (case == Case::Valid), 1);
  assert!(mastery::points_for_testing(&daily) == if (case == Case::Valid) 1 else 0, 2);
  assert!(event::events_by_type<mastery::MasteryUpdated>().length() == before + if (case == Case::Valid) 1 else 0, 3);
  assert!(!api::complete_daily_quest_if_eligible(&mut daily, &fight, 0, &provided, &version, scenario.ctx()), 4);
  assert!(mastery::points_for_testing(&daily) == if (case == Case::Valid) 1 else 0, 6);
  assert!(event::events_by_type<mastery::MasteryUpdated>().length() == before + if (case == Case::Valid) 1 else 0, 7);
  if (combat::ended(fight::combat_for_testing(&fight))) {
    fight::settle_pvp(&mut fight, 0, &mut kiosk, kiosk_cap, &policy, &clock, scenario.ctx());
  } else fight::forfeit(&mut fight, 0, &mut kiosk, kiosk_cap, &policy, &mut entropy, &clock, scenario.ctx());
  fight::close(fight, scenario.ctx());
  assert!(kiosk.has_item(actor_id) && kiosk.has_item(assignment_actor_id), 5);
  mastery::destroy_for_testing(daily);
  party::destroy_registry_for_testing(registry);
  protected_policy::destroy_for_testing(protected, scenario.ctx());
  transfer_policy::destroy_and_withdraw(policy, policy_cap, scenario.ctx()).destroy_zero();
  transfer::public_transfer(kiosk, OWNER);
  personal_kiosk::transfer_to_sender(personal, scenario.ctx());
  clock::destroy_for_testing(clock);
  test_scenario::return_shared(provided);
  test_scenario::return_shared(version);
  scenario.end();
}

#[test]
fun the_assigned_final_room_credits_once_after_a_real_victory() { completion(Case::Valid) }
#[test]
fun an_old_quest_cannot_complete_in_an_epoch_without_a_new_assignment() { completion(Case::StaleEpoch) }
#[test]
fun a_fight_born_before_assignment_cannot_retroactively_complete_it() { completion(Case::BeforeAssignment) }
#[test]
fun equal_assignment_and_fight_timestamps_do_not_prove_a_later_fight() { completion(Case::SameTimestamp) }
#[test]
fun an_unfinished_fight_is_not_a_daily_victory() { completion(Case::NonWinner) }
#[test]
fun an_ordinary_duel_victory_is_not_a_dungeon_completion() { completion(Case::NonDungeon) }
#[test]
fun a_victory_in_another_world_does_not_complete_the_assignment() { completion(Case::WrongWorld) }
#[test]
fun the_supplied_dungeon_must_match_the_assignment_object() { completion(Case::WrongProvidedDungeon) }
#[test]
fun the_fight_tag_must_match_the_supplied_dungeon() { completion(Case::WrongFightDungeon) }
#[test]
fun an_earlier_room_cannot_be_presented_as_the_final_room() { completion(Case::NotFinalRoom) }
