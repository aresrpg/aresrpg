// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
#[test_only]
module aresrpg::tournament_tests;

use aresrpg::{api, character, tournament, version};
use aresrpg_control::admin;
use aresrpg_rewards::economy;
use aresrpg_math::tournament_bracket as bracket;
use sui::{clock, coin, kiosk, random, sui::SUI, test_scenario};

public struct Token has drop {}
const ADMIN: address = @0xA;

public fun setup(format: u64, bps: vector<u64>): (test_scenario::Scenario, tournament::Tournament,
  admin::AdminCap, version::Version, clock::Clock) {
  let mut scenario = test_scenario::begin(@0x0);
  random::create_for_testing(scenario.ctx());
  version::test_init(scenario.ctx());
  scenario.next_tx(ADMIN);
  let admin = admin::cap_for_testing(scenario.ctx());
  let version = scenario.take_shared<version::Version>();
  let economy = economy::economy_for_testing<Token>(@0x1.to_id(), @0x2.to_id(), scenario.ctx());
  let mut clock = clock::create_for_testing(scenario.ctx());
  clock::increment_for_testing(&mut clock, 1_000);
  tournament::create(&admin, b"Cup".to_string(), format, 1_000_000, bps, bps,
    vector[], &version, &clock, scenario.ctx());
  economy::share_for_testing(economy);
  scenario.next_tx(ADMIN);
  let t = scenario.take_shared<tournament::Tournament>();
  (scenario, t, admin, version, clock)
}

public fun register(t: &mut tournament::Tournament, team: u64, format: u64,
  clock: &clock::Clock, scenario: &mut test_scenario::Scenario) {
  scenario.next_tx(sui::address::from_u256((team + 100) as u256));
  let version = scenario.take_shared<version::Version>();
  let mut seat = 0;
  while (seat < format) {
    let character = character::test_character(b"senshi".to_string(), 1, 0, scenario.ctx());
    let (mut kiosk, cap) = kiosk::new(scenario.ctx());
    let id = object::id(&character);
    kiosk.place(&cap, character);
    if (seat == 0) api::create_tournament_team(t, b"Team".to_string(), vector[], &kiosk, &cap, id, &version, clock, scenario.ctx())
    else api::join_tournament_team(t, team, 0, &kiosk, &cap, id, &version, clock, scenario.ctx());
    character::destroy(kiosk.take<character::Character>(&cap, id));
    kiosk.close_and_withdraw(cap, scenario.ctx()).destroy_zero();
    seat = seat + 1;
  };
  test_scenario::return_shared(version);
}

public fun cleanup(t: tournament::Tournament, admin: admin::AdminCap, version: version::Version,
  clock: clock::Clock, scenario: test_scenario::Scenario) {
  tournament::destroy_for_testing(t);
  admin::destroy_for_testing(admin);
  clock::destroy_for_testing(clock);
  test_scenario::return_shared(version);
  scenario.end();
}

public fun payout<T>(scenario: &test_scenario::Scenario, owner: address): u64 {
  if (!test_scenario::has_most_recent_for_address<coin::Coin<T>>(owner)) return 0;
  let coin = scenario.take_from_address<coin::Coin<T>>(owner);
  let amount = coin.value();
  coin::burn_for_testing(coin);
  amount
}

#[test]
fun prizes_conserve_both_assets_and_include_all_registered_seats() {
  let (mut scenario, mut t, admin, version, mut clock) = setup(3, vector[5000, 2500, 1500, 500, 500]);
  tournament::donate_sui(&mut t, coin::mint_for_testing<SUI>(1007, scenario.ctx()), &version, &clock);
  let mut pool = fund_kares(&mut t, 3000, &version, &clock, &mut scenario);
  tournament::donate_kares(&t, &mut pool, coin::mint_for_testing<Token>(11, scenario.ctx()), &version, &clock);
  test_scenario::return_shared(version);
  let mut team = 0;
  while (team < 8) { register(&mut t, team, 3, &clock, &mut scenario); team = team + 1; };
  scenario.next_tx(ADMIN);
  let version = scenario.take_shared<version::Version>();
  let randomness = scenario.take_shared<random::Random>();
  clock::increment_for_testing(&mut clock, 999_000);
  api::start_tournament(&mut t, &randomness, &version, &clock, scenario.ctx());
  test_scenario::return_shared(randomness);
  let mut matches = tournament::matches_for_testing(&t);
  while (!bracket::done(&matches)) {
    let mut i = 0;
    while (i < matches.length()) {
      if (bracket::state(&matches[i]) == 1) {
        clock::increment_for_testing(&mut clock, 10);
        tournament::resolve_for_testing(&mut t, i, option::some(0), true, &clock, scenario.ctx());
      };
      i = i + 1;
    };
    matches = tournament::matches_for_testing(&t);
  };
  tournament::refund_kares(&t, &mut pool, &version, scenario.ctx());
  tournament::refund_kares(&t, &mut pool, &version, scenario.ctx());
  assert!(tournament::status_for_testing(&t) == b"finished".to_string(), 0);
  scenario.next_tx(ADMIN);
  let (mut sui_paid, mut token_paid) = (payout<SUI>(&scenario, ADMIN), payout<Token>(&scenario, ADMIN));
  // Claim in reverse order; the caller cannot redirect any recipient's money.
  team = 8;
  while (team > 0) {
    team = team - 1;
    assert!(tournament::place_for_testing(&t, team) > 0, 1);
    let mut seat = 3;
    while (seat > 0) {
      seat = seat - 1;
      tournament::claim_sui(&mut t, team, seat, &version, scenario.ctx());
      tournament::claim_kares(&t, &mut pool, team, seat, &version, scenario.ctx());
      scenario.next_tx(ADMIN);
      let owner = sui::address::from_u256((team + 100) as u256);
      sui_paid = sui_paid + payout<SUI>(&scenario, owner);
      token_paid = token_paid + payout<Token>(&scenario, owner);
    };
  };
  assert!(sui_paid == 1007 && token_paid == 3011, 2);
  let (sui_left, token_left) = (tournament::sui_balance_for_testing(&t), tournament::pool_balance_for_testing(&pool));
  assert!(sui_left == 0 && token_left == 0, 3);
  tournament::destroy_pool_for_testing(pool);
  cleanup(t, admin, version, clock, scenario);
}

#[test]
fun unopened_matches_expire_without_a_fight_or_admin() {
  let (mut scenario, mut t, admin, version, mut clock) = setup(1, vector[10_000, 0, 0, 0, 0]);
  tournament::donate_sui(&mut t, coin::mint_for_testing<SUI>(777, scenario.ctx()), &version, &clock);
  test_scenario::return_shared(version);
  register(&mut t, 0, 1, &clock, &mut scenario);
  register(&mut t, 1, 1, &clock, &mut scenario);
  scenario.next_tx(ADMIN);
  let version = scenario.take_shared<version::Version>();
  let randomness = scenario.take_shared<random::Random>();
  clock::increment_for_testing(&mut clock, 999_000);
  api::start_tournament(&mut t, &randomness, &version, &clock, scenario.ctx());
  test_scenario::return_shared(randomness);
  clock::increment_for_testing(&mut clock, 60_000);
  scenario.next_tx(@0x999);
  tournament::crank_unopened(&mut t, 0, &version, &clock, scenario.ctx());
  assert!(tournament::status_for_testing(&t) == b"finished".to_string(), 0);
  assert!(tournament::place_for_testing(&t, 0) == 0 && tournament::place_for_testing(&t, 1) == 0, 1);
  scenario.next_tx(ADMIN);
  assert!(payout<SUI>(&scenario, ADMIN) == 777, 2);
  cleanup(t, admin, version, clock, scenario);
}

#[test]
fun cancellation_returns_donations_to_the_original_organizer() {
  let (mut scenario, mut t, admin, version, clock) = setup(1, vector[10_000, 0, 0, 0, 0]);
  tournament::donate_sui(&mut t, coin::mint_for_testing<SUI>(111, scenario.ctx()), &version, &clock);
  let mut pool = fund_kares(&mut t, 222, &version, &clock, &mut scenario);
  scenario.next_tx(@0x99);
  tournament::cancel(&mut t, &admin, &version, scenario.ctx());
  tournament::refund_kares(&t, &mut pool, &version, scenario.ctx());
  tournament::destroy_pool_for_testing(pool);
  scenario.next_tx(ADMIN);
  assert!(payout<SUI>(&scenario, ADMIN) == 111 && payout<Token>(&scenario, ADMIN) == 222, 0);
  cleanup(t, admin, version, clock, scenario);
}

fun coin_refusal(no_winner: bool, early: bool) {
  let (mut s, mut t, _admin, version, mut clock) = setup(1, vector[10_000,0,0,0,0]);
  test_scenario::return_shared(version);
  register(&mut t, 0, 1, &clock, &mut s);
  register(&mut t, 1, 1, &clock, &mut s);
  s.next_tx(ADMIN);
  let version = s.take_shared<version::Version>();
  let randomness = s.take_shared<random::Random>();
  clock::increment_for_testing(&mut clock, 999_000);
  api::start_tournament(&mut t, &randomness, &version, &clock, s.ctx());
  if (early) { tournament::crank_unopened(&mut t, 0, &version, &clock, s.ctx()); abort 999 };
  clock::increment_for_testing(&mut clock, 60_000);
  if (no_winner) {
    tournament::crank_unopened(&mut t, 0, &version, &clock, s.ctx());
    tournament::claim_sui(&mut t, 0, 0, &version, s.ctx()); abort 999
  };
  let matches = tournament::matches_for_testing(&t);
  let team = bracket::team(&matches[0], 0);
  tournament::resolve_for_testing(&mut t, 0, option::some(0), true, &clock, s.ctx());
  tournament::claim_sui(&mut t, team, 0, &version, s.ctx());
  tournament::claim_sui(&mut t, team, 0, &version, s.ctx());
  abort 999
}
#[test, expected_failure(abort_code = 3206, location = aresrpg::tournament)]
fun repeated_coin_claim_cannot_drain_other_seats() { coin_refusal(false, false); }
#[test, expected_failure(abort_code = 3206, location = aresrpg::tournament)]
fun no_winner_does_not_entitle_a_coin_claim() { coin_refusal(true, false); }
#[test, expected_failure(abort_code = 3205, location = aresrpg::tournament)]
fun unopened_match_cannot_be_expired_before_sixty_seconds() { coin_refusal(false, true); }

public fun fund_kares(t: &mut tournament::Tournament, amount: u64, version: &version::Version,
  clock: &clock::Clock, s: &mut test_scenario::Scenario): tournament::KaresPool<Token> {
  let economy = s.take_shared<economy::Economy>();
  tournament::create_kares_pool(t, &economy, coin::mint_for_testing<Token>(amount, s.ctx()), version, clock, s.ctx());
  test_scenario::return_shared(economy);
  s.next_tx(ADMIN);
  s.take_shared<tournament::KaresPool<Token>>()
}


#[test]
fun sui_tournament_creation_does_not_require_an_economy_or_currency() {
  let mut s = test_scenario::begin(@0xA);
  version::test_init(s.ctx());
  s.next_tx(@0xA);
  let admin = admin::cap_for_testing(s.ctx());
  let version = s.take_shared<version::Version>();
  let mut clock = clock::create_for_testing(s.ctx());
  clock::increment_for_testing(&mut clock, 1);
  tournament::create(&admin, b"SUI only".to_string(), 1, 1000, vector[10000,0,0,0,0], vector[10000,0,0,0,0], vector[], &version, &clock, s.ctx());
  s.next_tx(@0xA);
  let mut t = s.take_shared<tournament::Tournament>();
  tournament::donate_sui(&mut t, coin::mint_for_testing<SUI>(5, s.ctx()), &version, &clock);
  tournament::cancel(&mut t, &admin, &version, s.ctx());
  s.next_tx(@0xA);
  assert!(payout<SUI>(&s, @0xA) == 5, 0);
  cleanup(t, admin, version, clock, s);
}

public enum PoolRefusal has drop { Repeat, Foreign, EarlyRefund, EarlyClaim, AbsentClaim }
fun refuse_pool(mode: PoolRefusal) {
  let (mut s, mut t, admin, version, mut clock) = setup(1, vector[10000,0,0,0,0]);
  let mut pool = fund_kares(&mut t, 9, &version, &clock, &mut s);
  match (mode) {
    PoolRefusal::Repeat => {
      let economy = s.take_shared<economy::Economy>();
      tournament::create_kares_pool(&mut t, &economy, coin::mint_for_testing<Token>(1, s.ctx()), &version, &clock, s.ctx());
    },
    PoolRefusal::Foreign => {
      tournament::create(&admin, b"Other".to_string(), 1, 1000000, vector[10000,0,0,0,0], vector[10000,0,0,0,0], vector[], &version, &clock, s.ctx());
      s.next_tx(ADMIN);
      let other = s.take_shared<tournament::Tournament>();
      tournament::donate_kares(&other, &mut pool, coin::mint_for_testing<Token>(1, s.ctx()), &version, &clock);
    },
    PoolRefusal::EarlyRefund => tournament::refund_kares(&t, &mut pool, &version, s.ctx()),
    PoolRefusal::EarlyClaim => tournament::claim_kares(&t, &mut pool, 0, 0, &version, s.ctx()),
    PoolRefusal::AbsentClaim => {
      test_scenario::return_shared(version);
      register(&mut t, 0, 1, &clock, &mut s);
      register(&mut t, 1, 1, &clock, &mut s);
      s.next_tx(ADMIN);
      let version = s.take_shared<version::Version>();
      let randomness = s.take_shared<random::Random>();
      clock::increment_for_testing(&mut clock, 999_000);
      api::start_tournament(&mut t, &randomness, &version, &clock, s.ctx());
      clock::increment_for_testing(&mut clock, 60000);
      tournament::crank_unopened(&mut t, 0, &version, &clock, s.ctx());
      tournament::claim_kares(&t, &mut pool, 0, 0, &version, s.ctx());
    },
  };
  abort 999
}
#[test, expected_failure(abort_code = 3201, location = aresrpg::tournament)]
fun a_second_pool_cannot_replace_the_funded_one() { refuse_pool(PoolRefusal::Repeat); }
#[test, expected_failure(abort_code = 3206, location = aresrpg::tournament)]
fun a_foreign_pool_cannot_accept_this_tournaments_donations() { refuse_pool(PoolRefusal::Foreign); }
#[test, expected_failure(abort_code = 3202, location = aresrpg::tournament)]
fun open_pools_cannot_be_refunded() { refuse_pool(PoolRefusal::EarlyRefund); }
#[test, expected_failure(abort_code = 3202, location = aresrpg::tournament)]
fun open_pools_cannot_be_claimed() { refuse_pool(PoolRefusal::EarlyClaim); }
#[test, expected_failure(abort_code = 3206, location = aresrpg::tournament)]
fun no_show_does_not_entitle_a_token_claim() { refuse_pool(PoolRefusal::AbsentClaim); }

#[test, expected_failure(abort_code = 1730, location = aresrpg::fight)]
fun unmanaged_fight_cannot_accept_tournament_termination() {
  let mut ctx = tx_context::dummy();
  let mut fight = aresrpg::fight::retry_boundary_fight_for_testing(1, &mut ctx);
  aresrpg::fight::end_tournament(&mut fight, option::none()); abort 999
}
