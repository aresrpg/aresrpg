// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
#[test_only]
module aresrpg::dungeon_lifecycle_tests;

use aresrpg::{api, character, dungeon, fight, fight_rewards::BossVictory, item, mastery, party, protected_policy, version, world};
use aresrpg_control::admin;
use aresrpg_kares::{kares, offering::{Self, Offering}, staking::StakingPool, combat_rewards::{Self, CombatPot}};
use aresrpg_combat::combat;
use aresrpg_math::{city_map, combat_grid, dungeon_data, item_stats, mob_data, prng};
use aresrpg_seed::{board_catalog, dungeon_content, item_rows, mob_rows, registry, world_content};
use kiosk::personal_kiosk;
use sui::{clock, event, kiosk, package::Publisher, random, test_scenario, transfer_policy};

const OWNER: address = @0xA;
public enum Variant has copy, drop { Win, Abandon, GiveUp, WrongKey, Reenter, NoRun, WrongRoom, RawForfeit, BadBatch, WrongDungeon, MissingPortal, WrongWorld, Shrink, Rescue, Grouped, PendingParty, EmptyBatch, OversizedPlan, ForeignSettler, MobSeat, SkipBossRewards, WrongEngageContent, WrongSettleContent, MismatchedRunSettle, MismatchedRunGiveUp, ForeignCharacterWorld, SuppliedBlueprints, TrailingBlueprint, Api }

fun mob(slug: vector<u8>): mob_data::MobData {
  let shift = item_stats::shift();
  let is_boss = slug == b"boss";
  mob_data::new_mob_data(slug.to_string(), slug.to_string(), b"earth".to_string(),
    1, 1, 1, 6, 0, 0, 0, shift, shift, shift, shift, vector[], vector[], 1, is_boss)
}

fun board(swap: bool): combat_grid::GridSpec {
  combat_grid::grid_spec(20, 19,
    vector[0xFFFFFFFFFFFFFFFF, 0xFFFFFFFFFFFFFFFF, 0xFFFFFFFFFFFFFFFF, 0xFFFFFFFFFFFFFFFF, 0xFFFFFFFFFFFFFFFF, 0x0FFFFFFFFFFFFFFF],
    vector[], vector[], if (swap) vector[101, 100, 102, 103, 104, 105] else vector[100, 101, 102, 103, 104, 105],
    vector[106, 107, 108, 109, 110, 111])
}

fun initialize_rewards(scenario: &mut test_scenario::Scenario, clock: &mut clock::Clock) {
  let genesis = kares::genesis_for_testing(scenario.ctx());
  let cap = sui::package::test_publish(object::id_from_address(@aresrpg_kares), scenario.ctx());
  offering::setup(genesis, cap, 1, 10, 1, OWNER, OWNER, OWNER, OWNER, scenario.ctx());
  scenario.next_tx(OWNER);
  let mut offering = scenario.take_shared<Offering>();
  offering::start(&mut offering, clock, scenario.ctx());
  let mut pool = scenario.take_shared<StakingPool>();
  let mut pot = scenario.take_shared<CombatPot>();
  offering::seed_combat(&mut offering, &mut pot, scenario.ctx());
  offering::authorize_combat<BossVictory>(&offering, &mut pot, scenario.ctx());
  let contribution = offering::contribution_for_testing(&mut offering, 1, clock, scenario.ctx());
  clock.increment_for_testing(1);
  offering::settle(&mut offering, &mut pool, clock, scenario.ctx());
  let (tokens, refund) = offering::claim(&mut offering, &mut pool, contribution, clock, scenario.ctx());
  sui::coin::burn_for_testing(tokens);
  sui::coin::burn_for_testing(refund);
  test_scenario::return_shared(offering);
  test_scenario::return_shared(pool);
  test_scenario::return_shared(pot);
}

fun prepare_rewards(scenario: &mut test_scenario::Scenario, fight: &mut fight::Fight, clock: &clock::Clock, version: &version::Version) {
  let offering = scenario.take_shared<Offering>();
  let mut pot = scenario.take_shared<CombatPot>();
  api::prepare_boss_rewards(fight, 0, &offering, &mut pot, version, clock, scenario.ctx());
  let balance = combat_rewards::balance(&pot);
  // Two winning characters share one level-one boss bounty, despite sharing a wallet.
  assert!(combat_rewards::initial_tokens() - balance == (combat_rewards::daily_budget() / 20_000 / 2) * 2);
  api::prepare_boss_rewards(fight, 2, &offering, &mut pot, version, clock, scenario.ctx());
  assert!(combat_rewards::balance(&pot) == balance);
  test_scenario::return_shared(offering);
  test_scenario::return_shared(pot);
}

fun run(variant: Variant) {
  let api_run = variant == Variant::Api;
  let mismatched_run = variant == Variant::MismatchedRunSettle || variant == Variant::MismatchedRunGiveUp;
  let needs_other = variant == Variant::WrongDungeon || variant == Variant::WrongEngageContent
    || variant == Variant::WrongSettleContent || mismatched_run;
  let mut scenario = test_scenario::begin(if (api_run) @0x0 else OWNER);
  if (api_run) {
    random::create_for_testing(scenario.ctx());
    scenario.next_tx(OWNER);
  };
  item::test_init(scenario.ctx());
  version::test_init(scenario.ctx());
  let mut clock = clock::create_for_testing(scenario.ctx());
  initialize_rewards(&mut scenario, &mut clock);
  if (variant == Variant::Win) { scenario.next_epoch(OWNER); };
  let admin = admin::cap_for_testing(scenario.ctx());
  let mut root = registry::registry_for_testing(scenario.ctx());
  let room = dungeon_data::new_room(vector[dungeon_data::new_room_mob(b"guard".to_string())]);
  let boss_room = dungeon_data::new_room(vector[dungeon_data::new_room_mob(b"boss".to_string())]);
  dungeon_content::add(&admin, &mut root, b"nest".to_string(),
    dungeon_data::new_dungeon(b"key".to_string(), vector[room, boss_room]), scenario.ctx());
  mob_rows::add_mob(&admin, &mut root, mob(b"guard"), scenario.ctx());
  scenario.next_tx(OWNER);
  let content = scenario.take_shared<dungeon_content::DungeonContent>();
  let dungeon_id = object::id(&content);
  test_scenario::return_shared(content);
  let guard = scenario.take_shared<mob_rows::MobTemplate>();
  let guard_id = object::id(&guard);
  test_scenario::return_shared(guard);
  mob_rows::add_mob(&admin, &mut root, mob(b"boss"), scenario.ctx());
  scenario.next_tx(OWNER);
  let boss = scenario.take_shared<mob_rows::MobTemplate>();
  let boss_id = object::id(&boss);
  test_scenario::return_shared(boss);
  let other_dungeon_id = if (needs_other) {
    dungeon_content::add(&admin, &mut root, b"other_nest".to_string(),
      dungeon_data::new_dungeon(b"key".to_string(), vector[room]), scenario.ctx());
    scenario.next_tx(OWNER);
    let other = scenario.take_shared<dungeon_content::DungeonContent>();
    let id = object::id(&other);
    test_scenario::return_shared(other);
    id
  } else dungeon_id;
  let publisher = scenario.take_from_sender<Publisher>();
  let (item_policy, item_cap) = transfer_policy::new<item::Item>(&publisher, scenario.ctx());
  let (character_policy, character_cap) = transfer_policy::new<character::Character>(&publisher, scenario.ctx());
  let protected_item = protected_policy::for_testing<item::Item>(&publisher, scenario.ctx());
  let protected_character = protected_policy::for_testing<character::Character>(&publisher, scenario.ctx());
  publisher.burn();
  let foreign_content = if (variant == Variant::ForeignCharacterWorld) {
    let content = world_content::create(&admin, &mut root, b"other_world".to_string(), 1, scenario.ctx());
    world::create(&admin, &mut root, &content, scenario.ctx());
    option::some(content)
  } else option::none();
  let mut world_content = world_content::create(&admin, &mut root, b"nauvis".to_string(), 1, scenario.ctx());
  let mut cities = vector[city_map::new_city(b"town".to_string(), 50000, 50000, dungeon_id)];
  if (needs_other) cities.push_back(city_map::new_city(b"other_town".to_string(), 52000, 50000, other_dungeon_id));
  if (variant != Variant::MissingPortal) world_content::set_cities(&admin, &mut root, &mut world_content, cities, scenario.ctx());
  world::create(&admin, &mut root, &world_content, scenario.ctx());
  let mut catalog = board_catalog::catalog_for_testing(scenario.ctx());
  board_catalog::add_board(&admin, &mut root, &mut catalog, board(false), scenario.ctx());
  board_catalog::add_board(&admin, &mut root, &mut catalog, board(true), scenario.ctx());
  let (mut kiosk, owner_cap) = kiosk::new(scenario.ctx());
  let personal = personal_kiosk::new(&mut kiosk, owner_cap, scenario.ctx());
  let cap = personal_kiosk::borrow(&personal);
  let mut ids = vector[];
  let mut i = 0u64;
  while (i < 2) {
    let mut character = character::test_character(b"senshi".to_string(), 1, 0, scenario.ctx());
    world::join_world(&mut character, if (foreign_content.is_some()) foreign_content.borrow() else &world_content, &clock);
    ids.push_back(object::id(&character));
    kiosk.place(cap, character);
    i = i + 1;
  };
  let grouped = variant == Variant::Grouped || variant == Variant::PendingParty;
  let mut party_registry = party::registry_for_testing(scenario.ctx());
  let mut shared_party = party::inviting_for_testing(&mut party_registry,
    kiosk.borrow<character::Character>(cap, ids[0]), ids[1], scenario.ctx());
  if (variant != Variant::PendingParty) party::accept(&mut party_registry, &mut shared_party, ids[1]);
  let key_template = item_rows::template_for_testing(
    if (variant == Variant::WrongKey) b"wrong".to_string() else b"key".to_string(), b"resource".to_string(), scenario.ctx());
  let mut entropy = random::new_generator_from_seed_for_testing(b"dungeon-lifecycle");
  let mut daily = if (variant == Variant::Win) {
    let mut daily = mastery::mastery_for_testing(0, scenario.ctx());
    mastery::start(&mut daily, &world_content, kiosk.borrow<character::Character>(cap, ids[0]), &mut entropy, &clock, scenario.ctx());
    option::some(daily)
  } else option::none();
  let keys = item::mint(&key_template, 2, &mut entropy, scenario.ctx());
  let key_id = object::id(&keys);
  kiosk.place(cap, keys);
  if (foreign_content.is_some()) world_content::share(foreign_content.destroy_some()) else foreign_content.destroy_none();
  world_content::share(world_content);
  board_catalog::share_for_testing(catalog);
  if (variant == Variant::WrongWorld) {
    world_content::share(world_content::create(&admin, &mut root, b"other".to_string(), 1, scenario.ctx()));
  };

  let mut room = 1;
  while (room <= 2) {
    scenario.next_tx(OWNER);
    let world = scenario.take_shared<world::World>();
    let content = scenario.take_shared<world_content::WorldContent>();
    let mut dungeon_content = scenario.take_shared_by_id<dungeon_content::DungeonContent>(dungeon_id);
    let catalog = scenario.take_shared<board_catalog::BoardCatalog>();
    let mob = scenario.take_shared_by_id<mob_rows::MobTemplate>(if (room == 1) guard_id else boss_id);
    let version = scenario.take_shared<version::Version>();
    clock::increment_for_testing(&mut clock, 1000000);
    if (variant == Variant::ForeignCharacterWorld) {
      assert!(world.name() == b"nauvis".to_string() && world_content::name(&content) == b"nauvis".to_string(), 20);
      assert!(world::current_world(kiosk.borrow<character::Character>(cap, ids[0])) == b"other_world".to_string(), 21);
    };
    if (room == 1 && variant != Variant::NoRun) {
      if (api_run) {
        let randomness = scenario.take_shared<random::Random>();
        api::enter_dungeon(&world, &mut kiosk, &personal, ids[0], &content, &dungeon_content,
          key_id, &protected_item, &randomness, &version, &clock, scenario.ctx());
        assert!(item::amount(kiosk.borrow<item::Item>(cap, key_id)) == 1, 0);
        api::enter_dungeon(&world, &mut kiosk, &personal, ids[1], &content, &dungeon_content,
          key_id, &protected_item, &randomness, &version, &clock, scenario.ctx());
        test_scenario::return_shared(randomness);
      } else {
      dungeon::enter(&world, &content, &dungeon_content, &protected_item, &mut kiosk, cap, ids[0], key_id, 77, &clock, scenario.ctx());
      assert!(item::amount(kiosk.borrow<item::Item>(cap, key_id)) == 1, 0);
      if (variant == Variant::Reenter) dungeon::enter(&world, &content, &dungeon_content,
        &protected_item, &mut kiosk, cap, ids[0], key_id, 78, &clock, scenario.ctx());
      if (variant == Variant::WrongDungeon) {
        let other = scenario.take_shared_by_id<dungeon_content::DungeonContent>(other_dungeon_id);
        dungeon::enter(&world, &content, &other, &protected_item, &mut kiosk, cap, ids[1], key_id, 88, &clock, scenario.ctx());
        test_scenario::return_shared(other);
      } else dungeon::enter(&world, &content, &dungeon_content, &protected_item, &mut kiosk, cap, ids[1], key_id, 88, &clock, scenario.ctx());
      };
      assert!(!kiosk.has_item(key_id), 1);
      assert!(event::events_by_type<dungeon::DungeonEntered>().length() == 2, 12);
      assert!(world::is_rooted(kiosk.borrow<character::Character>(cap, ids[0]), &clock), 2);
    };
    if (room == 2 && (variant == Variant::Shrink || variant == Variant::Rescue)) {
      dungeon_content::overwrite(&admin, &mut root, &mut dungeon_content, b"nest".to_string(),
        dungeon_data::new_dungeon(b"key".to_string(), vector[dungeon_data::new_room(vector[dungeon_data::new_room_mob(b"guard".to_string())])]), scenario.ctx());
    };
    if (variant == Variant::Abandon || (variant == Variant::Rescue && room == 2)) {
      ids.do_ref!(|id| api::abandon_dungeon_run(&mut kiosk, cap, *id, &version, &clock));
      test_scenario::return_shared(version);
      test_scenario::return_shared(world);
      test_scenario::return_shared(content);
      test_scenario::return_shared(dungeon_content);
      test_scenario::return_shared(catalog);
      test_scenario::return_shared(mob);
      break
    };
    let build = if (mismatched_run || variant == Variant::WrongEngageContent) {
      let other = scenario.take_shared_by_id<dungeon_content::DungeonContent>(other_dungeon_id);
      // Real production components with different run identities: the coordinator must refuse
      // their composition. No private run field or new test-only constructor is involved.
      let build = if (mismatched_run) fight::dungeon_build(&protected_character, &mut kiosk, cap, ids[0],
        &world, &other, 52000, 50000, prng::mix(77, room), room, 0, &catalog, &clock, scenario.ctx())
      else api::engage_dungeon_room(&world, &content, &other, &mut kiosk, &personal, ids[0], 0,
        &protected_character, &catalog, &version, &clock, scenario.ctx());
      test_scenario::return_shared(other);
      build
    } else api::engage_dungeon_room(&world, &content, &dungeon_content, &mut kiosk, &personal,
      ids[0], if (grouped) 1 else 0, &protected_character, &catalog, &version, &clock, scenario.ctx());
    test_scenario::return_shared(version);
    let build = fight::add_mob(build, &mob);
    fight::launch(build, &mut entropy, &clock, scenario.ctx());
    assert!(!kiosk.has_item(ids[0]), 3);
    test_scenario::return_shared(world);
    test_scenario::return_shared(content);
    test_scenario::return_shared(dungeon_content);
    test_scenario::return_shared(catalog);
    test_scenario::return_shared(mob);
    scenario.next_tx(OWNER);
    let mut fight = scenario.take_shared<fight::Fight>();
    let content = scenario.take_shared_by_id<dungeon_content::DungeonContent>(if (mismatched_run) other_dungeon_id else dungeon_id);
    let tag = fight::dungeon_tag(&fight).destroy_some();
    assert!(fight::dungeon_name(&tag) == dungeon_content::name(&content) && fight::dungeon_room(&tag) == room, 4);
    let first_cell = combat::fighter_cell(fight::combat_for_testing(&fight), 0);
    if (api_run) assert!(first_cell == 100 || first_cell == 101, 22)
    else assert!(first_cell == if (prng::mix(77, room) % 2 == 0) 100 else 101, 15);
    let version = scenario.take_shared<version::Version>();
    if (variant == Variant::RawForfeit) {
      api::forfeit_fight(&mut fight, 0, &mut kiosk, cap, &character_policy, &version, &clock, scenario.ctx());
    };
    if ((variant == Variant::WrongRoom && room == 1) || mismatched_run) {
      // Leave the second paid entrant staged while inspecting the first seat's run boundary.
    } else if (grouped) api::join_dungeon_room_grouped(&mut fight, &mut kiosk, cap, ids[1],
      &shared_party, &protected_character, &version, &clock, scenario.ctx())
    else api::join_dungeon_room(&mut fight, &mut kiosk, cap, ids[1], &protected_character, &version, &clock, scenario.ctx());
    if (variant == Variant::MismatchedRunGiveUp) {
      api::give_up_dungeon_room(&mut fight, 0, &mut kiosk, cap, &character_policy, &version, &clock, scenario.ctx());
      abort 999
    };
    if (variant == Variant::GiveUp) {
      api::give_up_dungeon_room(&mut fight, 0, &mut kiosk, cap, &character_policy, &version, &clock, scenario.ctx());
      api::give_up_dungeon_room(&mut fight, 2, &mut kiosk, cap, &character_policy, &version, &clock, scenario.ctx());
      test_scenario::return_shared(version);
    } else {
      fight::place(&mut fight, 0, 105, scenario.ctx());
      let single = variant == Variant::WrongRoom || mismatched_run;
      let ready = fight::ready(&mut fight, 0, scenario.ctx());
      assert!(ready == single, 5);
      if (!single) assert!(fight::ready(&mut fight, 2, scenario.ctx()), 6);
      fight::start(&mut fight, &mut entropy, &clock);
      fight::strike(&mut fight, 0, 106, scenario.ctx());
      fight::end_turn(&mut fight, &mut entropy, &clock, scenario.ctx());
      if (daily.is_some()) {
        let completed = api::complete_daily_quest_if_eligible(daily.borrow_mut(), &fight, 0, &content, &version, scenario.ctx());
        assert!(completed == (room == 2), 16);
        assert!(mastery::points_for_testing(daily.borrow()) == (if (room == 2) 1 else 0), 17);
        assert!(!api::complete_daily_quest_if_eligible(daily.borrow_mut(), &fight, 0, &content, &version, scenario.ctx()), 18);
      };
      if (room == 2 && variant != Variant::SkipBossRewards) prepare_rewards(&mut scenario, &mut fight, &clock, &version);
      if (api_run) {
        let randomness = scenario.take_shared<random::Random>();
        if (room == 2) {
          api::settle_last_dungeon_room(&content, fight, vector[0, 2], vector[0, 0], vector[],
            &mut kiosk, &personal, &character_policy, &item_policy, &randomness, &version, &clock, scenario.ctx());
          test_scenario::return_shared(randomness);
          test_scenario::return_shared(version);
          test_scenario::return_shared(content);
          break
        };
        api::settle_dungeon_room(&content, &mut fight, vector[0, 2], vector[0, 0], vector[],
          &mut kiosk, &personal, &character_policy, &item_policy, &randomness, &version, &clock, scenario.ctx());
        test_scenario::return_shared(randomness);
        test_scenario::return_shared(version);
      } else {
      test_scenario::return_shared(version);
      if (variant == Variant::ForeignSettler) { scenario.next_tx(@0xBAD); };
      if (variant == Variant::MobSeat) dungeon::settle_room(&content, &mut fight, 1,
        &mut kiosk, cap, &character_policy, &item_policy, vector[], &mut entropy, &clock, scenario.ctx());
      if (variant == Variant::WrongSettleContent) {
        let other = scenario.take_shared_by_id<dungeon_content::DungeonContent>(other_dungeon_id);
        dungeon::settle_room(&other, &mut fight, 0, &mut kiosk, cap, &character_policy, &item_policy,
          vector[], &mut entropy, &clock, scenario.ctx());
        abort 999
      };
      if (single) dungeon::settle_room(&content, &mut fight, 0, &mut kiosk, cap, &character_policy,
        &item_policy, vector[], &mut entropy, &clock, scenario.ctx())
      else dungeon::settle_many_rooms(&content, &mut fight,
        if (variant == Variant::EmptyBatch) vector[] else vector[0, 2],
        if (variant == Variant::BadBatch) vector[0]
        else if (variant == Variant::OversizedPlan) vector[0, 1]
        else if (variant == Variant::EmptyBatch) vector[]
        else if (variant == Variant::SuppliedBlueprints) vector[1, 1] else vector[0, 0],
        if (variant == Variant::SuppliedBlueprints) vector[item::prepare_plan(&key_template, option::none()), item::prepare_plan(&key_template, option::none())]
        else if (variant == Variant::TrailingBlueprint) vector[item::prepare_plan(&key_template, option::none())]
        else vector[], &mut kiosk, cap, &character_policy, &item_policy, &mut entropy, &clock, scenario.ctx());
      };
    };
    fight::close(fight, scenario.ctx());
    test_scenario::return_shared(content);
    assert!(kiosk.has_item(ids[0]) && kiosk.has_item(ids[1]), 7);
    let continuing = room == 1 && variant != Variant::GiveUp;
    assert!(dungeon::has_run(kiosk.borrow<character::Character>(cap, ids[0])) == continuing, 8);
    assert!(world::is_rooted(kiosk.borrow<character::Character>(cap, ids[0]), &clock) == continuing, 9);
    if (variant == Variant::GiveUp) break;
    room = room + 1;
  };
  ids.do_ref!(|id| {
    assert!(!dungeon::has_run(kiosk.borrow<character::Character>(cap, *id)), 10);
    assert!(!world::is_rooted(kiosk.borrow<character::Character>(cap, *id), &clock), 11);
  });
  assert!(event::events_by_type<dungeon::DungeonEnded>().length() == 2, 12);
  assert!(!kiosk.has_item(key_id), 13);
  assert!(kiosk.item_count() == 2, 19);
  if (api_run) {
    scenario.next_tx(OWNER);
    assert!(!test_scenario::has_most_recent_shared<fight::Fight>(), 23);
  };
  item_rows::destroy_for_testing(key_template);
  party::leave(&mut party_registry, &mut shared_party, ids[1]);
  party::disband(&mut party_registry, shared_party, ids[0]);
  party::destroy_registry_for_testing(party_registry);
  if (daily.is_some()) mastery::destroy_for_testing(daily.destroy_some()) else daily.destroy_none();
  transfer::public_transfer(kiosk, OWNER);
  personal_kiosk::transfer_to_sender(personal, scenario.ctx());
  protected_policy::destroy_for_testing(protected_item, scenario.ctx());
  protected_policy::destroy_for_testing(protected_character, scenario.ctx());
  transfer_policy::destroy_and_withdraw(item_policy, item_cap, scenario.ctx()).into_balance().destroy_zero();
  transfer_policy::destroy_and_withdraw(character_policy, character_cap, scenario.ctx()).into_balance().destroy_zero();
  registry::destroy_for_testing(root);
  admin::destroy_for_testing(admin);
  clock::destroy_for_testing(clock);
  scenario.end();
}

#[test]
fun two_paid_characters_clear_two_rooms_and_return_unrooted() { run(Variant::Win); }
#[test]
fun staging_abandonment_ends_both_runs_without_refunding_keys() { run(Variant::Abandon); }
#[test]
fun room_forfeit_returns_custody_and_ends_the_run() { run(Variant::GiveUp); }
#[test, expected_failure(abort_code = 2702, location = aresrpg::dungeon)]
fun another_item_cannot_pay_the_dungeon_key() { run(Variant::WrongKey); }
#[test, expected_failure(abort_code = 2703, location = aresrpg::dungeon)]
fun a_live_run_cannot_be_reentered() { run(Variant::Reenter); }
#[test, expected_failure(abort_code = 2704, location = aresrpg::dungeon)]
fun room_entry_requires_a_paid_run() { run(Variant::NoRun); }
#[test, expected_failure(abort_code = 2705, location = aresrpg::dungeon)]
fun a_character_staged_at_an_earlier_room_cannot_join_a_later_room() { run(Variant::WrongRoom); }
#[test, expected_failure(abort_code = 1730, location = aresrpg::fight)]
fun the_raw_fight_door_cannot_bypass_dungeon_progression() { run(Variant::RawForfeit); }
#[test, expected_failure(abort_code = 2705, location = aresrpg::dungeon)]
fun settlement_requires_one_plan_per_seat() { run(Variant::BadBatch); }

#[test, expected_failure(abort_code = 2705, location = aresrpg::dungeon)]
fun paid_room_one_characters_cannot_cross_join_different_dungeons() { run(Variant::WrongDungeon); }
#[test, expected_failure(abort_code = 2701, location = aresrpg::dungeon)]
fun the_world_must_publish_a_portal_for_this_dungeon() { run(Variant::MissingPortal); }
#[test, expected_failure(abort_code = 2706, location = aresrpg::dungeon)]
fun foreign_world_content_cannot_authorize_the_entrance() { run(Variant::WrongWorld); }
#[test, expected_failure(vector_error, minor_status = 1, location = aresrpg_math::dungeon_data)]
fun shrinking_rooms_under_a_live_run_refuses_engagement_without_rewinding_it() { run(Variant::Shrink); }
#[test]
fun a_run_stranded_by_content_rebalance_can_still_be_abandoned() { run(Variant::Rescue); }

#[test]
fun accepted_party_members_clear_both_group_locked_rooms() { run(Variant::Grouped); }
#[test, expected_failure(abort_code = 1727, location = aresrpg::fight)]
fun a_pending_party_invitation_does_not_authorize_grouped_join() { run(Variant::PendingParty); }
#[test, expected_failure(abort_code = 2705, location = aresrpg::dungeon)]
fun empty_settlement_cannot_close_a_room() { run(Variant::EmptyBatch); }
#[test, expected_failure(abort_code = 2705, location = aresrpg::dungeon)]
fun a_seat_plan_cannot_consume_missing_items() { run(Variant::OversizedPlan); }
#[test, expected_failure(abort_code = 1708, location = aresrpg::fight)]
fun another_sender_cannot_settle_owned_dungeon_seats() { run(Variant::ForeignSettler); }
#[test, expected_failure(abort_code = 1728, location = aresrpg::fight)]
fun a_mob_seat_cannot_advance_a_character_run() { run(Variant::MobSeat); }

#[test, expected_failure(abort_code = 1730, location = aresrpg::fight)]
fun terminal_boss_settlement_cannot_skip_currency_preparation() { run(Variant::SkipBossRewards); }


#[test, expected_failure(abort_code = 2705, location = aresrpg::dungeon)]
fun another_dungeon_template_cannot_engage_the_paid_run() { run(Variant::WrongEngageContent); }
#[test, expected_failure(abort_code = 2705, location = aresrpg::dungeon)]
fun settlement_cannot_substitute_another_authored_dungeon() { run(Variant::WrongSettleContent); }
#[test, expected_failure(abort_code = 2705, location = aresrpg::dungeon)]
fun independently_built_fight_and_run_must_match_before_settlement() { run(Variant::MismatchedRunSettle); }
#[test, expected_failure(abort_code = 2705, location = aresrpg::dungeon)]
fun independently_built_fight_and_run_must_match_before_give_up() { run(Variant::MismatchedRunGiveUp); }
#[test, expected_failure(abort_code = 2706, location = aresrpg::dungeon)]
fun a_character_in_another_world_cannot_spend_a_key_at_this_entrance() { run(Variant::ForeignCharacterWorld); }
#[test]
fun allocated_authenticated_blueprints_cannot_mint_unearned_drops() { run(Variant::SuppliedBlueprints); }
#[test, expected_failure(abort_code = 2705, location = aresrpg::dungeon)]
fun a_batch_rejects_blueprints_not_assigned_to_any_seat() { run(Variant::TrailingBlueprint); }

#[test]
fun terminal_dungeon_apis_use_native_entropy_advance_and_delete_the_last_fight() { run(Variant::Api); }
