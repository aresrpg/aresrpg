// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
#[test_only]
module aresrpg::mastery_kares_tests;

use aresrpg::{api, item::{Self, Item}, mastery::{Self, MasteryOffer}, version};
use aresrpg_control::admin::{Self, AdminCap};
use aresrpg_kares::{kares::{Self, Genesis, KARES}, offering};
use aresrpg_seed::{item_rows::{Self, ItemTemplate}, registry::{Self, Registry}};
use sui::{
  clock,
  coin::Coin,
  coin_registry::Currency,
  kiosk::{Self, Kiosk, KioskOwnerCap},
  package::Publisher,
  test_scenario::{Self, Scenario},
  transfer_policy::{Self, TransferPolicy, TransferPolicyCap},
};

const OWNER: address = @0xA;
const COST: u64 = 100;

public struct Fixture {
  scenario: Scenario,
  admin: AdminCap,
  root: Registry,
  template: ItemTemplate,
  offer: MasteryOffer,
  currency: Currency<KARES>,
  payment: Coin<KARES>,
  kiosk: Kiosk,
  kiosk_cap: KioskOwnerCap,
  policy: TransferPolicy<Item>,
  policy_cap: TransferPolicyCap<Item>,
  publisher: Publisher,
}

fun fixture(cost: u64): Fixture {
  let mut scenario = test_scenario::begin(OWNER);
  item::test_init(scenario.ctx());
  version::test_init(scenario.ctx());
  kares::init_for_testing(scenario.ctx());
  scenario.next_tx(OWNER);
  let genesis = scenario.take_from_sender<Genesis>();
  let clock = clock::create_for_testing(scenario.ctx());
  let upgrade_cap = sui::package::test_publish(object::id_from_address(@aresrpg_kares), scenario.ctx());
  offering::setup(genesis, upgrade_cap, 5_000_000_000, 20_000_000_000, 100,
    OWNER, OWNER, OWNER, @0xB, scenario.ctx());
  clock.destroy_for_testing();
  let admin = admin::cap_for_testing(scenario.ctx());
  let mut root = registry::registry_for_testing(scenario.ctx());
  let template = item_rows::template_for_testing(b"mastery_reward".to_string(), b"resource".to_string(), scenario.ctx());
  mastery::new_offer(&admin, &mut root, &template, cost, true, scenario.ctx());
  scenario.next_tx(OWNER);
  let offer = scenario.take_shared<MasteryOffer>();
  let currency = scenario.take_from_address<Currency<KARES>>(@0xC);
  let payment = scenario.take_from_sender<Coin<KARES>>();
  let publisher = scenario.take_from_sender<Publisher>();
  let (policy, policy_cap) = transfer_policy::new<Item>(&publisher, scenario.ctx());
  let (kiosk, kiosk_cap) = kiosk::new(scenario.ctx());
  Fixture { scenario, admin, root, template, offer, currency, payment, kiosk, kiosk_cap, policy, policy_cap, publisher }
}

fun finish(fixture: Fixture) {
  let Fixture { scenario, admin, root, template, offer, currency, payment, kiosk, kiosk_cap, policy, policy_cap, publisher } = fixture;
  test_scenario::return_shared(offer);
  test_scenario::return_to_address(@0xC, currency);
  transfer::public_transfer(payment, OWNER);
  transfer::public_share_object(kiosk);
  transfer::public_transfer(kiosk_cap, OWNER);
  transfer::public_share_object(policy);
  transfer::public_transfer(policy_cap, OWNER);
  publisher.burn();
  registry::destroy_for_testing(root);
  admin::destroy_for_testing(admin);
  item_rows::destroy_for_testing(template);
  scenario.end();
}

fun buy_kares(fixture: &mut Fixture, amount: u64, existing: Option<ID>) {
  let payment = fixture.payment.split(amount, fixture.scenario.ctx());
  let version = fixture.scenario.take_shared<version::Version>();
  api::redeem_mastery_offer_kares(&mut fixture.currency, payment, &fixture.offer, &fixture.template,
    existing, &mut fixture.kiosk, &fixture.kiosk_cap, &fixture.policy, &version, fixture.scenario.ctx());
  test_scenario::return_shared(version);
}

#[test]
fun both_payment_routes_deliver_the_same_locked_item_and_only_kares_reduces_supply() {
  let mut state = fixture(COST);
  let fixture = &mut state;
  let mut mastery = mastery::mastery_for_testing(250, fixture.scenario.ctx());
  let target = item::mint_plain(&fixture.template, 1, fixture.scenario.ctx());
  let target_id = object::id(&target);
  fixture.kiosk.lock(&fixture.kiosk_cap, &fixture.policy, target);
  let supply = fixture.currency.total_supply().destroy_some();
  let version = fixture.scenario.take_shared<version::Version>();
  api::redeem_mastery_offer(&mut mastery, &fixture.offer, &fixture.template, option::some(target_id),
    &mut fixture.kiosk, &fixture.kiosk_cap, &fixture.policy, &version, fixture.scenario.ctx());
  assert!(mastery::points_for_testing(&mastery) == 150);
  assert!(fixture.currency.total_supply() == option::some(supply));
  assert!(fixture.kiosk.borrow<Item>(&fixture.kiosk_cap, target_id).amount() == 2);
  let payment = fixture.payment.split(COST * kares::unit(), fixture.scenario.ctx());
  api::redeem_mastery_offer_kares(&mut fixture.currency, payment, &fixture.offer, &fixture.template,
    option::some(target_id), &mut fixture.kiosk, &fixture.kiosk_cap, &fixture.policy, &version, fixture.scenario.ctx());
  test_scenario::return_shared(version);
  assert!(mastery::points_for_testing(&mastery) == 150);
  assert!(fixture.currency.total_supply() == option::some(supply - COST * kares::unit()));
  let item = fixture.kiosk.borrow<Item>(&fixture.kiosk_cap, target_id);
  assert!(item.amount() == 3 && item.template() == object::id(&fixture.template));
  assert!(!item.has_stats() && fixture.kiosk.is_locked(target_id));
  mastery::destroy_for_testing(mastery);
  finish(state);
}

#[test]
fun kares_redemption_needs_no_mastery_object_or_existing_stack() {
  let mut state = fixture(COST);
  let fixture = &mut state;
  assert!(fixture.kiosk.item_count() == 0);
  buy_kares(fixture, COST * kares::unit(), option::none());
  assert!(fixture.kiosk.item_count() == 1);
  assert!(test_scenario::ids_for_address<mastery::Mastery>(OWNER).is_empty());
  finish(state);
}

#[test]
fun retirement_and_reenable_preserve_price_and_content_revision() {
  let mut state = fixture(COST);
  let fixture = &mut state;
  let revision = registry::revision(&fixture.root);
  mastery::set_enabled(&fixture.admin, &mut fixture.root, &mut fixture.offer, false, fixture.scenario.ctx());
  assert!(registry::revision(&fixture.root) == revision + 1);
  mastery::set_offer(&fixture.admin, &mut fixture.root, &mut fixture.offer, COST, true, fixture.scenario.ctx());
  assert!(registry::revision(&fixture.root) == revision + 2);
  buy_kares(fixture, COST * kares::unit(), option::none());
  assert!(fixture.kiosk.item_count() == 1);
  finish(state);
}

#[test, expected_failure(abort_code = 3111, location = aresrpg::mastery)]
fun existing_offer_price_is_immutable() {
  let mut state = fixture(COST);
  let fixture = &mut state;
  mastery::set_offer(&fixture.admin, &mut fixture.root, &mut fixture.offer, COST + 1, true, fixture.scenario.ctx());
  finish(state);
}

#[test, expected_failure(abort_code = 3112, location = aresrpg::mastery)]
fun underpayment_cannot_purchase_an_offer() {
  let mut state = fixture(COST);
  let fixture = &mut state;
  buy_kares(fixture, COST * kares::unit() - 1, option::none());
  finish(state);
}

#[test, expected_failure(abort_code = 3112, location = aresrpg::mastery)]
fun overpayment_is_rejected_instead_of_burning_the_excess() {
  let mut state = fixture(COST);
  let fixture = &mut state;
  buy_kares(fixture, COST * kares::unit() + 1, option::none());
  finish(state);
}

#[test, expected_failure(abort_code = 3107, location = aresrpg::mastery)]
fun retired_offer_rejects_kares_payment() {
  let mut state = fixture(COST);
  let fixture = &mut state;
  mastery::set_enabled(&fixture.admin, &mut fixture.root, &mut fixture.offer, false, fixture.scenario.ctx());
  buy_kares(fixture, COST * kares::unit(), option::none());
  finish(state);
}

#[test, expected_failure(abort_code = 3107, location = aresrpg::mastery)]
fun retired_offer_rejects_points_payment() {
  let mut state = fixture(COST);
  let fixture = &mut state;
  let mut mastery = mastery::mastery_for_testing(250, fixture.scenario.ctx());
  mastery::set_enabled(&fixture.admin, &mut fixture.root, &mut fixture.offer, false, fixture.scenario.ctx());
  mastery::redeem(&mut mastery, &fixture.offer, &fixture.template, option::none(),
    &mut fixture.kiosk, &fixture.kiosk_cap, &fixture.policy, fixture.scenario.ctx());
  mastery::destroy_for_testing(mastery);
  finish(state);
}

#[test, expected_failure(abort_code = 3106, location = aresrpg::mastery)]
fun kares_cannot_purchase_a_substituted_template() {
  let mut state = fixture(COST);
  let fixture = &mut state;
  let other = item_rows::template_for_testing(b"other_reward".to_string(), b"resource".to_string(), fixture.scenario.ctx());
  let payment = fixture.payment.split(COST * kares::unit(), fixture.scenario.ctx());
  mastery::redeem_kares(&mut fixture.currency, payment, &fixture.offer, &other, option::none(),
    &mut fixture.kiosk, &fixture.kiosk_cap, &fixture.policy, fixture.scenario.ctx());
  item_rows::destroy_for_testing(other);
  finish(state);
}

#[test, expected_failure(abort_code = 3108, location = aresrpg::mastery)]
fun points_still_require_sufficient_earned_balance() {
  let mut state = fixture(COST);
  let fixture = &mut state;
  let mut mastery = mastery::mastery_for_testing(COST - 1, fixture.scenario.ctx());
  mastery::redeem(&mut mastery, &fixture.offer, &fixture.template, option::none(),
    &mut fixture.kiosk, &fixture.kiosk_cap, &fixture.policy, fixture.scenario.ctx());
  mastery::destroy_for_testing(mastery);
  finish(state);
}

#[test, expected_failure(abort_code = 0, location = sui::kiosk)]
fun kares_redemption_requires_the_owning_kiosk_cap() {
  let mut state = fixture(COST);
  let fixture = &mut state;
  let (_other_kiosk, wrong_cap) = kiosk::new(fixture.scenario.ctx());
  let payment = fixture.payment.split(COST * kares::unit(), fixture.scenario.ctx());
  mastery::redeem_kares(&mut fixture.currency, payment, &fixture.offer, &fixture.template, option::none(),
    &mut fixture.kiosk, &wrong_cap, &fixture.policy, fixture.scenario.ctx());
  abort 999
}

#[test, expected_failure(abort_code = 3109, location = aresrpg::mastery)]
fun zero_offer_price_is_rejected() { finish(fixture(0)) }

#[test, expected_failure(abort_code = 3109, location = aresrpg::mastery)]
fun offer_price_must_fit_whole_kares_base_units() {
  finish(fixture(std::u64::max_value!() / kares::unit() + 1))
}
