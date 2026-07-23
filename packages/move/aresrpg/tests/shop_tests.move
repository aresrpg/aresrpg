// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// Shop (sale-gate) tests: the happy buy + pack buy (mint, ROLL stats, lock in the buyer's PERSONAL kiosk, pay
/// @treasury the exact price × quantity, refund change once, bump the supply counter), plus every abort —
/// paused, wrong template, short payment, sold-out at the cap, buy_many over-reserve, quantity 0 / over-cap, sale
/// window not-yet-open / ended, package dark, stale version — and the unlimited case that never sells out. The
/// PERSONAL-kiosk constitution is enforced by the `&PersonalKioskCap` TYPE (buy is uncallable with a plain kiosk).
/// Buys are exercised via `shop::buy_for_testing` / `buy_many_for_testing` (deterministic generator; the real
/// `&Random` `entry` runs the SAME body).
#[test_only]
module aresrpg::shop_tests;

use aresrpg::{
  admin::{Self, AdminCap},
  catalog::{Self, Catalog},
  item::{Self as item, Item, ItemTemplate},
  item_stats,
  shop::{Self as shop, Sale},
  version::{Self as version, Version}
};
use std::unit_test::{assert_eq, destroy};
use kiosk::personal_kiosk::{Self, PersonalKioskCap};
use sui::{
  clock::{Self, Clock},
  coin::{Self, Coin},
  kiosk::{Self, Kiosk},
  package::Publisher,
  sui::SUI,
  test_scenario::{Self as ts, Scenario},
  random::{Self, Random},
  transfer_policy::TransferPolicy
};

const OWNER: address = @0xA;
const BUYER: address = @0xB;
const SUPPLY: u64 = 1000;
const PRICE: u64 = 500;

// ── mirrored error values (module-local; `location` disambiguates which module aborted) ──
const ESalePaused: u64 = 101; // shop
const EInsufficientPayment: u64 = 102; // shop
const EWrongTemplate: u64 = 103; // shop
const EInvalidQuantity: u64 = 104; // shop
const ESoldOut: u64 = 105; // shop
const ESaleNotStarted: u64 = 106; // shop
const ESaleEnded: u64 = 107; // shop
const ESaleNotPaused: u64 = 110; // shop (burn_sale refuses an active sale)
const V_EWrongVersion: u64 = 101; // version
const V_ENotEnabled: u64 = 102; // version

// ╔════════════════ [ Harness ] ══════════════════════════════════════════════ ]

/// Stand up the package, optionally enable it, author a template, create a `Sale` (supply lives on the sale),
/// and share an (empty) item `TransferPolicy`. `sale_template = none` → the sale sells the real template;
/// `some(id)` → the sale points at a bogus id (for the wrong-template gate). Releases every control object.
fun full_setup(
  sc: &mut Scenario,
  supply: Option<u64>,
  price: u64,
  enable: bool,
  sale_template: Option<ID>,
  with_ranges: bool,
) {
  version::test_init(sc.ctx());
  admin::test_init(sc.ctx());
  item::test_init(sc.ctx());
  catalog::test_init(sc.ctx());

  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<AdminCap>();
  let mut ver = sc.take_shared<Version>();
  let mut cat = sc.take_shared<Catalog>();
  if (enable) admin::admin_set_enabled(&cap, &mut ver, true, sc.ctx());
  admin::add_category(&cap, &mut cat, b"sword".to_string(), &ver, sc.ctx());
  let (smin, smax) = if (with_ranges) (
    option::some(item_stats::new(100, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5)),
    option::some(item_stats::new(200, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5)),
  ) else (option::none(), option::none());
  let tid = admin::create_template(
    &cap, &cat, b"Widget".to_string(), b"".to_string(), b"widget".to_string(), b"icon".to_string(), b"sword".to_string(), 1,
    smin, smax, vector[], option::none(), &ver, sc.ctx(),
  );
  ts::return_shared(cat);

  let sale_tid = if (sale_template.is_some()) sale_template.destroy_some()
    else { sale_template.destroy_none(); tid };
  shop::create_sale(&cap, sale_tid, price, supply, &ver, sc.ctx());

  sc.next_tx(OWNER);
  let publisher = sc.take_from_sender<Publisher>();
  let (policy, policy_cap) = item::create_item_policy(&publisher, &ver, sc.ctx());
  transfer::public_share_object(policy);
  transfer::public_transfer(policy_cap, OWNER);
  transfer::public_transfer(publisher, OWNER);

  ts::return_shared(ver);
  sc.return_to_sender(cap);
}

/// Stand up a STACKABLE (resource) template + sale + policy: a fungible category with NO stat ranges. Mirrors
/// `full_setup` but authors `resource` so `buy_many` takes the stackable branch (ONE item of amount = quantity).
fun stackable_setup(sc: &mut Scenario, supply: Option<u64>, price: u64) {
  version::test_init(sc.ctx());
  admin::test_init(sc.ctx());
  item::test_init(sc.ctx());
  catalog::test_init(sc.ctx());

  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<AdminCap>();
  let mut ver = sc.take_shared<Version>();
  let mut cat = sc.take_shared<Catalog>();
  admin::admin_set_enabled(&cap, &mut ver, true, sc.ctx());
  admin::add_category(&cap, &mut cat, b"resource".to_string(), &ver, sc.ctx());
  let tid = admin::create_template(
    &cap, &cat, b"Wood".to_string(), b"".to_string(), b"wood".to_string(), b"icon".to_string(), b"resource".to_string(), 1,
    option::none(), option::none(), vector[], option::none(), &ver, sc.ctx(),
  );
  ts::return_shared(cat);
  shop::create_sale(&cap, tid, price, supply, &ver, sc.ctx());

  sc.next_tx(OWNER);
  let publisher = sc.take_from_sender<Publisher>();
  let (policy, policy_cap) = item::create_item_policy(&publisher, &ver, sc.ctx());
  transfer::public_share_object(policy);
  transfer::public_transfer(policy_cap, OWNER);
  transfer::public_transfer(publisher, OWNER);

  ts::return_shared(ver);
  sc.return_to_sender(cap);
}

fun take_buy_world(sc: &Scenario): (Sale, ItemTemplate, Version, TransferPolicy<Item>) {
  (
    sc.take_shared<Sale>(),
    sc.take_shared<ItemTemplate>(),
    sc.take_shared<Version>(),
    sc.take_shared<TransferPolicy<Item>>(),
  )
}

fun return_buy_world(sale: Sale, template: ItemTemplate, ver: Version, policy: TransferPolicy<Item>) {
  ts::return_shared(sale);
  ts::return_shared(template);
  ts::return_shared(ver);
  ts::return_shared(policy);
}

/// A PERSONAL kiosk (the constitution shape `buy` enforces): fresh kiosk with its cap already wrapped.
fun new_personal_kiosk(sc: &mut Scenario): (Kiosk, PersonalKioskCap) {
  let (mut kiosk, kcap) = kiosk::new(sc.ctx());
  let pkcap = personal_kiosk::new(&mut kiosk, kcap, sc.ctx());
  (kiosk, pkcap)
}

/// Soulbind the wrapped cap to the current sender and share the kiosk (post-buy cleanup).
fun keep_personal_kiosk(sc: &mut Scenario, kiosk: Kiosk, pkcap: PersonalKioskCap) {
  personal_kiosk::transfer_to_sender(pkcap, sc.ctx());
  transfer::public_share_object(kiosk);
}

/// A clock pinned at `at_ms` (window tests move it; the default paths use 0 with no window = open).
fun clock_at(sc: &mut Scenario, at_ms: u64): Clock {
  let mut clk = clock::create_for_testing(sc.ctx());
  clk.set_for_testing(at_ms);
  clk
}

/// A single BUYER buy at time `at_ms` into a personal kiosk (mints its own coin). Abort tests wrap it.
fun buy_at(sc: &mut Scenario, pay_amount: u64, at_ms: u64) {
  sc.next_tx(BUYER);
  let (mut sale, template, ver, policy) = take_buy_world(sc);
  let (mut kiosk, pkcap) = new_personal_kiosk(sc);
  let clk = clock_at(sc, at_ms);
  let pay = coin::mint_for_testing<SUI>(pay_amount, sc.ctx());
  shop::buy_for_testing(&mut sale, &template, pay, &mut kiosk, &pkcap, &policy, &clk, &ver, sc.ctx());
  clk.destroy_for_testing();
  keep_personal_kiosk(sc, kiosk, pkcap);
  return_buy_world(sale, template, ver, policy);
}

/// A single-item buy at t=0 (no window). Used by the non-window abort tests.
fun buy_once(sc: &mut Scenario, pay_amount: u64) { buy_at(sc, pay_amount, 0) }

/// A pack buy of `quantity` at t=0 into a personal kiosk. Abort tests wrap it.
fun buy_many_once(sc: &mut Scenario, quantity: u64, pay_amount: u64) {
  sc.next_tx(BUYER);
  let (mut sale, template, ver, policy) = take_buy_world(sc);
  let (mut kiosk, pkcap) = new_personal_kiosk(sc);
  let clk = clock_at(sc, 0);
  let pay = coin::mint_for_testing<SUI>(pay_amount, sc.ctx());
  shop::buy_many_for_testing(&mut sale, &template, quantity, pay, &mut kiosk, &pkcap, &policy, &clk, &ver, sc.ctx());
  clk.destroy_for_testing();
  keep_personal_kiosk(sc, kiosk, pkcap);
  return_buy_world(sale, template, ver, policy);
}

/// Admin-set the sale's time window.
fun apply_window(sc: &mut Scenario, start_ms: Option<u64>, end_ms: Option<u64>) {
  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<AdminCap>();
  let mut sale = sc.take_shared<Sale>();
  let ver = sc.take_shared<Version>();
  shop::set_window(&cap, &mut sale, start_ms, end_ms, &ver, sc.ctx());
  sc.return_to_sender(cap);
  ts::return_shared(sale);
  ts::return_shared(ver);
}

// ╔════════════════ [ The &Random buy entries ] ══════════════════════════════ ]

#[test]
/// The REAL `&Random` `buy` + `buy_many` entries (the `*_for_testing` twins share their bodies): each consumes a
/// seeded framework Random and the market-domain gate off a live GameConfig. Proves the entry wrappers run.
fun buy_and_buy_many_random_entries() {
  let mut sc = ts::begin(OWNER);
  full_setup(&mut sc, option::some(SUPPLY), PRICE, true, option::none(), false);

  // buy asserts the market DOMAIN off a live GameConfig — stand one up + enable it
  aresrpg::config::test_init(sc.ctx());
  sc.next_tx(OWNER);
  {
    let cap = sc.take_from_sender<AdminCap>();
    let mut cfg = sc.take_shared<aresrpg::config::GameConfig>();
    aresrpg::config::set_enabled(&cap, &mut cfg, true, sc.ctx());
    ts::return_shared(cfg); sc.return_to_sender(cap);
  };

  // seed a framework Random (create + first-round update as @0x0)
  sc.next_tx(@0x0);
  random::create_for_testing(sc.ctx());
  sc.next_tx(@0x0);
  let mut r = sc.take_shared<Random>();
  random::update_randomness_state_for_testing(&mut r, 0, x"0404040404040404040404040404040404040404040404040404040404040404", sc.ctx());
  ts::return_shared(r);

  // buy (single) via the real entry
  sc.next_tx(BUYER);
  {
    let (mut sale, template, ver, policy) = take_buy_world(&sc);
    let cfg = sc.take_shared<aresrpg::config::GameConfig>();
    let rr = sc.take_shared<Random>();
    let (mut kiosk, pkcap) = new_personal_kiosk(&mut sc);
    let clk = clock_at(&mut sc, 0);
    let pay = coin::mint_for_testing<SUI>(PRICE, sc.ctx());
    shop::buy(&mut sale, &template, pay, &mut kiosk, &pkcap, &policy, &clk, &rr, &cfg, &ver, sc.ctx());
    clk.destroy_for_testing();
    keep_personal_kiosk(&mut sc, kiosk, pkcap);
    return_buy_world(sale, template, ver, policy);
    ts::return_shared(cfg); ts::return_shared(rr);
  };

  // buy_many (pack of 2) via the real entry
  sc.next_tx(BUYER);
  {
    let (mut sale, template, ver, policy) = take_buy_world(&sc);
    let cfg = sc.take_shared<aresrpg::config::GameConfig>();
    let rr = sc.take_shared<Random>();
    let (mut kiosk, pkcap) = new_personal_kiosk(&mut sc);
    let clk = clock_at(&mut sc, 0);
    let pay = coin::mint_for_testing<SUI>(PRICE * 2, sc.ctx());
    shop::buy_many(&mut sale, &template, 2, pay, &mut kiosk, &pkcap, &policy, &clk, &rr, &cfg, &ver, sc.ctx());
    clk.destroy_for_testing();
    keep_personal_kiosk(&mut sc, kiosk, pkcap);
    return_buy_world(sale, template, ver, policy);
    ts::return_shared(cfg); ts::return_shared(rr);
  };
  sc.end();
}

// ╔════════════════ [ Sale getters ] ═════════════════════════════════════════ ]

#[test]
/// Sale getters: `sale_template` is the template the sale sells; the window sides start `none` (open) and read
/// back the exact `some` bounds after `set_window`.
fun sale_getters_reflect_config() {
  let mut sc = ts::begin(OWNER);
  full_setup(&mut sc, option::some(SUPPLY), PRICE, true, option::none(), false);

  sc.next_tx(OWNER);
  let sale = sc.take_shared<Sale>();
  assert!(shop::start_ms(&sale).is_none()); // no window on a fresh sale
  assert!(shop::end_ms(&sale).is_none());
  let tid = shop::sale_template(&sale);
  ts::return_shared(sale);

  apply_window(&mut sc, option::some(1000), option::some(5000));
  sc.next_tx(OWNER);
  let sale2 = sc.take_shared<Sale>();
  assert_eq!(shop::start_ms(&sale2), option::some(1000));
  assert_eq!(shop::end_ms(&sale2), option::some(5000));
  assert_eq!(shop::sale_template(&sale2), tid); // template unchanged by the window edit
  ts::return_shared(sale2);
  sc.end();
}

// ╔════════════════ [ Happy path — single buy ] ══════════════════════════════ ]

#[test]
fun buy_happy_path_mints_locks_pays_and_counts() {
  let mut sc = ts::begin(OWNER);
  full_setup(&mut sc, option::some(SUPPLY), PRICE, true, option::none(), false);

  sc.next_tx(BUYER);
  let (mut sale, template, ver, policy) = take_buy_world(&sc);
  let (mut kiosk, pkcap) = new_personal_kiosk(&mut sc);
  let clk = clock_at(&mut sc, 0);

  assert_eq!(shop::minted(&sale), 0);
  let pay = coin::mint_for_testing<SUI>(PRICE, sc.ctx());
  shop::buy_for_testing(&mut sale, &template, pay, &mut kiosk, &pkcap, &policy, &clk, &ver, sc.ctx());

  assert_eq!(shop::minted(&sale), 1);
  assert_eq!(kiosk.item_count(), 1); // the minted item is LOCKED in the buyer's kiosk

  clk.destroy_for_testing();
  keep_personal_kiosk(&mut sc, kiosk, pkcap);
  return_buy_world(sale, template, ver, policy);

  sc.next_tx(OWNER);
  let got = ts::take_from_address<Coin<SUI>>(&sc, @treasury);
  assert_eq!(got.value(), PRICE);
  destroy(got);
  sc.end();
}

#[test]
fun buy_overpayment_refunds_change() {
  let mut sc = ts::begin(OWNER);
  full_setup(&mut sc, option::some(SUPPLY), PRICE, true, option::none(), false);

  sc.next_tx(BUYER);
  let (mut sale, template, ver, policy) = take_buy_world(&sc);
  let (mut kiosk, pkcap) = new_personal_kiosk(&mut sc);
  let clk = clock_at(&mut sc, 0);

  let pay = coin::mint_for_testing<SUI>(PRICE * 2, sc.ctx()); // overpay by PRICE
  shop::buy_for_testing(&mut sale, &template, pay, &mut kiosk, &pkcap, &policy, &clk, &ver, sc.ctx());

  clk.destroy_for_testing();
  keep_personal_kiosk(&mut sc, kiosk, pkcap);
  return_buy_world(sale, template, ver, policy);

  sc.next_tx(BUYER);
  let change = sc.take_from_sender<Coin<SUI>>();
  assert_eq!(change.value(), PRICE);
  destroy(change);

  sc.next_tx(OWNER);
  let got = ts::take_from_address<Coin<SUI>>(&sc, @treasury);
  assert_eq!(got.value(), PRICE);
  destroy(got);
  sc.end();
}

#[test]
fun unlimited_supply_sells_repeatedly() {
  let mut sc = ts::begin(OWNER);
  full_setup(&mut sc, option::none(), PRICE, true, option::none(), false); // no cap

  buy_once(&mut sc, PRICE);
  buy_once(&mut sc, PRICE);
  buy_once(&mut sc, PRICE);

  sc.next_tx(OWNER);
  let sale = sc.take_shared<Sale>();
  assert_eq!(shop::minted(&sale), 3);
  assert!(shop::supply(&sale).is_none());
  ts::return_shared(sale);
  sc.end();
}

#[test]
/// A RANGED template: `buy` rolls the stats in-line and lands a born-rolled item locked in the kiosk.
fun buy_with_ranges_lands_rolled_item() {
  let mut sc = ts::begin(OWNER);
  full_setup(&mut sc, option::some(SUPPLY), PRICE, true, option::none(), true);

  sc.next_tx(BUYER);
  let (mut sale, template, ver, policy) = take_buy_world(&sc);
  let (mut kiosk, pkcap) = new_personal_kiosk(&mut sc);
  let clk = clock_at(&mut sc, 0);

  let pay = coin::mint_for_testing<SUI>(PRICE, sc.ctx());
  shop::buy_for_testing(&mut sale, &template, pay, &mut kiosk, &pkcap, &policy, &clk, &ver, sc.ctx());

  assert_eq!(shop::minted(&sale), 1);
  assert_eq!(kiosk.item_count(), 1);

  clk.destroy_for_testing();
  keep_personal_kiosk(&mut sc, kiosk, pkcap);
  return_buy_world(sale, template, ver, policy);
  sc.end();
}

// ╔════════════════ [ Pack buy (buy_many, G3) ] ══════════════════════════════ ]

#[test]
/// buy_many mints N in one call, locks all N in the kiosk, splits price × N to @treasury, bumps minted by N.
fun buy_many_mints_locks_and_pays_bulk() {
  let mut sc = ts::begin(OWNER);
  full_setup(&mut sc, option::some(SUPPLY), PRICE, true, option::none(), true); // ranged → each rolled

  sc.next_tx(BUYER);
  let (mut sale, template, ver, policy) = take_buy_world(&sc);
  let (mut kiosk, pkcap) = new_personal_kiosk(&mut sc);
  let clk = clock_at(&mut sc, 0);

  let pay = coin::mint_for_testing<SUI>(PRICE * 5, sc.ctx());
  shop::buy_many_for_testing(&mut sale, &template, 5, pay, &mut kiosk, &pkcap, &policy, &clk, &ver, sc.ctx());

  assert_eq!(shop::minted(&sale), 5);
  assert_eq!(kiosk.item_count(), 5); // all 5 locked

  clk.destroy_for_testing();
  keep_personal_kiosk(&mut sc, kiosk, pkcap);
  return_buy_world(sale, template, ver, policy);

  sc.next_tx(OWNER);
  let got = ts::take_from_address<Coin<SUI>>(&sc, @treasury);
  assert_eq!(got.value(), PRICE * 5); // exact price × quantity, one payment
  destroy(got);
  sc.end();
}

#[test]
/// buy_many overpay refunds the change ONCE (a single leftover coin, not N).
fun buy_many_overpayment_refunds_change_once() {
  let mut sc = ts::begin(OWNER);
  full_setup(&mut sc, option::some(SUPPLY), PRICE, true, option::none(), false);

  buy_many_once(&mut sc, 4, PRICE * 4 + 123); // overpay by 123

  sc.next_tx(BUYER);
  let change = sc.take_from_sender<Coin<SUI>>();
  assert_eq!(change.value(), 123); // one refund of the exact change
  destroy(change);

  sc.next_tx(OWNER);
  let got = ts::take_from_address<Coin<SUI>>(&sc, @treasury);
  assert_eq!(got.value(), PRICE * 4);
  destroy(got);
  sc.end();
}

#[test, expected_failure(abort_code = ESoldOut, location = shop)]
/// G3 atomic reserve: a pack that would exceed the supply cap aborts as a WHOLE (never partial mint).
fun buy_many_over_reserve_aborts() {
  let mut sc = ts::begin(OWNER);
  full_setup(&mut sc, option::some(5), PRICE, true, option::none(), false); // cap = 5

  buy_many_once(&mut sc, 3, PRICE * 3); // minted 3 of 5
  buy_many_once(&mut sc, 3, PRICE * 3); // 3 + 3 = 6 > 5 → ESoldOut (nothing minted this call)
  abort
}

#[test, expected_failure(abort_code = EInvalidQuantity, location = shop)]
fun buy_many_quantity_zero_aborts() {
  let mut sc = ts::begin(OWNER);
  full_setup(&mut sc, option::some(SUPPLY), PRICE, true, option::none(), false);
  buy_many_once(&mut sc, 0, 0); // EInvalidQuantity
  abort
}

#[test, expected_failure(abort_code = EInvalidQuantity, location = shop)]
fun buy_many_over_cap_quantity_aborts() {
  let mut sc = ts::begin(OWNER);
  full_setup(&mut sc, option::none(), PRICE, true, option::none(), false);
  let over = shop::max_buy_quantity() + 1; // 101
  buy_many_once(&mut sc, over, PRICE * over); // EInvalidQuantity
  abort
}

#[test, expected_failure(abort_code = EInsufficientPayment, location = shop)]
fun buy_many_short_payment_aborts() {
  let mut sc = ts::begin(OWNER);
  full_setup(&mut sc, option::some(SUPPLY), PRICE, true, option::none(), false);
  buy_many_once(&mut sc, 5, PRICE * 5 - 1); // one MIST short of the batch total
  abort
}

#[test]
/// STACKABLE (b): buy_many mints ONE item carrying amount = quantity (NOT N NFTs), pays exact price × quantity.
/// `item_count == 1` (one object) + `minted == 7` (units) is the fungible signature; contrast the gear pack above
/// (`buy_many_mints_locks_and_pays_bulk`) which lands 5 separate objects. The amount = N itself is asserted
/// directly in `item_tests::mint_stack_sets_amount_and_locks`.
fun stackable_buy_many_mints_one_item_of_amount_n() {
  let mut sc = ts::begin(OWNER);
  stackable_setup(&mut sc, option::some(SUPPLY), PRICE);

  sc.next_tx(BUYER);
  let (mut sale, template, ver, policy) = take_buy_world(&sc);
  let (mut kiosk, pkcap) = new_personal_kiosk(&mut sc);
  let clk = clock_at(&mut sc, 0);

  let pay = coin::mint_for_testing<SUI>(PRICE * 7, sc.ctx());
  shop::buy_many_for_testing(&mut sale, &template, 7, pay, &mut kiosk, &pkcap, &policy, &clk, &ver, sc.ctx());

  assert_eq!(shop::minted(&sale), 7); // supply counts UNITS
  assert_eq!(kiosk.item_count(), 1); // ONE object, not 7

  clk.destroy_for_testing();
  keep_personal_kiosk(&mut sc, kiosk, pkcap);
  return_buy_world(sale, template, ver, policy);

  sc.next_tx(OWNER);
  let got = ts::take_from_address<Coin<SUI>>(&sc, @treasury);
  assert_eq!(got.value(), PRICE * 7); // exact price × quantity, one payment
  destroy(got);
  sc.end();
}

// ╔════════════════ [ Sale time window (G3) ] ════════════════════════════════ ]

#[test]
fun buy_inside_window_succeeds() {
  let mut sc = ts::begin(OWNER);
  full_setup(&mut sc, option::some(SUPPLY), PRICE, true, option::none(), false);
  apply_window(&mut sc, option::some(1000), option::some(3000)); // open [1000, 3000)
  buy_at(&mut sc, PRICE, 2000); // t inside window → OK

  sc.next_tx(OWNER);
  let sale = sc.take_shared<Sale>();
  assert_eq!(shop::minted(&sale), 1);
  ts::return_shared(sale);
  sc.end();
}

#[test, expected_failure(abort_code = ESaleNotStarted, location = shop)]
fun buy_before_window_start_aborts() {
  let mut sc = ts::begin(OWNER);
  full_setup(&mut sc, option::some(SUPPLY), PRICE, true, option::none(), false);
  apply_window(&mut sc, option::some(1000), option::none());
  buy_at(&mut sc, PRICE, 500); // t < start → ESaleNotStarted
  abort
}

#[test, expected_failure(abort_code = ESaleEnded, location = shop)]
fun buy_after_window_end_aborts() {
  let mut sc = ts::begin(OWNER);
  full_setup(&mut sc, option::some(SUPPLY), PRICE, true, option::none(), false);
  apply_window(&mut sc, option::none(), option::some(1000));
  buy_at(&mut sc, PRICE, 2000); // t >= end → ESaleEnded
  abort
}

// ╔════════════════ [ Aborts — single buy ] ══════════════════════════════════ ]

#[test, expected_failure(abort_code = ESalePaused, location = shop)]
fun buy_while_paused_aborts() {
  let mut sc = ts::begin(OWNER);
  full_setup(&mut sc, option::some(SUPPLY), PRICE, true, option::none(), false);

  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<AdminCap>();
  let mut sale = sc.take_shared<Sale>();
  let ver = sc.take_shared<Version>();
  shop::set_paused(&cap, &mut sale, true, &ver, sc.ctx());
  sc.return_to_sender(cap);
  ts::return_shared(sale);
  ts::return_shared(ver);

  buy_once(&mut sc, PRICE); // ESalePaused
  abort
}

// NOTE: no "plain kiosk" abort test — `buy` takes `&PersonalKioskCap`, so a non-personal kiosk is a COMPILE
// error at the call site (the constitution is type-enforced, not a runtime assert).

#[test, expected_failure(abort_code = EInsufficientPayment, location = shop)]
fun buy_with_insufficient_payment_aborts() {
  let mut sc = ts::begin(OWNER);
  full_setup(&mut sc, option::some(SUPPLY), PRICE, true, option::none(), false);
  buy_once(&mut sc, PRICE - 1); // one MIST short
  abort
}

#[test, expected_failure(abort_code = EWrongTemplate, location = shop)]
fun buy_with_wrong_template_aborts() {
  let mut sc = ts::begin(OWNER);
  full_setup(&mut sc, option::some(SUPPLY), PRICE, true, option::some(object::id_from_address(@0xBEEF)), false);
  buy_once(&mut sc, PRICE); // EWrongTemplate
  abort
}

#[test, expected_failure(abort_code = ESoldOut, location = shop)]
fun buy_past_supply_cap_aborts() {
  let mut sc = ts::begin(OWNER);
  full_setup(&mut sc, option::some(1), PRICE, true, option::none(), false); // cap = 1

  buy_once(&mut sc, PRICE); // exhausts the sale
  buy_once(&mut sc, PRICE); // ESoldOut
  abort
}

#[test, expected_failure(abort_code = V_ENotEnabled, location = version)]
fun buy_while_package_dark_aborts() {
  let mut sc = ts::begin(OWNER);
  full_setup(&mut sc, option::some(SUPPLY), PRICE, false, option::none(), false); // NOT enabled
  buy_once(&mut sc, PRICE); // the enabled gate aborts first
  abort
}

#[test, expected_failure(abort_code = V_EWrongVersion, location = version)]
fun set_price_on_stale_version_aborts() {
  let mut sc = ts::begin(OWNER);
  full_setup(&mut sc, option::some(SUPPLY), PRICE, true, option::none(), false);

  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<AdminCap>();
  let mut sale = sc.take_shared<Sale>();
  let mut ver = sc.take_shared<Version>();
  version::test_set_stale(&mut ver);
  shop::set_price(&cap, &mut sale, PRICE + 1, &ver, sc.ctx()); // EWrongVersion
  abort
}

// ╔════════════════ [ Admin lifecycle ] ══════════════════════════════════════ ]

#[test]
fun set_price_and_pause_toggle_takes_effect() {
  let mut sc = ts::begin(OWNER);
  full_setup(&mut sc, option::some(SUPPLY), PRICE, true, option::none(), false);

  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<AdminCap>();
  let mut sale = sc.take_shared<Sale>();
  let ver = sc.take_shared<Version>();

  shop::set_price(&cap, &mut sale, 999, &ver, sc.ctx());
  assert_eq!(shop::price(&sale), 999);

  shop::set_paused(&cap, &mut sale, true, &ver, sc.ctx());
  assert!(shop::is_paused(&sale));
  shop::set_paused(&cap, &mut sale, false, &ver, sc.ctx());
  assert!(!shop::is_paused(&sale));

  sc.return_to_sender(cap);
  ts::return_shared(sale);
  ts::return_shared(ver);
  sc.end();
}

// ╔════════════════ [ Burn ] ═════════════════════════════════════════════════ ]

#[test]
/// Pause a sale, burn it (cap + version gated), and prove the shared `Sale` is GONE.
fun burn_sale_deletes_paused_sale() {
  let mut sc = ts::begin(OWNER);
  full_setup(&mut sc, option::some(SUPPLY), PRICE, true, option::none(), false);

  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<AdminCap>();
  let ver = sc.take_shared<Version>();
  let mut sale = sc.take_shared<Sale>();
  shop::set_paused(&cap, &mut sale, true, &ver, sc.ctx()); // the active gate must be closed first
  shop::burn_sale(&cap, sale, &ver, sc.ctx());
  ts::return_shared(ver);
  sc.return_to_sender(cap);

  sc.next_tx(OWNER);
  assert!(!ts::has_most_recent_shared<Sale>()); // the shared sale no longer exists
  sc.end();
}

#[test, expected_failure(abort_code = ESaleNotPaused, location = shop)]
/// Burning an ACTIVE (unpaused) sale aborts (`ESaleNotPaused`) — a live gate can't be pulled from under a buyer.
fun burn_active_sale_aborts() {
  let mut sc = ts::begin(OWNER);
  full_setup(&mut sc, option::some(SUPPLY), PRICE, true, option::none(), false);

  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<AdminCap>();
  let ver = sc.take_shared<Version>();
  let sale = sc.take_shared<Sale>(); // never paused
  shop::burn_sale(&cap, sale, &ver, sc.ctx()); // ESaleNotPaused
  abort
}

#[test, expected_failure(abort_code = V_EWrongVersion, location = version)]
/// Burning on a stale package version aborts (`EWrongVersion`) — version-gated exactly like `create_sale`.
fun burn_sale_on_stale_version_aborts() {
  let mut sc = ts::begin(OWNER);
  full_setup(&mut sc, option::some(SUPPLY), PRICE, true, option::none(), false);

  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<AdminCap>();
  let mut ver = sc.take_shared<Version>();
  let mut sale = sc.take_shared<Sale>();
  shop::set_paused(&cap, &mut sale, true, &ver, sc.ctx()); // paused FIRST — isolates the VERSION gate
  version::test_set_stale(&mut ver);
  shop::burn_sale(&cap, sale, &ver, sc.ctx()); // EWrongVersion
  abort
}
