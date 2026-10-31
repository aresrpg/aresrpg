// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
#[test_only]
module aresrpg::tournament_fight_tests;

use aresrpg::{api, character, fight, item, protected_policy, tournament, version, world};
use aresrpg_control::admin;
use aresrpg_math::combat_grid;
use aresrpg_seed::{board_catalog, item_rows, registry, world_content};
use kiosk::personal_kiosk;
use sui::{clock, kiosk, package::Publisher, random, test_scenario, transfer_policy};

const A: address = @0xA;
const B: address = @0xB;
public enum Mode has copy, drop { Normal, Levelled, LateFinish, LateRecord, Expired, Walkover, Partial, EarlyCrank, DuplicateClaim, WrongClaim, WrongFight, LateJoin, UnrecordedClose, Stranger, DoubleOpen, ReadyEmpty, ReadyLarge, ReadyLate, LiveSettle, LiveCrank, UnopenedLinked, WrongItemPlace, EarlyItemClaim, BadAccess, Rooted, BatchReady }

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

fun exercise(mode: Mode) {
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
  let format = if (mode == Mode::Partial || mode == Mode::BatchReady) 3 else 1;
  tournament::create_with_rules(&admin, b"Cup".to_string(), format, 100_000,
    vector[5000, 5000, 0, 0, 0], vector[10_000, 0, 0, 0, 0],
    tournament::add_reward(tournament::rewards(), &template, 1, 2), 0, option::some(1), &version, &clock, s.ctx());
  let (mut ka, pa, ca) = roster(&content, &clock, s.ctx());
  world_content::share(content);
  board_catalog::share_for_testing(catalog);
  s.next_tx(B);
  let content = s.take_shared<world_content::WorldContent>();
  let catalog = s.take_shared<board_catalog::BoardCatalog>();
  let (mut kb, pb, cb) = roster(&content, &clock, s.ctx());
  let mut t = s.take_shared<tournament::Tournament>();
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
  if (mode == Mode::Levelled) {
    character::add_experience(ka.borrow_mut(personal_kiosk::borrow(&pa), ca[0]), 1_000);
    character::add_experience(kb.borrow_mut(personal_kiosk::borrow(&pb), cb[0]), 1_000);
    assert!(ka.borrow<character::Character>(personal_kiosk::borrow(&pa), ca[0]).level() > 1, 900);
  };
  let randomness = s.take_shared<random::Random>();
  clock::increment_for_testing(&mut clock, 99_000);
  api::start_tournament(&mut t, &randomness, &version, &clock, s.ctx());
  if (mode == Mode::EarlyItemClaim) {
    api::claim_tournament_item(&mut t, 1, 0, 0, item::prepare_plan(&template, option::none()), &mut ka, &pa, &item_policy, &randomness, &version, s.ctx()); abort 999
  };
  if (mode == Mode::Rooted) world::delay_checkpoint(ka.borrow_mut(personal_kiosk::borrow(&pa), ca[0]), 1000, &clock);
  api::open_tournament_match(&mut t, 0, &protected, &mut ka, &pa, ca[0], &catalog, &randomness, &version, &clock, s.ctx());
  s.next_tx(B);
  let mut f = s.take_shared<fight::Fight>();
  if (mode == Mode::BadAccess) {
    let (side, _) = tournament::admission(&t, 0, cb[0], B, &clock);
    fight::join(&mut f, &protected, &mut kb, personal_kiosk::borrow(&pb), cb[0], side, 3, false, &clock, s.ctx()); abort 999
  };
  if (mode == Mode::Stranger) {
    api::join_tournament_match(&t, 0, &mut f, &protected, &mut kb, personal_kiosk::borrow(&pb), cb[1], &version, &clock, s.ctx()); abort 999
  };
  if (mode == Mode::DoubleOpen) {
    api::open_tournament_match(&mut t, 0, &protected, &mut kb, &pb, cb[0], &catalog, &randomness, &version, &clock, s.ctx()); abort 999
  };
  if (mode == Mode::UnopenedLinked) { tournament::crank_unopened(&mut t, 0, &version, &clock, s.ctx()); abort 999 };
  if (mode == Mode::ReadyEmpty) { api::ready_tournament_match(&t, 0, &mut f, vector[], &randomness, &version, &clock, s.ctx()); abort 999 };
  if (mode == Mode::ReadyLarge) { api::ready_tournament_match(&t, 0, &mut f, vector[0,0], &randomness, &version, &clock, s.ctx()); abort 999 };
  if (mode == Mode::ReadyLate) {
    clock::increment_for_testing(&mut clock, 1_800_000);
    api::ready_tournament_match(&t, 0, &mut f, vector[0], &randomness, &version, &clock, s.ctx()); abort 999
  };
  if (mode == Mode::EarlyCrank) api::crank_tournament_match(&mut t, 0, &mut f, &randomness, &version, &clock, s.ctx());
  if (mode == Mode::UnrecordedClose) { api::close_tournament_match(&t, 0, f, &version, s.ctx()); abort 999 };
  if (mode == Mode::WrongFight) {
    let mut wrong = fight::retry_boundary_fight_for_testing(1, s.ctx());
    api::join_tournament_match(&t, 0, &mut wrong, &protected, &mut kb, personal_kiosk::borrow(&pb), cb[0], &version, &clock, s.ctx());
    abort 999
  };
  if (mode == Mode::LateJoin) clock::increment_for_testing(&mut clock, 60_000);
  if (mode != Mode::Walkover) {
    api::join_tournament_match(&t, 0, &mut f, &protected, &mut kb, personal_kiosk::borrow(&pb), cb[0], &version, &clock, s.ctx());
    if (mode == Mode::BatchReady) {
      let mut i = 1;
      while (i < 3) {
        api::join_tournament_match(&t, 0, &mut f, &protected, &mut kb, personal_kiosk::borrow(&pb), cb[i], &version, &clock, s.ctx()); i = i + 1;
      };
    };
    api::ready_tournament_match(&t, 0, &mut f, if (mode == Mode::BatchReady) vector[1,2,3] else vector[1], &randomness, &version, &clock, s.ctx());
    s.next_tx(A);
    if (mode == Mode::BatchReady) {
      let mut i = 1;
      while (i < 3) {
        api::join_tournament_match(&t, 0, &mut f, &protected, &mut ka, personal_kiosk::borrow(&pa), ca[i], &version, &clock, s.ctx()); i = i + 1;
      };
    };
    api::ready_tournament_match(&t, 0, &mut f, if (mode == Mode::BatchReady) vector[0,4,5] else vector[0], &randomness, &version, &clock, s.ctx());
    if (mode == Mode::Partial) {
      assert!(fight::in_placement(&f), 1);
      clock::increment_for_testing(&mut clock, 60_000);
      api::crank_tournament_match(&mut t, 0, &mut f, &randomness, &version, &clock, s.ctx());
    };
    assert!(!fight::in_placement(&f), 2);
    if (mode == Mode::LiveSettle) { api::settle_tournament_match(&mut t, 0, &mut f, 0, &mut ka, &pa, &policy, &version, &clock, s.ctx()); abort 999 };
    if (mode == Mode::LiveCrank) {
      clock::increment_for_testing(&mut clock, 60_000);
      api::crank_tournament_match(&mut t, 0, &mut f, &randomness, &version, &clock, s.ctx()); abort 999
    };

    if (mode == Mode::Expired || mode == Mode::Partial) {
      clock::increment_for_testing(&mut clock, 1_800_000);
      s.next_tx(@0x99);
      api::crank_tournament_match(&mut t, 0, &mut f, &randomness, &version, &clock, s.ctx());
      assert!(fight::winner(&f).is_none(), 3);
      s.next_tx(B);
      api::settle_tournament_match(&mut t, 0, &mut f, 1, &mut kb, &pb, &policy, &version, &clock, s.ctx());
    } else {
      if (mode == Mode::LateFinish) clock::increment_for_testing(&mut clock, 1_800_001);
      s.next_tx(B);
      api::forfeit_tournament_match(&mut f, 1, &mut kb, &pb, &policy, &randomness, &version, &clock, s.ctx());
      if (mode == Mode::BatchReady) {
        api::forfeit_tournament_match(&mut f, 2, &mut kb, &pb, &policy, &randomness, &version, &clock, s.ctx());
        api::forfeit_tournament_match(&mut f, 3, &mut kb, &pb, &policy, &randomness, &version, &clock, s.ctx());
      };

    };
  } else {
    clock::increment_for_testing(&mut clock, 60_000);
    api::crank_tournament_match(&mut t, 0, &mut f, &randomness, &version, &clock, s.ctx());
    assert!(tournament::place_for_testing(&t, 0) == 0, 4);
  };
  if (mode == Mode::LateRecord) {
    let winner = fight::winner(&f);
    clock::increment_for_testing(&mut clock, 1_800_000);
    api::crank_tournament_match(&mut t, 0, &mut f, &randomness, &version, &clock, s.ctx());
    assert!(fight::winner(&f) == winner && winner.is_some(), 7);
  };
  s.next_tx(A);
  api::settle_tournament_match(&mut t, 0, &mut f, 0, &mut ka, &pa, &policy, &version, &clock, s.ctx());
  if (mode == Mode::BatchReady) {
    api::settle_tournament_match(&mut t, 0, &mut f, 4, &mut ka, &pa, &policy, &version, &clock, s.ctx());
    api::settle_tournament_match(&mut t, 0, &mut f, 5, &mut ka, &pa, &policy, &version, &clock, s.ctx());
  };
  assert!(tournament::status_for_testing(&t) == b"finished".to_string(), 5);
  // Late crank cannot replace an existing result or repeat prize allocation.
  api::crank_tournament_match(&mut t, 0, &mut f, &randomness, &version, &clock, s.ctx());
  api::close_tournament_match(&t, 0, f, &version, s.ctx());
  assert!(ka.has_item(ca[0]) && kb.has_item(cb[0]), 6);
  if (mode != Mode::Expired && mode != Mode::Partial) {
    if (mode == Mode::WrongItemPlace) {
      api::claim_tournament_item(&mut t, 0, 0, 0, item::prepare_plan(&template, option::none()), &mut kb, &pb, &item_policy, &randomness, &version, s.ctx()); abort 999
    };
    if (mode == Mode::WrongClaim) { s.next_tx(B); };
    api::claim_tournament_item(&mut t, 1, 0, 0, item::prepare_plan(&template, option::none()), &mut ka, &pa, &item_policy, &randomness, &version, s.ctx());
    if (mode == Mode::DuplicateClaim)
      api::claim_tournament_item(&mut t, 1, 0, 0, item::prepare_plan(&template, option::none()), &mut ka, &pa, &item_policy, &randomness, &version, s.ctx());
  };
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

#[test] fun normal_victory_records_settles_closes_and_mints_once() { exercise(Mode::Normal); }
#[test] fun expired_fight_releases_both_characters_without_a_winner() { exercise(Mode::Expired); }
#[test] fun partial_rosters_wait_for_the_existing_placement_deadline() { exercise(Mode::Partial); }
#[test] fun walkover_does_not_reward_the_absent_team() { exercise(Mode::Walkover); }
#[test, expected_failure(abort_code = 3205, location = aresrpg::tournament)]
fun early_crank_refused() { exercise(Mode::EarlyCrank); }
#[test, expected_failure(abort_code = 3206, location = aresrpg::tournament)]
fun item_cannot_be_claimed_twice() { exercise(Mode::DuplicateClaim); }
#[test, expected_failure(abort_code = 3206, location = aresrpg::tournament)]
fun another_owner_cannot_claim_an_item() { exercise(Mode::WrongClaim); }
#[test, expected_failure(abort_code = 3204, location = aresrpg::tournament)]
fun foreign_fight_refused() { exercise(Mode::WrongFight); }
#[test, expected_failure(abort_code = 3204, location = aresrpg::tournament)]
fun late_join_refused() { exercise(Mode::LateJoin); }
#[test, expected_failure(abort_code = 3204, location = aresrpg::tournament)]
fun unrecorded_fight_cannot_be_destroyed() { exercise(Mode::UnrecordedClose); }

#[test, expected_failure(abort_code = 3203, location = aresrpg::tournament)]
fun refuses_stranger() { exercise(Mode::Stranger); }

#[test, expected_failure(abort_code = 3204, location = aresrpg::tournament)]
fun refuses_double_open() { exercise(Mode::DoubleOpen); }

#[test, expected_failure(abort_code = 3203, location = aresrpg::tournament)]
fun refuses_ready_empty() { exercise(Mode::ReadyEmpty); }

#[test, expected_failure(abort_code = 3203, location = aresrpg::tournament)]
fun refuses_ready_large() { exercise(Mode::ReadyLarge); }

#[test, expected_failure(abort_code = 3204, location = aresrpg::tournament)]
fun refuses_ready_late() { exercise(Mode::ReadyLate); }

#[test, expected_failure(abort_code = 3204, location = aresrpg::tournament)]
fun refuses_live_settle() { exercise(Mode::LiveSettle); }

#[test, expected_failure(abort_code = 1706, location = aresrpg::fight)]
fun refuses_live_crank() { exercise(Mode::LiveCrank); }

#[test, expected_failure(abort_code = 3204, location = aresrpg::tournament)]
fun refuses_unopened_linked() { exercise(Mode::UnopenedLinked); }

#[test, expected_failure(abort_code = 3206, location = aresrpg::tournament)]
fun refuses_wrong_item_place() { exercise(Mode::WrongItemPlace); }

#[test, expected_failure(abort_code = 3202, location = aresrpg::tournament)]
fun early_item_claim_refused() { exercise(Mode::EarlyItemClaim); }
#[test, expected_failure(abort_code = 1726, location = aresrpg::fight)]
fun bad_access_refused() { exercise(Mode::BadAccess); }
#[test, expected_failure(abort_code = 1104, location = aresrpg::api)]
fun rooted_character_cannot_escape_through_a_tournament() { exercise(Mode::Rooted); }
#[test]
fun ready_all_starts_once_after_every_registered_seat_is_present() { exercise(Mode::BatchReady); }

#[test] fun late_recording_preserves_an_already_ended_winner() { exercise(Mode::LateRecord); }

#[test] fun a_fight_can_finish_after_timeout_until_someone_cranks_it() { exercise(Mode::LateFinish); }

#[test]
fun levelling_after_registration_does_not_block_opening_or_joining_a_match() { exercise(Mode::Levelled); }
