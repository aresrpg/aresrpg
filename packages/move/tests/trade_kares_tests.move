// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
#[test_only]
module aresrpg::trade_kares_tests;

use aresrpg::{trade, version};
use sui::{coin, test_scenario};

const A: address = @0xA;
const B: address = @0xB;

// Two persisted senders fund a real escrow. Exercise editable withdrawals before the
// terminal path, so the conservation assertions include every intermediate balance.
fun funded(): test_scenario::Scenario {
  let mut scenario = test_scenario::begin(A);
  version::test_init(scenario.ctx());
  scenario.next_tx(A);
  let version = scenario.take_shared<version::Version>();
  trade::create(B, &version, scenario.ctx());
  test_scenario::return_shared(version);
  scenario.next_tx(B);
  let version = scenario.take_shared<version::Version>();
  let mut row = scenario.take_shared<trade::Trade>();
  trade::join(&mut row, 0, &version, scenario.ctx());
  trade::put_sui(&mut row, coin::mint_for_testing(20, scenario.ctx()), 1, &version, scenario.ctx());
  test_scenario::return_shared(row);
  test_scenario::return_shared(version);
  scenario.next_tx(A);
  let version = scenario.take_shared<version::Version>();
  let mut row = scenario.take_shared<trade::Trade>();
  trade::put_kares(&mut row, coin::mint_for_testing(12, scenario.ctx()), 2, &version, scenario.ctx());
  let withdrawn = trade::take_kares(&mut row, 2, 3, &version, scenario.ctx());
  assert!(coin::value(&withdrawn) == 2, 0);
  coin::burn_for_testing(withdrawn);
  test_scenario::return_shared(row);
  test_scenario::return_shared(version);
  scenario
}

fun accept_both(scenario: &mut test_scenario::Scenario) {
  scenario.next_tx(A);
  let version = scenario.take_shared<version::Version>();
  let mut row = scenario.take_shared<trade::Trade>();
  trade::accept(&mut row, 4, &version, scenario.ctx());
  test_scenario::return_shared(row);
  test_scenario::return_shared(version);
  scenario.next_tx(B);
  let version = scenario.take_shared<version::Version>();
  let mut row = scenario.take_shared<trade::Trade>();
  trade::accept(&mut row, 4, &version, scenario.ctx());
  test_scenario::return_shared(row);
  test_scenario::return_shared(version);
}

#[test]
fun cross_currency_settlement_and_cancellation_conserve_both_assets() {
  exercise(false);
  exercise(true);
}

fun exercise(cancel: bool) {
  let mut scenario = funded();
  if (!cancel) accept_both(&mut scenario);
  scenario.next_tx(A);
  let version = scenario.take_shared<version::Version>();
  let mut row = scenario.take_shared<trade::Trade>();
  if (cancel) {
    trade::cancel(&mut row, 4, &version, scenario.ctx());
    let coin = trade::recover_kares(&mut row, &version, scenario.ctx());
    assert!(coin.value() == 10, 1);
    coin::burn_for_testing(coin);
  } else {
    let coin = trade::claim_sui(&mut row, &version, scenario.ctx());
    assert!(coin.value() == 20, 2);
    coin::burn_for_testing(coin);
  };
  test_scenario::return_shared(row);
  test_scenario::return_shared(version);
  scenario.next_tx(B);
  let version = scenario.take_shared<version::Version>();
  let mut row = scenario.take_shared<trade::Trade>();
  if (cancel) {
    let coin = trade::recover_sui(&mut row, &version, scenario.ctx());
    assert!(coin.value() == 20, 3);
    coin::burn_for_testing(coin);
  } else {
    let coin = trade::claim_kares(&mut row, &version, scenario.ctx());
    assert!(coin.value() == 10, 4);
    coin::burn_for_testing(coin);
  };
  trade::close(row, &version, scenario.ctx());
  test_scenario::return_shared(version);
  scenario.next_tx(A);
  assert!(!test_scenario::has_most_recent_shared<trade::Trade>(), 5);
  scenario.end();
}

#[test, expected_failure(abort_code = 2603, location = aresrpg_math::trade_state)]
fun a_stale_kares_edit_cannot_change_an_accepted_offer() {
  let mut scenario = funded();
  scenario.next_tx(A);
  let version = scenario.take_shared<version::Version>();
  let mut row = scenario.take_shared<trade::Trade>();
  trade::accept(&mut row, 4, &version, scenario.ctx());
  let _coin = trade::take_kares(&mut row, 1, 3, &version, scenario.ctx());
  abort 999
}

#[test, expected_failure(abort_code = 2601, location = aresrpg_math::trade_state)]
fun outsiders_cannot_take_kares() {
  let mut scenario = funded();
  accept_both(&mut scenario);
  scenario.next_tx(@0xC);
  let version = scenario.take_shared<version::Version>();
  let mut row = scenario.take_shared<trade::Trade>();
  let _coin = trade::claim_kares(&mut row, &version, scenario.ctx());
  abort 999
}

#[test, expected_failure(abort_code = 2611, location = aresrpg_math::trade_state)]
fun kares_cannot_be_claimed_twice() {
  let mut scenario = funded();
  accept_both(&mut scenario);
  scenario.next_tx(B);
  let version = scenario.take_shared<version::Version>();
  let mut row = scenario.take_shared<trade::Trade>();
  coin::burn_for_testing(trade::claim_kares(&mut row, &version, scenario.ctx()));
  let _coin = trade::claim_kares(&mut row, &version, scenario.ctx());
  abort 999
}

#[test, expected_failure(abort_code = 0, location = sui::balance)]
fun outstanding_kares_prevents_close_even_after_sui_was_claimed() {
  let mut scenario = funded();
  accept_both(&mut scenario);
  scenario.next_tx(A);
  let version = scenario.take_shared<version::Version>();
  let mut row = scenario.take_shared<trade::Trade>();
  coin::burn_for_testing(trade::claim_sui(&mut row, &version, scenario.ctx()));
  trade::close(row, &version, scenario.ctx());
  abort 999
}
