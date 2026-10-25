// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
#[test_only]
module aresrpg::tournament_forfeit_tests;

use aresrpg::{api, character, fight, item, protected_policy, tournament, version, world};
use aresrpg_control::admin;
use aresrpg_math::combat_grid;
use aresrpg_seed::{board_catalog, item_rows, registry, world_content};
use kiosk::personal_kiosk;
use sui::{clock, kiosk, package::Publisher, random, test_scenario, transfer_policy};

const A: address = @0xA;
const B: address = @0xB;

fun roster(content: &world_content::WorldContent, clock: &clock::Clock, ctx: &mut TxContext): (kiosk::Kiosk, personal_kiosk::PersonalKioskCap, vector<ID>) {
  let (mut kiosk, cap) = kiosk::new(ctx);
  let personal = personal_kiosk::new(&mut kiosk, cap, ctx);
  let mut ids = vector[];
  let mut i = 0u64;
  while (i < 3) {
    let mut c = character::test_character(b"senshi".to_string(), 1, 0, ctx);
    world::join_world(&mut c, content, clock);
    ids.push_back(object::id(&c));
    kiosk.place(personal_kiosk::borrow(&personal), c);
    i = i + 1;
  };
  (kiosk, personal, ids)
}

fun resolve_departures(opener_a: bool, format: u64, timeout: bool) {
  let mut s = test_scenario::begin(@0x0);
  random::create_for_testing(s.ctx());
  version::test_init(s.ctx());
  s.next_tx(A);
  item::test_init(s.ctx());
  s.next_tx(A);
  let publisher = s.take_from_sender<Publisher>();
  let protected = protected_policy::for_testing<character::Character>(&publisher, s.ctx());
  let (policy, policy_cap) = transfer_policy::new<character::Character>(&publisher, s.ctx());
  let (item_policy, item_policy_cap) = transfer_policy::new<item::Item>(&publisher, s.ctx());
  publisher.burn();
  let admin = admin::cap_for_testing(s.ctx());
  let mut root = registry::registry_for_testing(s.ctx());
  let content = world_content::create(&admin, &mut root, b"nauvis".to_string(), 1, s.ctx());
  let mut catalog = board_catalog::catalog_for_testing(s.ctx());
  board_catalog::add_board(&admin, &mut root, &mut catalog, combat_grid::generate(1, 0), s.ctx());
  let mut clock = clock::create_for_testing(s.ctx());
  clock::increment_for_testing(&mut clock, 1_000);
  let template = item_rows::template_for_testing(b"tournament_prize".to_string(), b"resource".to_string(), s.ctx());
  let version = s.take_shared<version::Version>();
  tournament::create(&admin, b"Cup".to_string(), format, 100_000,
    vector[5000, 5000, 0, 0, 0], vector[10_000, 0, 0, 0, 0],
    tournament::add_reward(tournament::rewards(), &template, 1, 2), &version, &clock, s.ctx());
  let (mut ka, pa, ca) = roster(&content, &clock, s.ctx());
  world_content::share(content);
  board_catalog::share_for_testing(catalog);
  s.next_tx(B);
  let content = s.take_shared<world_content::WorldContent>();
  let catalog = s.take_shared<board_catalog::BoardCatalog>();
  let (mut kb, pb, cb) = roster(&content, &clock, s.ctx());
  let mut t = s.take_shared<tournament::Tournament>();
  tournament::donate_sui(&mut t, sui::coin::mint_for_testing<sui::sui::SUI>(1000, s.ctx()), &version, &clock);
  api::create_tournament_team(&mut t, b"B".to_string(), vector[], &kb, personal_kiosk::borrow(&pb), cb[0], &version, &clock, s.ctx());
  let mut i = 1;
  while (i < format) {
    api::join_tournament_team(&mut t, 0, 0, &kb, personal_kiosk::borrow(&pb), cb[i], &version, &clock, s.ctx());
    i = i + 1;
  };
  s.next_tx(A);
  api::create_tournament_team(&mut t, b"A".to_string(), vector[], &ka, personal_kiosk::borrow(&pa), ca[0], &version, &clock, s.ctx());
  i = 1;
  while (i < format) {
    api::join_tournament_team(&mut t, 1, 0, &ka, personal_kiosk::borrow(&pa), ca[i], &version, &clock, s.ctx());
    i = i + 1;
  };
  let randomness = s.take_shared<random::Random>();
  api::start_tournament(&mut t, &admin, &randomness, &version, &clock, s.ctx());
  let opener = if (opener_a) A else B;
  let opponent = if (opener_a) B else A;
  let loser_team = if (opener_a) 1 else 0;
  let winner_team = if (opener_a) 0 else 1;
  s.next_tx(opener);
  if (opener_a)
    api::open_tournament_match(&mut t, 0, &protected, &mut ka, &pa, ca[0], &catalog, &randomness, &version, &clock, s.ctx())
  else
    api::open_tournament_match(&mut t, 0, &protected, &mut kb, &pb, cb[0], &catalog, &randomness, &version, &clock, s.ctx());
  s.next_tx(opener);
  let mut f = s.take_shared<fight::Fight>();
  // A second teammate remains eligible when the opener leaves; only the last departure concedes.
  if (format == 3) {
    if (opener_a)
      api::join_tournament_match(&t, 0, &mut f, &protected, &mut ka, personal_kiosk::borrow(&pa), ca[1], &version, &clock, s.ctx())
    else
      api::join_tournament_match(&t, 0, &mut f, &protected, &mut kb, personal_kiosk::borrow(&pb), cb[1], &version, &clock, s.ctx());
  };
  // Registration and kiosk custody are real; these calls require no admin authority.
  assert!(clock.timestamp_ms() == 1_000, 901);
  assert!(fight::in_placement(&f), 902);
  if (opener_a)
    api::forfeit_tournament_match(&mut f, 0, &mut ka, &pa, &policy, &randomness, &version, &clock, s.ctx())
  else
    api::forfeit_tournament_match(&mut f, 0, &mut kb, &pb, &policy, &randomness, &version, &clock, s.ctx());
  if (format == 3) {
    assert!(!fight::ended(&f), 900);
    s.next_tx(opener);
    if (timeout) {
      clock::increment_for_testing(&mut clock, 1_800_000);
      api::crank_tournament_match(&mut t, 0, &mut f, &randomness, &version, &clock, s.ctx());
    } else if (opener_a)
      api::forfeit_tournament_match(&mut f, 1, &mut ka, &pa, &policy, &randomness, &version, &clock, s.ctx())
    else
      api::forfeit_tournament_match(&mut f, 1, &mut kb, &pb, &policy, &randomness, &version, &clock, s.ctx());
  };
  assert!(fight::ended(&f) && fight::winner(&f).is_none(), 903);
  // Recording the concession awards the opposing registered team even before it enters.
  s.next_tx(@0x99);
  api::crank_tournament_match(&mut t, 0, &mut f, &randomness, &version, &clock, s.ctx());
  assert!(tournament::status_for_testing(&t) == b"finished".to_string(), 904);
  assert!(tournament::place_for_testing(&t, loser_team) == 0, 905);
  assert!(tournament::place_for_testing(&t, winner_team) == (if (timeout) 0 else 1), 906);
  assert!(ka.has_item(ca[0]) && kb.has_item(cb[0]), 907);
  s.next_tx(opener);
  if (timeout) {
    if (opener_a)
      api::settle_tournament_match(&mut t, 0, &mut f, 1, &mut ka, &pa, &policy, &version, &clock, s.ctx())
    else
      api::settle_tournament_match(&mut t, 0, &mut f, 1, &mut kb, &pb, &policy, &version, &clock, s.ctx());
  };
  api::close_tournament_match(&t, 0, f, &version, s.ctx());
  s.next_tx(opponent);
  if (!timeout) {
    let mut seat = 0;
    while (seat < format) {
      tournament::claim_sui(&mut t, winner_team, seat, &version, s.ctx());
      seat = seat + 1;
    };
    if (opener_a)
      api::claim_tournament_item(&mut t, winner_team, 0, 0, item::prepare_plan(&template, option::none()), &mut kb, &pb, &item_policy, &randomness, &version, s.ctx())
    else
      api::claim_tournament_item(&mut t, winner_team, 0, 0, item::prepare_plan(&template, option::none()), &mut ka, &pa, &item_policy, &randomness, &version, s.ctx());
  };
  assert!(tournament::sui_balance_for_testing(&t) == 0, 908);
  s.next_tx(A);
  tournament::destroy_for_testing(t);
  item_rows::destroy_for_testing(template);
  test_scenario::return_shared(content);
  registry::destroy_for_testing(root);
  test_scenario::return_shared(catalog);
  admin::destroy_for_testing(admin);
  clock::destroy_for_testing(clock);
  protected_policy::destroy_for_testing(protected, s.ctx());
  transfer::public_transfer(policy, A);
  transfer::public_transfer(item_policy, A);
  transfer::public_transfer(policy_cap, A);
  transfer::public_transfer(item_policy_cap, A);
  transfer::public_transfer(ka, A);
  transfer::public_transfer(kb, B);
  personal_kiosk::transfer_to_sender(pa, s.ctx());
  s.next_tx(B);
  personal_kiosk::transfer_to_sender(pb, s.ctx());
  test_scenario::return_shared(version);
  test_scenario::return_shared(randomness);
  s.end();
}

#[test]
fun first_team_forfeit_awards_the_absent_opponent() { resolve_departures(false, 1, false); }
#[test]
fun second_team_forfeit_awards_the_absent_opponent() { resolve_departures(true, 1, false); }
#[test]
fun teammate_departure_keeps_the_match_open_until_the_last_present_fighter_leaves() { resolve_departures(false, 3, false); }

#[test]
fun an_unplayed_timeout_after_one_departure_does_not_award_the_absent_team() { resolve_departures(false, 3, true); }
