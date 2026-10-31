// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
#[test_only]
module aresrpg::tournament_fee_tests;

use aresrpg::{api, character, tournament, tournament_tests as fixture, version};
use aresrpg_control::admin;
use sui::{clock, coin, kiosk, sui::SUI, test_scenario};

fun setup(fee: u64): (test_scenario::Scenario, tournament::Tournament,
  admin::AdminCap, version::Version, clock::Clock) {
  setup_with_limit(fee, option::none())
}

fun setup_with_limit(fee: u64, max_level: Option<u16>): (test_scenario::Scenario, tournament::Tournament,
  admin::AdminCap, version::Version, clock::Clock) {
  let (mut s, free, admin, version, clock) = fixture::setup(3, vector[10000,0,0,0,0]);
  tournament::destroy_for_testing(free);
  tournament::create_with_rules(&admin, b"Paid cup".to_string(), 3, 1_000_000,
    vector[10000,0,0,0,0], vector[10000,0,0,0,0], vector[], fee, max_level, &version, &clock, s.ctx());
  s.next_tx(@0xB);
  let t = s.take_shared<tournament::Tournament>();
  (s, t, admin, version, clock)
}

#[test]
fun successful_registration_splits_exactly_and_leave_does_not_refund() {
  let (mut s, mut t, admin, version, clock) = setup(5);
  let c = character::test_character(b"senshi".to_string(), 1, 0, s.ctx());
  let id = object::id(&c);
  let (mut kiosk, cap) = kiosk::new(s.ctx());
  kiosk.place(&cap, c);
  api::register_tournament(&mut t, option::none(), 0, b"Team".to_string(), vector[],
    coin::mint_for_testing<SUI>(5, s.ctx()), &kiosk, &cap, id, &version, &clock, s.ctx());
  assert!(tournament::sui_balance_for_testing(&t) == 3, 0);
  s.next_tx(@0xB);
  assert!(fixture::payout<SUI>(&s, @treasury) == 2, 1);
  tournament::leave_team(&mut t, 0, id, &version, &clock, s.ctx());
  assert!(tournament::sui_balance_for_testing(&t) == 3, 2);
  api::register_tournament(&mut t, option::none(), 0, b"Again".to_string(), vector[],
    coin::mint_for_testing<SUI>(5, s.ctx()), &kiosk, &cap, id, &version, &clock, s.ctx());
  assert!(tournament::sui_balance_for_testing(&t) == 6, 3);
  character::destroy(kiosk.take<character::Character>(&cap, id));
  kiosk.close_and_withdraw(cap, s.ctx()).destroy_zero();
  s.next_tx(@0xA);
  assert!(fixture::payout<SUI>(&s, @treasury) == 2, 4);
  tournament::cancel(&mut t, &admin, &version, s.ctx());
  s.next_tx(@0xA);
  assert!(fixture::payout<SUI>(&s, @0xA) == 6, 5);
  assert!(!test_scenario::has_most_recent_for_address<coin::Coin<SUI>>(@0xB), 6);
  fixture::cleanup(t, admin, version, clock, s);
}

#[test]
fun joining_an_existing_team_pays_the_same_fee() {
  let (mut s, mut t, admin, version, clock) = setup(2);
  let (mut kiosk, cap) = kiosk::new(s.ctx());
  let mut i = 0;
  while (i < 2) {
    let c = character::test_character(b"senshi".to_string(), 1, 0, s.ctx());
    let id = object::id(&c);
    kiosk.place(&cap, c);
    api::register_tournament(&mut t, if (i == 0) option::none() else option::some(0), 0,
      b"Team".to_string(), vector[], coin::mint_for_testing<SUI>(2, s.ctx()),
      &kiosk, &cap, id, &version, &clock, s.ctx());
    character::destroy(kiosk.take<character::Character>(&cap, id));
    i = i + 1;
  };
  assert!(tournament::sui_balance_for_testing(&t) == 2, 0);
  kiosk.close_and_withdraw(cap, s.ctx()).destroy_zero();
  s.next_tx(@0xA);
  tournament::cancel(&mut t, &admin, &version, s.ctx());
  fixture::cleanup(t, admin, version, clock, s);
}

fun refused(mode: u8) {
  let (mut s, mut t, _admin, version, clock) = setup(5);
  let c = character::test_character(b"senshi".to_string(), 1, 0, s.ctx());
  let id = object::id(&c);
  let (mut kiosk, cap) = kiosk::new(s.ctx());
  kiosk.place(&cap, c);
  if (mode == 0) {
    api::create_tournament_team(&mut t, b"Free".to_string(), vector[], &kiosk, &cap, id, &version, &clock, s.ctx());
  } else if (mode == 1) {
    api::join_tournament_team(&mut t, 0, 0, &kiosk, &cap, id, &version, &clock, s.ctx());
  } else {
    api::register_tournament(&mut t, option::none(), 0, b"Paid".to_string(), vector[],
      coin::mint_for_testing<SUI>(if (mode == 2) 4 else 6, s.ctx()), &kiosk, &cap, id, &version, &clock, s.ctx());
  };
  abort 999
}
#[test, expected_failure(abort_code = 3201, location = aresrpg::tournament)]
fun free_creation_cannot_bypass_the_fee() { refused(0); }
#[test, expected_failure(abort_code = 3201, location = aresrpg::tournament)]
fun free_join_cannot_bypass_the_fee() { refused(1); }
#[test, expected_failure(abort_code = 3, location = aresrpg_rewards::tournament_rewards)]
fun underpayment_is_refused() { refused(2); }
#[test, expected_failure(abort_code = 3, location = aresrpg_rewards::tournament_rewards)]
fun overpayment_is_refused() { refused(3); }


fun refuses_level(mode: u8) {
  let (mut s, mut t, _admin, version, clock) = setup_with_limit(0, option::some(1));
  let (mut kiosk, cap) = kiosk::new(s.ctx());
  if (mode >= 2) {
    let first = character::test_character(b"senshi".to_string(), 1, 0, s.ctx());
    let first_id = object::id(&first);
    kiosk.place(&cap, first);
    api::create_tournament_team(&mut t, b"Team".to_string(), vector[], &kiosk, &cap, first_id, &version, &clock, s.ctx());
  };
  let c = character::test_character(b"senshi".to_string(), 2, 0, s.ctx());
  let id = object::id(&c);
  kiosk.place(&cap, c);
  if (mode == 0) api::create_tournament_team(&mut t, b"Team".to_string(), vector[], &kiosk, &cap, id, &version, &clock, s.ctx())
  else if (mode == 2) api::join_tournament_team(&mut t, 0, 0, &kiosk, &cap, id, &version, &clock, s.ctx())
  else api::register_tournament(&mut t, if (mode == 3) option::some(0) else option::none(), 0, b"Team".to_string(), vector[],
    coin::zero<SUI>(s.ctx()), &kiosk, &cap, id, &version, &clock, s.ctx());
  abort 999
}
#[test, expected_failure(abort_code = 3201, location = aresrpg::tournament)]
fun free_creation_enforces_the_level_limit() { refuses_level(0); }
#[test, expected_failure(abort_code = 3201, location = aresrpg::tournament)]
fun registration_enforces_the_level_limit() { refuses_level(1); }
#[test, expected_failure(abort_code = 3201, location = aresrpg::tournament)]
fun free_join_enforces_the_level_limit() { refuses_level(2); }
#[test, expected_failure(abort_code = 3201, location = aresrpg::tournament)]
fun paid_join_enforces_the_level_limit() { refuses_level(3); }

#[test]
fun pre_upgrade_tournaments_without_rules_remain_free_and_unrestricted() {
  let (mut s, mut t, admin, version, clock) = setup(0);
  tournament::remove_rules_for_testing(&mut t);
  let c = character::test_character(b"senshi".to_string(), 200, 0, s.ctx());
  let id = object::id(&c);
  let (mut kiosk, cap) = kiosk::new(s.ctx());
  kiosk.place(&cap, c);
  api::register_tournament(&mut t, option::none(), 0, b"Legacy".to_string(), vector[], coin::zero<SUI>(s.ctx()),
    &kiosk, &cap, id, &version, &clock, s.ctx());
  character::destroy(kiosk.take<character::Character>(&cap, id));
  kiosk.close_and_withdraw(cap, s.ctx()).destroy_zero();
  fixture::cleanup(t, admin, version, clock, s);
}
