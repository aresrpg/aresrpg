// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// GIFT tests: escrow-recoverable item send (`gift`). Drives the REAL flow against an Item `TransferPolicy` that
/// carries the FULL ceremony rule set (royalty + kiosk_lock + personal_kiosk + item_listing + lot), two genuine
/// personal kiosks (sender + recipient), and gear items actually kiosk-locked in the sender's kiosk — so `claim`
/// exercises the true `purchase_with_cap` → receipt-tail → re-lock path, not a fabricated request. Covers: the
/// send→claim golden path (items land locked in the recipient's kiosk; royalty drawn from the escrow, surplus
/// refunded), recipient-only claim + sender-only recall auth, recall unwinding (items delisted back, royalty
/// refunded), the empty-gift refusal, and the UNDERFUNDED-escrow claim abort (the `sui::balance` ENotEnough
/// backstop behind the SDK's derive-never-guess royalty floor).
#[test_only]
module aresrpg_gifting::gift_tests;

use aresrpg::{admin::{Self, AdminCap}, catalog::{Self, Catalog}, config::{Self, GameConfig}, extension, item::{Self, Item, ItemTemplate}, item_listing_rule, lot_rule, version::{Self, Version}};
use aresrpg_gifting::gift;
use kiosk::{
  kiosk_lock_rule,
  personal_kiosk::{Self, PersonalKioskCap},
  personal_kiosk_rule,
  royalty_rule
};
use std::unit_test::assert_eq;
use sui::{
  coin::{Self, Coin},
  kiosk::{Self, Kiosk},
  package::Publisher,
  sui::SUI,
  test_scenario::{Self as ts, Scenario},
  transfer_policy::{TransferPolicy, TransferPolicyCap}
};

const OWNER: address = @0xA;
const SENDER: address = @0x5E;
const RECIPIENT: address = @0x4E;
const ROYALTY_MIN: u64 = 10_000_000; // 0.01 SUI — the ceremony `royalty_rule` min_amount

// ── mirrored error consts (the #[expected_failure] `location` disambiguates the aborting module) ──
const ENotRecipient: u64 = 101; // gift
const ENotSender: u64 = 102; // gift
const EEmptyGift: u64 = 103; // gift

// ╔════════════════ [ Harness ] ══════════════════════════════════════════════ ]

/// Boot the package ENABLED, whitelist a gear category, author ONE gear template, and create the Item policy with
/// the FULL ceremony rule set (so `claim`'s receipt tail is the real one). Returns the template id.
fun boot(sc: &mut Scenario): ID {
  version::test_init(sc.ctx());
  admin::test_init(sc.ctx());
  config::test_init(sc.ctx());
  item::test_init(sc.ctx());
  catalog::test_init(sc.ctx());

  sc.next_tx(OWNER);
  let acap = sc.take_from_sender<AdminCap>();
  let mut ver = sc.take_shared<Version>();
  admin::admin_set_enabled(&acap, &mut ver, true, sc.ctx());
  let mut cfg = sc.take_shared<GameConfig>();
  config::set_enabled(&acap, &mut cfg, true, sc.ctx());
  let mut cat = sc.take_shared<Catalog>();
  admin::add_category(&acap, &mut cat, b"ring".to_string(), &ver, sc.ctx());
  let tid = admin::create_template(&acap, &cat, b"Ruby Ring".to_string(), b"".to_string(), b"ruby_ring".to_string(), b"ring".to_string(), 1, option::none(), option::none(), vector[], option::none(), &ver, sc.ctx());
  ts::return_shared(cat);

  sc.next_tx(OWNER);
  let publisher = sc.take_from_sender<Publisher>();
  let (mut policy, cap) = item::create_item_policy(&publisher, &ver, sc.ctx());
  royalty_rule::add(&mut policy, &cap, 1000, ROYALTY_MIN); // 10% floored to the 0.01-SUI min
  kiosk_lock_rule::add(&mut policy, &cap);
  personal_kiosk_rule::add(&mut policy, &cap);
  item_listing_rule::add(&mut policy, &cap);
  lot_rule::add(&mut policy, &cap);
  transfer::public_share_object(policy);
  transfer::public_transfer(cap, OWNER);
  transfer::public_transfer(publisher, OWNER);
  ts::return_shared(ver);
  ts::return_shared(cfg);
  sc.return_to_sender(acap);
  tid
}

/// Create a fresh PERSONAL kiosk owned by `who` (shared) and return its id.
fun make_kiosk(sc: &mut Scenario, who: address): ID {
  sc.next_tx(who);
  let (mut k, kcap) = kiosk::new(sc.ctx());
  let kid = object::id(&k);
  let pkcap = personal_kiosk::new(&mut k, kcap, sc.ctx());
  personal_kiosk::transfer_to_sender(pkcap, sc.ctx());
  transfer::public_share_object(k);
  kid
}

/// Mint a gear item from `tid` and lock it into `who`'s kiosk `kid`; return the item id.
fun mint_lock_into(sc: &mut Scenario, who: address, kid: ID, tid: ID): ID {
  sc.next_tx(who);
  let tmpl = ts::take_shared_by_id<ItemTemplate>(sc, tid);
  let ver = sc.take_shared<Version>();
  let policy = sc.take_shared<TransferPolicy<Item>>();
  let mut k = ts::take_shared_by_id<Kiosk>(sc, kid);
  let pkcap = sc.take_from_sender<PersonalKioskCap>();
  let (it, pledge) = extension::mint_item_for_testing(&tmpl, option::none(), &ver, sc.ctx());
  let iid = object::id(&it);
  item::lock_in_kiosk(pledge, it, &mut k, personal_kiosk::borrow(&pkcap), &policy);
  ts::return_shared(tmpl); ts::return_shared(ver); ts::return_shared(policy); ts::return_shared(k); sc.return_to_sender(pkcap);
  iid
}

/// SENDER sends `items` to RECIPIENT, pre-funding `royalty_amount` MIST.
fun do_send(sc: &mut Scenario, skid: ID, items: vector<ID>, royalty_amount: u64) {
  sc.next_tx(SENDER);
  let mut k = ts::take_shared_by_id<Kiosk>(sc, skid);
  let pkcap = sc.take_from_sender<PersonalKioskCap>();
  let cfg = sc.take_shared<GameConfig>();
  let ver = sc.take_shared<Version>();
  let royalty = coin::mint_for_testing<SUI>(royalty_amount, sc.ctx());
  gift::send(&mut k, &pkcap, items, RECIPIENT, royalty, &cfg, &ver, sc.ctx());
  ts::return_shared(k); sc.return_to_sender(pkcap); ts::return_shared(cfg); ts::return_shared(ver);
}

// ╔════════════════ [ Tests ] ════════════════════════════════════════════════ ]

#[test]
/// Golden path: SENDER gifts 2 items with an EXACT 2×0.01-SUI royalty pre-fund; RECIPIENT claims → both items are
/// locked in the recipient's kiosk and gone from the sender's (a full policy purchase fired per item — a
/// successful `confirm_request` proves the royalty receipt was satisfied).
fun send_claim_golden() {
  let mut sc = ts::begin(OWNER);
  let tid = boot(&mut sc);
  let skid = make_kiosk(&mut sc, SENDER);
  let rkid = make_kiosk(&mut sc, RECIPIENT);
  let i1 = mint_lock_into(&mut sc, SENDER, skid, tid);
  let i2 = mint_lock_into(&mut sc, SENDER, skid, tid);
  do_send(&mut sc, skid, vector[i1, i2], 2 * ROYALTY_MIN);

  // RECIPIENT claims.
  sc.next_tx(RECIPIENT);
  let g = ts::take_shared<gift::Gift>(&sc);
  let mut sk = ts::take_shared_by_id<Kiosk>(&sc, skid);
  let mut rk = ts::take_shared_by_id<Kiosk>(&sc, rkid);
  let pkcap = sc.take_from_sender<PersonalKioskCap>();
  let mut policy = sc.take_shared<TransferPolicy<Item>>();
  let cfg = sc.take_shared<GameConfig>();
  let ver = sc.take_shared<Version>();
  gift::claim(g, &mut sk, &mut rk, &pkcap, &mut policy, &cfg, &ver, sc.ctx());

  // Both items are now LOCKED in the recipient's kiosk and no longer in the sender's.
  assert!(kiosk::has_item(&rk, i1) && kiosk::is_locked(&rk, i1));
  assert!(kiosk::has_item(&rk, i2) && kiosk::is_locked(&rk, i2));
  assert!(!kiosk::has_item(&sk, i1) && !kiosk::has_item(&sk, i2));
  ts::return_shared(sk); ts::return_shared(rk); sc.return_to_sender(pkcap); ts::return_shared(policy); ts::return_shared(cfg); ts::return_shared(ver);
  sc.end();
}

#[test]
/// Over-funded royalty refunds to the sender: 1 item, pre-funded 3×MIN → claim pays exactly 1×MIN through the
/// policy and refunds 2×MIN back to the SENDER (proves the escrow draws only the real per-item royalty).
fun claim_refunds_surplus_royalty() {
  let mut sc = ts::begin(OWNER);
  let tid = boot(&mut sc);
  let skid = make_kiosk(&mut sc, SENDER);
  let rkid = make_kiosk(&mut sc, RECIPIENT);
  let i1 = mint_lock_into(&mut sc, SENDER, skid, tid);
  do_send(&mut sc, skid, vector[i1], 3 * ROYALTY_MIN);

  sc.next_tx(RECIPIENT);
  let g = ts::take_shared<gift::Gift>(&sc);
  let mut sk = ts::take_shared_by_id<Kiosk>(&sc, skid);
  let mut rk = ts::take_shared_by_id<Kiosk>(&sc, rkid);
  let pkcap = sc.take_from_sender<PersonalKioskCap>();
  let mut policy = sc.take_shared<TransferPolicy<Item>>();
  let cfg = sc.take_shared<GameConfig>();
  let ver = sc.take_shared<Version>();
  gift::claim(g, &mut sk, &mut rk, &pkcap, &mut policy, &cfg, &ver, sc.ctx());
  ts::return_shared(sk); ts::return_shared(rk); sc.return_to_sender(pkcap); ts::return_shared(policy); ts::return_shared(cfg); ts::return_shared(ver);

  // The 2×MIN surplus landed on the SENDER as a refund coin.
  sc.next_tx(SENDER);
  let refund = sc.take_from_sender<Coin<SUI>>();
  assert_eq!(coin::value(&refund), 2 * ROYALTY_MIN);
  sc.return_to_sender(refund);
  sc.end();
}

#[test, expected_failure(abort_code = ENotRecipient, location = aresrpg_gifting::gift)]
/// A non-recipient (here the SENDER) cannot claim — `claim` aborts `ENotRecipient` before any item moves.
fun claim_by_non_recipient_aborts() {
  let mut sc = ts::begin(OWNER);
  let tid = boot(&mut sc);
  let skid = make_kiosk(&mut sc, SENDER);
  let rkid = make_kiosk(&mut sc, RECIPIENT);
  let i1 = mint_lock_into(&mut sc, SENDER, skid, tid);
  do_send(&mut sc, skid, vector[i1], ROYALTY_MIN);

  // SENDER tries to claim a gift addressed to RECIPIENT (borrowing the recipient's cap by address).
  sc.next_tx(SENDER);
  let g = ts::take_shared<gift::Gift>(&sc);
  let mut sk = ts::take_shared_by_id<Kiosk>(&sc, skid);
  let mut rk = ts::take_shared_by_id<Kiosk>(&sc, rkid);
  let pkcap = ts::take_from_address<PersonalKioskCap>(&sc, RECIPIENT);
  let mut policy = sc.take_shared<TransferPolicy<Item>>();
  let cfg = sc.take_shared<GameConfig>();
  let ver = sc.take_shared<Version>();
  gift::claim(g, &mut sk, &mut rk, &pkcap, &mut policy, &cfg, &ver, sc.ctx()); // ABORTS ENotRecipient
  abort 0
}

#[test, expected_failure(abort_code = ENotSender, location = aresrpg_gifting::gift)]
/// A non-sender (here the RECIPIENT) cannot recall — `recall` aborts `ENotSender`.
fun recall_by_non_sender_aborts() {
  let mut sc = ts::begin(OWNER);
  let tid = boot(&mut sc);
  let skid = make_kiosk(&mut sc, SENDER);
  make_kiosk(&mut sc, RECIPIENT);
  let i1 = mint_lock_into(&mut sc, SENDER, skid, tid);
  do_send(&mut sc, skid, vector[i1], ROYALTY_MIN);

  sc.next_tx(RECIPIENT);
  let g = ts::take_shared<gift::Gift>(&sc);
  let mut sk = ts::take_shared_by_id<Kiosk>(&sc, skid);
  gift::recall(g, &mut sk, sc.ctx()); // ABORTS ENotSender
  abort 0
}

#[test]
/// Recall unwinds an unclaimed gift: the SENDER recalls → the item is delisted back (present + NOT listed, so
/// `take`-able again) in the sender's kiosk, and the pre-funded royalty refunds to the sender.
fun recall_unwinds_to_sender() {
  let mut sc = ts::begin(OWNER);
  let tid = boot(&mut sc);
  let skid = make_kiosk(&mut sc, SENDER);
  make_kiosk(&mut sc, RECIPIENT);
  let i1 = mint_lock_into(&mut sc, SENDER, skid, tid);
  do_send(&mut sc, skid, vector[i1], 2 * ROYALTY_MIN);

  sc.next_tx(SENDER);
  let g = ts::take_shared<gift::Gift>(&sc);
  let mut sk = ts::take_shared_by_id<Kiosk>(&sc, skid);
  gift::recall(g, &mut sk, sc.ctx());
  assert!(kiosk::has_item(&sk, i1)); // still in the sender's kiosk
  assert!(!kiosk::is_listed(&sk, i1)); // and no longer exclusively listed → takeable again
  ts::return_shared(sk);

  // Royalty refunded to the SENDER.
  sc.next_tx(SENDER);
  let refund = sc.take_from_sender<Coin<SUI>>();
  assert_eq!(coin::value(&refund), 2 * ROYALTY_MIN);
  sc.return_to_sender(refund);
  sc.end();
}

#[test, expected_failure(abort_code = EEmptyGift, location = aresrpg_gifting::gift)]
/// An empty gift is refused at `send` (`EEmptyGift`).
fun send_empty_aborts() {
  let mut sc = ts::begin(OWNER);
  boot(&mut sc);
  let skid = make_kiosk(&mut sc, SENDER);
  do_send(&mut sc, skid, vector[], ROYALTY_MIN); // ABORTS EEmptyGift
  abort 0
}

#[test, expected_failure(abort_code = 2, location = sui::balance)]
/// An UNDERFUNDED escrow cannot claim: 2 items but only 1×MIN pre-funded → the second item's royalty draw aborts
/// in `sui::balance` (ENotEnough = 2), the WHOLE claim reverts atomically (nothing partially delivered), and the
/// sender can still `recall`. (The SDK send composer derives + refuses this underfund pre-flight — this proves
/// the on-chain backstop when a foreign composer underfunds anyway.)
fun claim_underfunded_royalty_aborts() {
  let mut sc = ts::begin(OWNER);
  let tid = boot(&mut sc);
  let skid = make_kiosk(&mut sc, SENDER);
  let rkid = make_kiosk(&mut sc, RECIPIENT);
  let i1 = mint_lock_into(&mut sc, SENDER, skid, tid);
  let i2 = mint_lock_into(&mut sc, SENDER, skid, tid);
  do_send(&mut sc, skid, vector[i1, i2], ROYALTY_MIN); // UNDERFUNDED: 2 items, 1×MIN escrowed

  sc.next_tx(RECIPIENT);
  let g = ts::take_shared<gift::Gift>(&sc);
  let mut sk = ts::take_shared_by_id<Kiosk>(&sc, skid);
  let mut rk = ts::take_shared_by_id<Kiosk>(&sc, rkid);
  let pkcap = sc.take_from_sender<PersonalKioskCap>();
  let mut policy = sc.take_shared<TransferPolicy<Item>>();
  let cfg = sc.take_shared<GameConfig>();
  let ver = sc.take_shared<Version>();
  gift::claim(g, &mut sk, &mut rk, &pkcap, &mut policy, &cfg, &ver, sc.ctx()); // ABORTS: escrow short on item 2
  abort 0
}
