// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
#[test_only]
module aresrpg::kolizeum_tests;

use aresrpg::{api, character, fight, friends, item, kolizeum, protected_policy, version, world};
use aresrpg_control::admin;
use aresrpg_math::combat_grid;
use aresrpg_seed::{board_catalog, registry, world_content};
use kiosk::personal_kiosk;
use sui::{clock, coin, kiosk, package::Publisher, random, sui::SUI, test_scenario, transfer_policy};

const A: address = @0xA;
const B: address = @0xB;
const C: address = @0xC;

public enum Variant has copy, drop {
  Win, Public, CreatorListed, Refund, Zero, LargePledge, BadFormat, BadRange, LowLevel, Rooted, JoinRooted,
  WrongAmount, Stranger, SideFull, WrongFight, EarlyStart, PlacementForfeit,
  DoubleStart, LiveExit, WrongOwner, RepeatPayout, FundedClose,
  WrongStartFight, WrongSettleFight, WrongExitFight, WrongCloseFight, NotDungeonFight, ForfeitedSettle, ApiPublic, ApiFriends,
}

fun roster(
  content: &world_content::WorldContent,
  clock: &clock::Clock,
  rooted: bool,
  ctx: &mut TxContext,
): (kiosk::Kiosk, personal_kiosk::PersonalKioskCap, vector<ID>) {
  let (mut kiosk, cap) = kiosk::new(ctx);
  let personal = personal_kiosk::new(&mut kiosk, cap, ctx);
  let cap = personal_kiosk::borrow(&personal);
  let mut ids = vector[];
  let mut index = 0u64;
  while (index < 3) {
    let mut character = character::test_character(b"senshi".to_string(), 1, 0, ctx);
    world::join_world(&mut character, content, clock);
    if (rooted) world::delay_checkpoint(&mut character, 1000, clock);
    ids.push_back(object::id(&character));
    kiosk.place(cap, character);
    index = index + 1;
  };
  (kiosk, personal, ids)
}

fun next(
  scenario: &mut test_scenario::Scenario,
  lobby: kolizeum::Kolizeum,
  fight: fight::Fight,
  sender: address,
): (kolizeum::Kolizeum, fight::Fight) {
  test_scenario::return_shared(lobby);
  test_scenario::return_shared(fight);
  scenario.next_tx(sender);
  (scenario.take_shared<kolizeum::Kolizeum>(), scenario.take_shared<fight::Fight>())
}

fun payment(scenario: &test_scenario::Scenario, owner: address, expected: u64) {
  if (expected == 0) assert!(!test_scenario::has_most_recent_for_address<coin::Coin<SUI>>(owner), 0)
  else {
    let coin = scenario.take_from_address<coin::Coin<SUI>>(owner);
    assert!(coin.value() == expected, 1);
    coin::burn_for_testing(coin);
  };
}

fun ready_api_group(
  scenario: &mut test_scenario::Scenario,
  lobby: &mut kolizeum::Kolizeum,
  fight: &mut fight::Fight,
  mut seat: u64,
  end: u64,
  clock: &clock::Clock,
) {
  let randomness = scenario.take_shared<random::Random>();
  let version = scenario.take_shared<version::Version>();
  while (seat < end) {
    api::ready_and_start_kolizeum(lobby, fight, seat, &randomness, &version, clock, scenario.ctx());
    seat = seat + 1;
  };
  test_scenario::return_shared(randomness);
  test_scenario::return_shared(version);
}

// The fixture changes inputs and callers, never the rules under test. Six real custody seats
// stake two units each: the one-unit fee leaves eleven, paid exactly as 3 + 4 + 4.
fun arena(variant: Variant) {
  let api_run = variant == Variant::ApiPublic || variant == Variant::ApiFriends;
  let mut scenario = test_scenario::begin(@0x0);
  random::create_for_testing(scenario.ctx());
  scenario.next_tx(A);
  item::test_init(scenario.ctx());
  version::test_init(scenario.ctx());
  scenario.next_tx(A);
  let publisher = scenario.take_from_sender<Publisher>();
  let protected = protected_policy::for_testing<character::Character>(&publisher, scenario.ctx());
  let (policy, policy_cap) = transfer_policy::new<character::Character>(&publisher, scenario.ctx());
  publisher.burn();
  let admin = admin::cap_for_testing(scenario.ctx());
  let mut root = registry::registry_for_testing(scenario.ctx());
  let content = world_content::create(&admin, &mut root, b"nauvis".to_string(), 1, scenario.ctx());
  let mut catalog = board_catalog::catalog_for_testing(scenario.ctx());
  board_catalog::add_board(&admin, &mut root, &mut catalog, combat_grid::generate(1, 0), scenario.ctx());
  let mut clock = clock::create_for_testing(scenario.ctx());
  clock::increment_for_testing(&mut clock, 1000);
  let (mut kiosk_a, personal_a, ids_a) = roster(&content, &clock, variant == Variant::Rooted, scenario.ctx());
  world_content::share(content);
  board_catalog::share_for_testing(catalog);
  registry::destroy_for_testing(root);
  admin::destroy_for_testing(admin);
  scenario.next_tx(B);
  let content = scenario.take_shared<world_content::WorldContent>();
  let (mut kiosk_b, personal_b, ids_b) = roster(&content, &clock, variant == Variant::JoinRooted, scenario.ctx());
  test_scenario::return_shared(content);
  scenario.next_tx(A);
  let catalog = scenario.take_shared<board_catalog::BoardCatalog>();
  let cap_a = personal_kiosk::borrow(&personal_a);
  let cap_b = personal_kiosk::borrow(&personal_b);
  let mut list = friends::list_for_testing(A, B, scenario.ctx());
  if (variant == Variant::CreatorListed) friends::set(&mut list, A, true, scenario.ctx());
  let allowed = friends::snapshot(&list);
  let pledge = if (variant == Variant::Zero) 0 else if (variant == Variant::LargePledge) 10_000_000_000_000_000 else 2;
  if (api_run) {
    let randomness = scenario.take_shared<random::Random>();
    let version = scenario.take_shared<version::Version>();
    let payment = coin::mint_for_testing(pledge, scenario.ctx());
    if (variant == Variant::ApiFriends) api::create_kolizeum_friends(payment, 3, 1, 200, 0, &list,
      &protected, &mut kiosk_a, &personal_a, ids_a[0], &catalog, &randomness, &version, &clock, scenario.ctx())
    else api::create_kolizeum(payment, 3, 1, 200, 0, &protected, &mut kiosk_a, &personal_a, ids_a[0],
      &catalog, &randomness, &version, &clock, scenario.ctx());
    test_scenario::return_shared(randomness);
    test_scenario::return_shared(version);
  } else {
  kolizeum::create(coin::mint_for_testing(pledge, scenario.ctx()),
    if (variant == Variant::BadFormat) 2 else if (variant == Variant::SideFull) 1 else 3,
    if (variant == Variant::BadRange || variant == Variant::LowLevel) 2 else 1,
    if (variant == Variant::BadRange) 1 else 200,
    0, if (variant == Variant::Public) option::none() else option::some(allowed),
    &protected, &mut kiosk_a, cap_a, ids_a[0], 7, &catalog, &clock, scenario.ctx());
  };
  test_scenario::return_shared(catalog);
  // Removing B and adding C after creation changes no permission in the frozen lobby.
  friends::set(&mut list, B, false, scenario.ctx());
  friends::set(&mut list, C, true, scenario.ctx());
  friends::destroy_for_testing(list);
  scenario.next_tx(A);
  let mut lobby = scenario.take_shared<kolizeum::Kolizeum>();
  let mut fight = scenario.take_shared<fight::Fight>();
  assert!(!kiosk_a.has_item(ids_a[0]), 2);
  if (variant == Variant::FundedClose) {
    kolizeum::close(lobby, fight, scenario.ctx());
    abort 999
  };
  if (variant == Variant::NotDungeonFight) {
    let version = scenario.take_shared<version::Version>();
    let randomness = scenario.take_shared<random::Random>();
    api::give_up_dungeon_room_terminal(&mut fight, 0, &mut kiosk_a, &personal_a, &policy, &randomness, &version, &clock, scenario.ctx());
    test_scenario::return_shared(randomness);
    abort 999
  };
  if (variant == Variant::WrongFight || variant == Variant::WrongStartFight || variant == Variant::WrongSettleFight
    || variant == Variant::WrongExitFight || variant == Variant::WrongCloseFight) {
    let catalog = scenario.take_shared<board_catalog::BoardCatalog>();
    let other_id = fight::kolizeum_birth(&protected, &mut kiosk_a, cap_a, ids_a[1], 9, 0, &catalog, &clock, scenario.ctx());
    test_scenario::return_shared(catalog);
    test_scenario::return_shared(fight);
    test_scenario::return_shared(lobby);
    scenario.next_tx(A);
    let mut lobby = scenario.take_shared<kolizeum::Kolizeum>();
    let mut other = scenario.take_shared_by_id<fight::Fight>(other_id);
    let version = scenario.take_shared<version::Version>();
    if (variant == Variant::WrongStartFight) {
      let mut entropy = random::new_generator_from_seed_for_testing(b"wrong-arena");
      kolizeum::start(&mut lobby, &mut other, &mut entropy, &clock, scenario.ctx());
    } else if (variant == Variant::WrongSettleFight) {
      api::settle_kolizeum(&mut lobby, &mut other, 0, &mut kiosk_a, &personal_a, &policy, &version, &clock, scenario.ctx());
    } else if (variant == Variant::WrongExitFight) {
      api::exit_kolizeum(&mut lobby, &mut other, 0, &mut kiosk_a, cap_a, &policy, &version, &clock, scenario.ctx());
    } else if (variant == Variant::WrongCloseFight) {
      api::close_kolizeum(lobby, other, &version, scenario.ctx());
    } else {
      api::join_kolizeum(&mut lobby, &mut other, coin::mint_for_testing(pledge, scenario.ctx()),
        1, &protected, &mut kiosk_a, cap_a, ids_a[2], &version, &clock, scenario.ctx());
    };
    abort 999
  };
  let mut index = 1;
  while (index < 3) {
    kolizeum::join(&mut lobby, &mut fight, coin::mint_for_testing(pledge, scenario.ctx()),
      0, &protected, &mut kiosk_a, cap_a, ids_a[index], &clock, scenario.ctx());
    assert!(fight::placement_started_ms(&fight) == 0, 3);
    index = index + 1;
  };
  (lobby, fight) = next(&mut scenario, lobby, fight, if (variant == Variant::Stranger) C else B);
  index = 0;
  while (index < 3) {
    kolizeum::join(&mut lobby, &mut fight,
      coin::mint_for_testing(if (variant == Variant::WrongAmount) pledge + 1 else pledge, scenario.ctx()),
      1, &protected, &mut kiosk_b, cap_b, ids_b[index], &clock, scenario.ctx());
    assert!(fight::placement_started_ms(&fight) == if (index == 2) 1000 else 0, 4);
    index = index + 1;
  };
  assert!(fight::side_players(&fight, 0) == 3 && fight::side_players(&fight, 1) == 3, 5);
  let mut entropy = random::new_generator_from_seed_for_testing(b"arena");
  if (variant == Variant::PlacementForfeit)
    kolizeum::forfeit(&mut fight, 3, &mut kiosk_b, cap_b, &policy, &mut entropy, &clock, scenario.ctx());
  if (variant == Variant::EarlyStart)
    kolizeum::start(&mut lobby, &mut fight, &mut entropy, &clock, scenario.ctx());

  if (variant == Variant::Refund) {
    // Every B seat leaves before start. No fee is taken; A collects only its own remaining stakes.
    index = 3;
    while (index < 6) {
      kolizeum::exit(&mut lobby, &mut fight, index, &mut kiosk_b, cap_b, &policy, &clock, scenario.ctx());
      assert!(fight::placement_started_ms(&fight) == 0, 6);
      (lobby, fight) = next(&mut scenario, lobby, fight, B);
      payment(&scenario, B, pledge);
      index = index + 1;
    };
    payment(&scenario, @treasury, 0);
  } else {
    if (variant == Variant::ApiFriends) {
      ready_api_group(&mut scenario, &mut lobby, &mut fight, 3, 6, &clock);
      assert!(fight::in_placement(&fight), 15);
    } else {
      index = 3;
      while (index < 6) {
        assert!(!fight::ready(&mut fight, index, scenario.ctx()), 7);
        index = index + 1;
      };
    };
    (lobby, fight) = next(&mut scenario, lobby, fight, A);
    if (variant == Variant::ApiFriends) {
      ready_api_group(&mut scenario, &mut lobby, &mut fight, 0, 3, &clock);
      assert!(!fight::in_placement(&fight), 16);
    } else {
      index = 0;
      while (index < 3) {
        assert!(fight::ready(&mut fight, index, scenario.ctx()) == (index == 2), 8);
        index = index + 1;
      };
      if (variant == Variant::ApiPublic) {
        let randomness = scenario.take_shared<random::Random>();
        let version = scenario.take_shared<version::Version>();
        api::start_kolizeum(&mut lobby, &mut fight, &randomness, &version, &clock, scenario.ctx());
        test_scenario::return_shared(randomness);
        test_scenario::return_shared(version);
      } else kolizeum::start(&mut lobby, &mut fight, &mut entropy, &clock, scenario.ctx());
    };
    if (variant == Variant::DoubleStart)
      kolizeum::start(&mut lobby, &mut fight, &mut entropy, &clock, scenario.ctx());
    if (variant == Variant::LiveExit)
      kolizeum::exit(&mut lobby, &mut fight, 0, &mut kiosk_a, cap_a, &policy, &clock, scenario.ctx());
    (lobby, fight) = next(&mut scenario, lobby, fight, B);
    payment(&scenario, @treasury, if (pledge == 0) 0 else if (variant == Variant::LargePledge) 6_000_000_000_000_000 else 1);
    let version = scenario.take_shared<version::Version>();
    let randomness = scenario.take_shared<random::Random>();
    index = 3;
    while (index < 6) {
      api::forfeit_kolizeum_terminal(&mut fight, index, &mut kiosk_b, &personal_b, &policy, &randomness, &version, &clock, scenario.ctx());
      index = index + 1;
    };
    test_scenario::return_shared(randomness);
    if (variant == Variant::ForfeitedSettle) {
      api::settle_kolizeum(&mut lobby, &mut fight, 3, &mut kiosk_b, &personal_b, &policy, &version, &clock, scenario.ctx());
      abort 999
    };
    test_scenario::return_shared(version);
    (lobby, fight) = next(&mut scenario, lobby, fight, B);
    payment(&scenario, B, 0);
  };
  assert!(fight::winners_remaining(&fight) == 3, 9);
  (lobby, fight) = next(&mut scenario, lobby, fight, if (variant == Variant::WrongOwner) B else A);
  index = 0;
  while (index < 3) {
    let version = scenario.take_shared<version::Version>();
    api::settle_kolizeum(&mut lobby, &mut fight, index, &mut kiosk_a, &personal_a, &policy, &version, &clock, scenario.ctx());
    if (variant == Variant::RepeatPayout)
      api::settle_kolizeum(&mut lobby, &mut fight, index, &mut kiosk_a, &personal_a, &policy, &version, &clock, scenario.ctx());
    test_scenario::return_shared(version);
    (lobby, fight) = next(&mut scenario, lobby, fight, A);
    payment(&scenario, A, if (pledge == 0) 0 else if (variant == Variant::LargePledge) 18_000_000_000_000_000
      else if (variant == Variant::Refund) 2 else if (index == 0) 3 else 4);
    assert!(fight::winners_remaining(&fight) == 2 - index, 10);
    index = index + 1;
  };
  ids_a.do_ref!(|id| assert!(kiosk_a.has_item(*id) && kiosk_a.is_locked(*id), 11));
  ids_b.do_ref!(|id| assert!(kiosk_b.has_item(*id) && kiosk_b.is_locked(*id), 12));
  let version = scenario.take_shared<version::Version>();
  api::close_kolizeum(lobby, fight, &version, scenario.ctx());
  test_scenario::return_shared(version);
  scenario.next_tx(A);
  assert!(!test_scenario::has_most_recent_shared<kolizeum::Kolizeum>(), 13);
  assert!(!test_scenario::has_most_recent_shared<fight::Fight>(), 14);
  transfer::public_transfer(kiosk_a, A);
  personal_kiosk::transfer_to_sender(personal_a, scenario.ctx());
  scenario.next_tx(B);
  transfer::public_transfer(kiosk_b, B);
  personal_kiosk::transfer_to_sender(personal_b, scenario.ctx());
  protected_policy::destroy_for_testing(protected, scenario.ctx());
  transfer_policy::destroy_and_withdraw(policy, policy_cap, scenario.ctx()).into_balance().destroy_zero();
  clock::destroy_for_testing(clock);
  scenario.end();
}

#[test]
fun fee_and_three_winner_payments_conserve_every_unit() { arena(Variant::Win); }
#[test]
fun public_arena_uses_the_same_custody_and_payout_flow() { arena(Variant::Public); }
#[test]
fun an_already_listed_creator_is_not_inserted_twice() { arena(Variant::CreatorListed); }
#[test]
fun placement_exits_refund_without_a_platform_fee() { arena(Variant::Refund); }
#[test]
fun zero_pledge_arena_closes_without_zero_coin_payments() { arena(Variant::Zero); }
#[test]
fun large_valid_stakes_do_not_overflow_the_platform_fee() { arena(Variant::LargePledge); }
#[test]
#[expected_failure(abort_code = 2801, location = aresrpg::kolizeum)]
fun invalid_format_is_refused() { arena(Variant::BadFormat); }
#[test]
#[expected_failure(abort_code = 2803, location = aresrpg::kolizeum)]
fun inverted_level_bounds_are_refused() { arena(Variant::BadRange); }
#[test]
#[expected_failure(abort_code = 2803, location = aresrpg::kolizeum)]
fun creator_below_level_floor_is_refused() { arena(Variant::LowLevel); }
#[test]
#[expected_failure(abort_code = 2804, location = aresrpg::kolizeum)]
fun rooted_creator_cannot_escape_into_arena() { arena(Variant::Rooted); }
#[test]
#[expected_failure(abort_code = 2804, location = aresrpg::kolizeum)]
fun rooted_challenger_cannot_escape_into_arena() { arena(Variant::JoinRooted); }
#[test]
#[expected_failure(abort_code = 2802, location = aresrpg::kolizeum)]
fun wrong_pledge_is_refused() { arena(Variant::WrongAmount); }
#[test]
#[expected_failure(abort_code = 2806, location = aresrpg::kolizeum)]
fun a_friend_added_after_creation_cannot_join() { arena(Variant::Stranger); }
#[test]
#[expected_failure(abort_code = 2805, location = aresrpg::kolizeum)]
fun a_full_side_cannot_accept_an_extra_stake() { arena(Variant::SideFull); }
#[test]
#[expected_failure(abort_code = 2808, location = aresrpg::kolizeum)]
fun unrelated_fight_cannot_spend_this_lobbys_stakes() { arena(Variant::WrongFight); }
#[test]
#[expected_failure(abort_code = 1723, location = aresrpg_combat::combat)]
fun unready_players_cannot_be_charged_the_start_fee() { arena(Variant::EarlyStart); }
#[test]
#[expected_failure(abort_code = 2808, location = aresrpg::kolizeum)]
fun placement_can_only_exit_with_a_refund() { arena(Variant::PlacementForfeit); }
#[test]
#[expected_failure(abort_code = 1706, location = aresrpg::fight)]
fun start_cannot_charge_the_fee_twice() { arena(Variant::DoubleStart); }
#[test]
#[expected_failure(abort_code = 2808, location = aresrpg::kolizeum)]
fun started_fight_cannot_refund_a_stake() { arena(Variant::LiveExit); }
#[test]
#[expected_failure(abort_code = 1708, location = aresrpg::fight)]
fun another_owner_cannot_collect_a_winners_payment() { arena(Variant::WrongOwner); }
#[test]
#[expected_failure(abort_code = 1708, location = aresrpg::fight)]
fun a_settled_winner_cannot_collect_twice() { arena(Variant::RepeatPayout); }
#[test]
#[expected_failure(abort_code = 2809, location = aresrpg::kolizeum)]
fun funded_lobby_cannot_be_destroyed() { arena(Variant::FundedClose); }


#[test, expected_failure(abort_code = 2808, location = aresrpg::kolizeum)]
fun an_unrelated_fight_cannot_start_the_lobbys_fee_collection() { arena(Variant::WrongStartFight); }
#[test, expected_failure(abort_code = 2808, location = aresrpg::kolizeum)]
fun an_unrelated_fight_cannot_collect_the_lobbys_prize() { arena(Variant::WrongSettleFight); }
#[test, expected_failure(abort_code = 2808, location = aresrpg::kolizeum)]
fun an_unrelated_fight_cannot_refund_the_lobbys_stake() { arena(Variant::WrongExitFight); }
#[test, expected_failure(abort_code = 2808, location = aresrpg::kolizeum)]
fun an_unrelated_fight_cannot_be_closed_with_the_lobby() { arena(Variant::WrongCloseFight); }
#[test, expected_failure(abort_code = 2707, location = aresrpg::dungeon)]
fun the_dungeon_exit_door_refuses_a_real_arena_fight() { arena(Variant::NotDungeonFight); }

#[test, expected_failure(abort_code = 1708, location = aresrpg::fight)]
fun a_forfeited_seat_cannot_reenter_settlement_to_claim_a_prize() { arena(Variant::ForfeitedSettle); }

#[test]
fun public_random_api_creation_and_explicit_start_preserve_the_prize_flow() { arena(Variant::ApiPublic); }
#[test]
fun friends_random_api_creation_starts_only_on_the_last_ready_seat() { arena(Variant::ApiFriends); }
