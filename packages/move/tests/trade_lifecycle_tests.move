// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
#[test_only]
module aresrpg::trade_lifecycle_tests;

use aresrpg::{api, item, trade, version};
use aresrpg_seed::item_rows;
use sui::{coin, kiosk, package::Publisher, random, test_scenario, transfer_policy};

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
  trade::put_sui(&mut row, coin::mint_for_testing(12, scenario.ctx()), 2, &version, scenario.ctx());
  let withdrawn = trade::take_sui(&mut row, 2, 3, &version, scenario.ctx());
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
fun both_claim_orders_conserve_funds_and_close() {
  settle(A, B, 20, 10);
  settle(B, A, 10, 20);
}

fun settle(first: address, last: address, first_amount: u64, last_amount: u64) {
  let mut scenario = funded();
  accept_both(&mut scenario);
  scenario.next_tx(first);
  let version = scenario.take_shared<version::Version>();
  let mut row = scenario.take_shared<trade::Trade>();
  let payment = trade::claim_sui(&mut row, &version, scenario.ctx());
  assert!(payment.value() == first_amount, 1);
  coin::burn_for_testing(payment);
  test_scenario::return_shared(row);
  test_scenario::return_shared(version);
  scenario.next_tx(last);
  let version = scenario.take_shared<version::Version>();
  let mut row = scenario.take_shared<trade::Trade>();
  let payment = trade::claim_sui(&mut row, &version, scenario.ctx());
  assert!(payment.value() == last_amount, 2);
  coin::burn_for_testing(payment);
  trade::close(row, &version, scenario.ctx());
  test_scenario::return_shared(version);
  scenario.next_tx(A);
  assert!(!test_scenario::has_most_recent_shared<trade::Trade>(), 3);
  scenario.end();
}

#[test]
fun cancel_returns_each_partys_own_funds_after_disconnect() {
  let mut scenario = funded();
  scenario.next_tx(A);
  let version = scenario.take_shared<version::Version>();
  let mut row = scenario.take_shared<trade::Trade>();
  trade::cancel(&mut row, 4, &version, scenario.ctx());
  let refund = trade::recover_sui(&mut row, &version, scenario.ctx());
  assert!(refund.value() == 10, 0);
  coin::burn_for_testing(refund);
  test_scenario::return_shared(row);
  test_scenario::return_shared(version);
  scenario.next_tx(B);
  let version = scenario.take_shared<version::Version>();
  let mut row = scenario.take_shared<trade::Trade>();
  let refund = trade::recover_sui(&mut row, &version, scenario.ctx());
  assert!(refund.value() == 20, 1);
  coin::burn_for_testing(refund);
  trade::close(row, &version, scenario.ctx());
  test_scenario::return_shared(version);
  scenario.end();
}

#[test, expected_failure(abort_code = 2611, location = aresrpg_math::trade_state)]
fun a_real_payment_cannot_be_claimed_twice() {
  let mut scenario = funded();
  accept_both(&mut scenario);
  scenario.next_tx(A);
  let version = scenario.take_shared<version::Version>();
  let mut row = scenario.take_shared<trade::Trade>();
  coin::burn_for_testing(trade::claim_sui(&mut row, &version, scenario.ctx()));
  let _duplicate = trade::claim_sui(&mut row, &version, scenario.ctx());
  abort 999
}

#[test, expected_failure(abort_code = 2601, location = aresrpg_math::trade_state)]
fun an_outsider_cannot_claim_a_funded_escrow() {
  let mut scenario = funded();
  accept_both(&mut scenario);
  scenario.next_tx(@0xC);
  let version = scenario.take_shared<version::Version>();
  let mut row = scenario.take_shared<trade::Trade>();
  let _stolen = trade::claim_sui(&mut row, &version, scenario.ctx());
  abort 999
}

#[test]
fun escrowed_item_withdraws_recovers_or_transfers_without_duplication() {
  item_exit(A, B, true, false);
  item_exit(A, B, false, false);
  item_exit(B, A, true, false);
  item_exit(B, A, false, false);
}

fun item_exit(seller: address, buyer: address, cancel: bool, claim_self: bool) {
  let mut scenario = funded();
  scenario.next_tx(seller);
  item::test_init(scenario.ctx());
  scenario.next_tx(seller);
  let publisher = scenario.take_from_sender<Publisher>();
  let (policy, policy_cap) = transfer_policy::new<item::Item>(&publisher, scenario.ctx());
  publisher.burn();
  let template = item_rows::template_for_testing(b"fang".to_string(), b"resource".to_string(), scenario.ctx());
  let mut entropy = random::new_generator_from_seed_for_testing(b"escrow");
  let offered = item::mint(&template, 7, &mut entropy, scenario.ctx());
  let item_id = object::id(&offered);
  let (mut kiosk, cap) = kiosk::new(scenario.ctx());
  let kiosk_id = object::id(&kiosk);
  kiosk.place(&cap, offered);
  let version = scenario.take_shared<version::Version>();
  let mut row = scenario.take_shared<trade::Trade>();
  let purchase = kiosk.list_with_purchase_cap<item::Item>(&cap, item_id, 0, scenario.ctx());
  api::trade_put_item(&mut row, purchase, 4, &version, scenario.ctx());
  kiosk.return_purchase_cap(api::trade_take_item(&mut row, item_id, 5, &version, scenario.ctx()));
  assert!(kiosk.has_item(item_id) && !kiosk.is_listed(item_id), 0);
  let purchase = kiosk.list_with_purchase_cap<item::Item>(&cap, item_id, 0, scenario.ctx());
  api::trade_put_item(&mut row, purchase, 6, &version, scenario.ctx());
  if (cancel) {
    trade::cancel(&mut row, 7, &version, scenario.ctx());
    kiosk.return_purchase_cap(api::trade_recover_item(&mut row, item_id, &version, scenario.ctx()));
    assert!(!kiosk.is_listed(item_id), 1);
    item::destroy_for_testing(kiosk.take(&cap, item_id));
  } else trade::accept(&mut row, 7, &version, scenario.ctx());
  transfer::public_share_object(kiosk);
  transfer::public_transfer(cap, seller);
  test_scenario::return_shared(row);
  test_scenario::return_shared(version);
  scenario.next_tx(buyer);
  if (!cancel) {
    let version = scenario.take_shared<version::Version>();
    let mut row = scenario.take_shared<trade::Trade>();
    let mut kiosk = scenario.take_shared<kiosk::Kiosk>();
    trade::accept(&mut row, 7, &version, scenario.ctx());
    if (claim_self) {
      test_scenario::return_shared(row);
      test_scenario::return_shared(version);
      test_scenario::return_shared(kiosk);
      scenario.next_tx(seller);
      let version = scenario.take_shared<version::Version>();
      let mut row = scenario.take_shared<trade::Trade>();
      let mut kiosk = scenario.take_shared<kiosk::Kiosk>();
      let (_stolen, _request) = api::trade_claim_item(&mut row, item_id, &mut kiosk, &version, scenario.ctx());
      abort 999
    };
    let (received, request) = api::trade_claim_item(&mut row, item_id, &mut kiosk, &version, scenario.ctx());
    assert!(object::id(&received) == item_id && received.amount() == 7, 2);
    let (transferred, paid, from) = policy.confirm_request(request);
    assert!(transferred == item_id && paid == 0 && from == kiosk_id, 3);
    assert!(!kiosk.has_item(item_id), 4);
    transfer::public_transfer(received, buyer);
    test_scenario::return_shared(kiosk);
    test_scenario::return_shared(row);
    test_scenario::return_shared(version);
    scenario.next_tx(buyer);
    let owned = scenario.take_from_sender<item::Item>();
    assert!(object::id(&owned) == item_id && owned.amount() == 7, 5);
    item::destroy_for_testing(owned);
  };
  item_rows::destroy_for_testing(template);
  transfer_policy::destroy_and_withdraw(policy, policy_cap, scenario.ctx()).into_balance().destroy_zero();
  scenario.end();
}

#[test]
fun either_party_can_end_an_unfunded_request() {
  end_request(A);
  end_request(B);
}

fun end_request(sender: address) {
  let mut scenario = test_scenario::begin(A);
  version::test_init(scenario.ctx());
  scenario.next_tx(A);
  let version = scenario.take_shared<version::Version>();
  trade::create(B, &version, scenario.ctx());
  test_scenario::return_shared(version);
  scenario.next_tx(sender);
  let version = scenario.take_shared<version::Version>();
  let row = scenario.take_shared<trade::Trade>();
  trade::end_request(row, 0, &version, scenario.ctx());
  test_scenario::return_shared(version);
  scenario.next_tx(sender);
  assert!(!test_scenario::has_most_recent_shared<trade::Trade>(), 0);
  scenario.end();
}

#[test, expected_failure(abort_code = 2605, location = aresrpg_math::trade_state)]
fun a_settler_cannot_take_back_their_own_offered_item() { item_exit(A, B, false, true); }
