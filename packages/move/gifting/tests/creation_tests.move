// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// Creation-gate tests: the free path (mints the first character FOR FREE, locked in the creator's PERSONAL
/// kiosk — NO weapon is ever granted, design ruling 2026-07-08: early weapons are admin-authored easy loot), the paid path
/// (additional character for `price`, exact treasury split + change refund), and every gate — one-free-per-
/// address, duplicate/bad name, unknown/removed class, paused, insufficient payment, package dark, stale
/// version. Name registry + class whitelist + free/paid split + price + pause live on the gate (never the base).
#[test_only]
module aresrpg_gifting::creation_tests;

use aresrpg::{admin::{Self, AdminCap}, character::{Self, Character}, config::{Self, GameConfig}, version::{Self, Version}};
use aresrpg_gifting::{creation::{Self, Creation}, gifting::Gifting};
use kiosk::personal_kiosk::{Self, PersonalKioskCap};
use std::unit_test::{assert_eq, destroy};
use sui::{
  clock,
  coin::{Self, Coin},
  kiosk::{Self, Kiosk},
  package::Publisher,
  sui::SUI,
  test_scenario::{Self as ts, Scenario},
  tx_context,
  transfer_policy::TransferPolicy
};

const OWNER: address = @0xA;
const BUYER: address = @0xB;
const PRICE: u64 = 500;
const TEN_SUI: u64 = 10_000_000_000;

// The canonical Google-derived zkLogin (address, address_seed) pair, lifted VERBATIM from the Sui framework's own
// `zklogin_verified_issuer_tests` — the only pair the `check_zklogin_issuer` native verifies as a genuine Google
// zkLogin derivation in move-test (a synthetic pair cannot be forged; the native checks real derivation). Free
// creation is zkLogin-gated, so every free mint here runs AS this address — which also makes each happy-path free
// test a genuine POSITIVE-path proof of the gate.
const ZK_ADDR: address = @0x1c6b623a2f2c91333df730c98d220f11484953b391a3818680f922c264cc0c6b;
const ZK_SEED: u256 = 3006596378422062745101035755700472756930796952630484939867684134047976874601;

// ── mirrored error values ──
const ENameTaken: u64 = 101; // creation
const ENameInvalid: u64 = 102; // creation
const EUnknownClass: u64 = 103; // creation
const EPaused: u64 = 104; // creation
const EInsufficientPayment: u64 = 105; // creation
const EFreeCharacterClaimed: u64 = 106; // creation
const ENotZkLoginAddress: u64 = 109; // creation
const V_EWrongVersion: u64 = 101; // version
const V_ENotEnabled: u64 = 102; // version

// ╔════════════════ [ Harness ] ══════════════════════════════════════════════ ]

/// Stand up the whole package, optionally enable, whitelist class `senshi`, set `price`, and share the
/// Character transfer policy. (No starter authoring — no weapon is ever granted at creation.)
fun full_setup(sc: &mut Scenario, enable: bool, price: u64) {
  version::test_init(sc.ctx());
  admin::test_init(sc.ctx());
  character::test_init(sc.ctx());
  creation::test_init(sc.ctx());
  config::test_init(sc.ctx());

  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<AdminCap>();
  let mut ver = sc.take_shared<Version>();
  let mut gate = sc.take_shared<Creation>();
  if (enable) admin::admin_set_enabled(&cap, &mut ver, true, sc.ctx());
  let mut cfg = sc.take_shared<GameConfig>();
  if (enable) config::set_enabled(&cap, &mut cfg, true, sc.ctx());
  config::set_gifting_brand<Gifting>(&cap, &mut cfg, &ver, sc.ctx()); // the split's pin
  ts::return_shared(cfg);
  creation::add_class(&cap, &mut gate, b"senshi".to_string(), &ver, sc.ctx());
  creation::set_price(&cap, &mut gate, price, &ver, sc.ctx());
  ts::return_shared(gate);

  let pub1 = sc.take_from_sender<Publisher>();
  let (cpolicy, cpolicy_cap) = character::create_character_policy(&pub1, &ver, sc.ctx());
  transfer::public_share_object(cpolicy);
  transfer::public_transfer(cpolicy_cap, OWNER);
  destroy(pub1);

  sc.return_to_sender(cap);
  ts::return_shared(ver);
}

fun new_personal_kiosk(sc: &mut Scenario): (Kiosk, PersonalKioskCap) {
  let (mut kiosk, kcap) = kiosk::new(sc.ctx());
  let pkcap = personal_kiosk::new(&mut kiosk, kcap, sc.ctx());
  (kiosk, pkcap)
}

/// One FREE creation, ALWAYS run as the canonical zkLogin address `ZK_ADDR` (free creation is zkLogin-gated and
/// this is the only address the native verifies): mints the char (no weapon — none is ever granted) and locks it
/// into a fresh personal kiosk. Returns the character id. Abort tests reach the create before the lock runs.
fun create_free(sc: &mut Scenario, name: vector<u8>, class: vector<u8>): ID {
  sc.next_tx(ZK_ADDR);
  let mut gate = sc.take_shared<Creation>();
  let ver = sc.take_shared<Version>();
  let cfg = sc.take_shared<GameConfig>();
  let cpolicy = sc.take_shared<TransferPolicy<Character>>();
  let clk = clock::create_for_testing(sc.ctx());
  let cust = character::new_customization(1, 2, 3);

  let (chr, cpledge) = creation::create_character_free(
    &mut gate, &cfg, name.to_string(), class.to_string(), true, cust, ZK_SEED, &clk, &ver, sc.ctx(),
  );
  let cid = character::id(&chr);
  let (mut kiosk, pkcap) = new_personal_kiosk(sc);
  character::lock_in_kiosk(cpledge, chr, &mut kiosk, personal_kiosk::borrow(&pkcap), &cpolicy);

  clk.destroy_for_testing();
  personal_kiosk::transfer_to_sender(pkcap, sc.ctx());
  transfer::public_share_object(kiosk);
  ts::return_shared(gate);
  ts::return_shared(ver);
  ts::return_shared(cpolicy);
  ts::return_shared(cfg);
  cid
}

/// One PAID creation by `who` (mints its own coin of `pay`): mints the char and locks it into a fresh personal
/// kiosk. No starter. Returns the character id.
fun create_paid(sc: &mut Scenario, who: address, name: vector<u8>, class: vector<u8>, pay: u64): ID {
  sc.next_tx(who);
  let mut gate = sc.take_shared<Creation>();
  let ver = sc.take_shared<Version>();
  let cfg = sc.take_shared<GameConfig>();
  let cpolicy = sc.take_shared<TransferPolicy<Character>>();
  let clk = clock::create_for_testing(sc.ctx());
  let cust = character::new_customization(1, 2, 3);
  let payment = coin::mint_for_testing<SUI>(pay, sc.ctx());

  let (chr, cpledge) = creation::create_character_paid(
    &mut gate, &cfg, name.to_string(), class.to_string(), true, cust, payment, &clk, &ver, sc.ctx(),
  );
  let cid = character::id(&chr);
  let (mut kiosk, pkcap) = new_personal_kiosk(sc);
  character::lock_in_kiosk(cpledge, chr, &mut kiosk, personal_kiosk::borrow(&pkcap), &cpolicy);

  clk.destroy_for_testing();
  personal_kiosk::transfer_to_sender(pkcap, sc.ctx());
  transfer::public_share_object(kiosk);
  ts::return_shared(gate);
  ts::return_shared(ver);
  ts::return_shared(cpolicy);
  ts::return_shared(cfg);
  cid
}

// ╔════════════════ [ Gate read getters ]════════════════════════════════════ ]

#[test]
/// The gate's free reads: fresh defaults (free enabled, unpaused, no sponsor, whitelisted class, untaken name,
/// unclaimed free slot), then after ONE free mint the name reads TAKEN (case-insensitive) and the free slot
/// reads CLAIMED for that address.
fun gate_read_getters() {
  let mut sc = ts::begin(OWNER);
  full_setup(&mut sc, true, PRICE);

  sc.next_tx(OWNER);
  let gate = sc.take_shared<Creation>();
  assert!(creation::is_free_enabled(&gate)); // ships free-on (bootstrap)
  assert!(!creation::is_paused(&gate));
  assert!(creation::sponsor(&gate).is_none()); // no sponsor gate configured
  assert!(creation::is_class(&gate, b"senshi".to_string())); // whitelisted in full_setup
  assert!(!creation::is_class(&gate, b"ghost".to_string())); // never whitelisted
  assert!(!creation::is_name_taken(&gate, b"Hero1".to_string())); // nothing minted yet
  assert!(!creation::is_free_claimed(&gate, ZK_ADDR)); // free slot open
  ts::return_shared(gate);

  create_free(&mut sc, b"Hero1", b"senshi"); // ZK_ADDR mints its free character named "hero1"

  sc.next_tx(OWNER);
  let gate2 = sc.take_shared<Creation>();
  assert!(creation::is_name_taken(&gate2, b"Hero1".to_string())); // now claimed (normalized to "hero1")
  assert!(creation::is_free_claimed(&gate2, ZK_ADDR)); // ZK_ADDR spent its one free
  ts::return_shared(gate2);
  sc.end();
}

// ╔════════════════ [ Happy paths ] ══════════════════════════════════════════ ]

#[test]
/// G1: the free character is locked in the creator's personal kiosk — and NOTHING else is minted (no weapon
/// grant exists; early weapons are loot).
fun create_free_locks_char_only() {
  let mut sc = ts::begin(OWNER);
  full_setup(&mut sc, true, PRICE);
  let cid = create_free(&mut sc, b"hero_one", b"senshi");

  sc.next_tx(BUYER);
  let kiosk = sc.take_shared<Kiosk>();
  assert!(kiosk.has_item(cid)); // the character
  assert_eq!(kiosk.item_count(), 1); // the character ALONE — no granted weapon
  ts::return_shared(kiosk);
  sc.end();
}

#[test]
/// The default additional-character price is the 10 SUI dial (before any admin override).
fun default_price_is_ten_sui() {
  let mut sc = ts::begin(OWNER);
  version::test_init(sc.ctx());
  creation::test_init(sc.ctx());
  sc.next_tx(OWNER);
  let gate = sc.take_shared<Creation>();
  assert_eq!(creation::price(&gate), TEN_SUI);
  ts::return_shared(gate);
  sc.end();
}

#[test]
fun create_paid_pays_treasury_exact() {
  let mut sc = ts::begin(OWNER);
  full_setup(&mut sc, true, PRICE);
  create_paid(&mut sc, BUYER, b"hero_one", b"senshi", PRICE);

  sc.next_tx(OWNER);
  let got = ts::take_from_address<Coin<SUI>>(&sc, @treasury);
  assert_eq!(got.value(), PRICE); // EXACT price, no change
  destroy(got);
  sc.end();
}

#[test]
fun create_paid_overpayment_refunds_change() {
  let mut sc = ts::begin(OWNER);
  full_setup(&mut sc, true, PRICE);
  create_paid(&mut sc, BUYER, b"hero_one", b"senshi", PRICE * 2); // overpay by PRICE

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
/// A free first character then a PAID additional one both succeed (only the paid one pays treasury).
fun free_then_paid_succeeds() {
  let mut sc = ts::begin(OWNER);
  full_setup(&mut sc, true, PRICE);
  create_free(&mut sc, b"hero_free", b"senshi");
  create_paid(&mut sc, BUYER, b"hero_paid", b"senshi", PRICE);

  sc.next_tx(OWNER);
  let got = ts::take_from_address<Coin<SUI>>(&sc, @treasury);
  assert_eq!(got.value(), PRICE); // only the paid character paid
  destroy(got);
  sc.end();
}

// ╔════════════════ [ Free/paid split gate (G1) ] ════════════════════════════ ]

#[test, expected_failure(abort_code = EFreeCharacterClaimed, location = creation)]
/// G1 core: a SECOND free character from the same address aborts (one-free-per-address, TOCTOU-proof).
fun second_free_character_aborts() {
  let mut sc = ts::begin(OWNER);
  full_setup(&mut sc, true, PRICE);
  create_free(&mut sc, b"hero_one", b"senshi"); // claims BUYER's free slot
  create_free(&mut sc, b"hero_two", b"senshi"); // EFreeCharacterClaimed
  abort
}

#[test, expected_failure(abort_code = EInsufficientPayment, location = creation)]
fun paid_insufficient_payment_aborts() {
  let mut sc = ts::begin(OWNER);
  full_setup(&mut sc, true, PRICE);
  create_paid(&mut sc, BUYER, b"hero_one", b"senshi", PRICE - 1); // one MIST short
  abort
}

// ╔════════════════ [ zkLogin gate — free = Google zkLogin accounts ONLY ] ════ ]

#[test, expected_failure(abort_code = ENotZkLoginAddress, location = creation)]
/// The sybil fence: free creation from a PLAIN wallet address (one NOT derived via zkLogin) aborts. Raw wallets are
/// free and infinite, so they must never farm free characters — a free char requires a Google zkLogin derivation
/// (one Google account ⇒ one address ⇒ one free char). The POSITIVE path is NOT faked here: every happy-path free
/// test above runs as `ZK_ADDR` — the framework's canonical Google zkLogin vector — through this exact native gate,
/// so each is a genuine positive proof; a synthetic passing address cannot be forged (the native checks real
/// derivation), and testnet e2e covers a live wallet end-to-end.
fun free_from_plain_address_aborts() {
  let mut sc = ts::begin(OWNER);
  full_setup(&mut sc, true, PRICE);

  sc.next_tx(BUYER); // BUYER (@0xB) is a plain wallet — NOT a zkLogin-derived address, so the gate rejects it
  let mut gate = sc.take_shared<Creation>();
  let ver = sc.take_shared<Version>();
  let cfg = sc.take_shared<GameConfig>();
  let clk = clock::create_for_testing(sc.ctx());
  let cust = character::new_customization(1, 2, 3);
  let (chr, cpledge) = creation::create_character_free(
    &mut gate, &cfg, b"hero_one".to_string(), b"senshi".to_string(), true, cust, ZK_SEED, &clk, &ver, sc.ctx(),
  ); // ENotZkLoginAddress — BUYER's address is not a Google zkLogin derivation (seed is irrelevant, the address fails)
  destroy(chr); destroy(cpledge); destroy(clk);
  ts::return_shared(gate); ts::return_shared(ver); ts::return_shared(cfg);
  abort
}



// ╔════════════════ [ Name gate ] ════════════════════════════════════════════ ]

#[test, expected_failure(abort_code = ENameTaken, location = creation)]
fun duplicate_name_aborts() {
  let mut sc = ts::begin(OWNER);
  full_setup(&mut sc, true, PRICE);
  create_paid(&mut sc, BUYER, b"hero_one", b"senshi", PRICE); // reserves "hero_one" via the paid path (no zkLogin gate)
  create_free(&mut sc, b"hero_one", b"senshi"); // ZK_ADDR free-creates the SAME name, already taken → ENameTaken
  abort
}

#[test, expected_failure(abort_code = ENameTaken, location = creation)]
fun case_insensitive_name_collision_aborts() {
  let mut sc = ts::begin(OWNER);
  full_setup(&mut sc, true, PRICE);
  create_paid(&mut sc, BUYER, b"hero_one", b"senshi", PRICE); // reserves "hero_one" via the paid path (no zkLogin gate)
  create_free(&mut sc, b"HERO_ONE", b"senshi"); // ZK_ADDR free-creates "HERO_ONE", normalizes to a taken name → ENameTaken
  abort
}

#[test, expected_failure(abort_code = ENameInvalid, location = creation)]
fun whitespace_name_aborts() {
  let mut sc = ts::begin(OWNER);
  full_setup(&mut sc, true, PRICE);
  create_free(&mut sc, b"hero one", b"senshi"); // space → ENameInvalid
  abort
}

#[test, expected_failure(abort_code = ENameInvalid, location = creation)]
fun short_name_aborts() {
  let mut sc = ts::begin(OWNER);
  full_setup(&mut sc, true, PRICE);
  create_free(&mut sc, b"ab", b"senshi"); // len 2 < 3 → ENameInvalid
  abort
}

// ╔════════════════ [ Class gate ] ═══════════════════════════════════════════ ]

#[test, expected_failure(abort_code = EUnknownClass, location = creation)]
fun unknown_class_aborts() {
  let mut sc = ts::begin(OWNER);
  full_setup(&mut sc, true, PRICE);
  create_free(&mut sc, b"hero_one", b"wizard"); // not whitelisted → EUnknownClass (before the starter check)
  abort
}

#[test, expected_failure(abort_code = EUnknownClass, location = creation)]
fun removed_class_blocks_creation() {
  let mut sc = ts::begin(OWNER);
  full_setup(&mut sc, true, PRICE);

  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<AdminCap>();
  let mut gate = sc.take_shared<Creation>();
  let ver = sc.take_shared<Version>();
  creation::remove_class(&cap, &mut gate, b"senshi".to_string(), &ver, sc.ctx());
  ts::return_shared(gate);
  ts::return_shared(ver);
  sc.return_to_sender(cap);

  create_free(&mut sc, b"hero_one", b"senshi"); // EUnknownClass
  abort
}

// ╔════════════════ [ Pause gate ] ═══════════════════════════════════════════ ]

#[test, expected_failure(abort_code = EPaused, location = creation)]
fun paused_aborts() {
  let mut sc = ts::begin(OWNER);
  full_setup(&mut sc, true, PRICE);

  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<AdminCap>();
  let mut gate = sc.take_shared<Creation>();
  let ver = sc.take_shared<Version>();
  creation::set_paused(&cap, &mut gate, true, &ver, sc.ctx());
  ts::return_shared(gate);
  ts::return_shared(ver);
  sc.return_to_sender(cap);

  create_free(&mut sc, b"hero_one", b"senshi"); // EPaused
  abort
}

// ╔════════════════ [ Version gates ] ════════════════════════════════════════ ]

#[test, expected_failure(abort_code = V_ENotEnabled, location = version)]
fun create_while_dark_aborts() {
  let mut sc = ts::begin(OWNER);
  full_setup(&mut sc, false, PRICE); // NOT enabled
  create_free(&mut sc, b"hero_one", b"senshi"); // ENotEnabled
  abort
}

#[test, expected_failure(abort_code = V_EWrongVersion, location = version)]
fun create_on_stale_version_aborts() {
  let mut sc = ts::begin(OWNER);
  full_setup(&mut sc, true, PRICE);

  sc.next_tx(OWNER);
  let mut ver = sc.take_shared<Version>();
  version::test_set_stale(&mut ver);
  ts::return_shared(ver);

  create_free(&mut sc, b"hero_one", b"senshi"); // EWrongVersion (assert_enabled → assert_latest)
  abort
}

#[test, expected_failure(abort_code = V_EWrongVersion, location = version)]
fun set_price_on_stale_version_aborts() {
  let mut sc = ts::begin(OWNER);
  full_setup(&mut sc, true, PRICE);

  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<AdminCap>();
  let mut gate = sc.take_shared<Creation>();
  let mut ver = sc.take_shared<Version>();
  version::test_set_stale(&mut ver);
  creation::set_price(&cap, &mut gate, PRICE, &ver, sc.ctx()); // EWrongVersion
  abort
}

// ╔════════════════ [ S-09e — sponsor gate + bootstrap sunset switch ] ════════ ]

const ENotAppSponsored: u64 = 110; // creation
const EFreeDisabled: u64 = 111; // creation
const STATION: address = @0xFEE; // the app's gas-station sponsor address

fun admin_set_sponsor(sc: &mut Scenario, sponsor: Option<address>) {
  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<AdminCap>();
  let ver = sc.take_shared<Version>();
  let mut gate = sc.take_shared<Creation>();
  creation::set_sponsor(&cap, &mut gate, sponsor, &ver, sc.ctx());
  ts::return_shared(gate);
  ts::return_shared(ver);
  sc.return_to_sender(cap);
}

fun admin_set_free_enabled(sc: &mut Scenario, enabled: bool) {
  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<AdminCap>();
  let ver = sc.take_shared<Version>();
  let mut gate = sc.take_shared<Creation>();
  creation::set_free_enabled(&cap, &mut gate, enabled, &ver, sc.ctx());
  ts::return_shared(gate);
  ts::return_shared(ver);
  sc.return_to_sender(cap);
}

#[test, expected_failure(abort_code = ENotAppSponsored, location = creation)]
/// APP-EXCLUSIVITY: once the admin configures the station, a free mint that did NOT arrive as a tx sponsored by
/// it aborts — even from a genuine Google zkLogin address (test_scenario txs are never sponsored).
fun free_with_sponsor_gate_unsponsored_aborts() {
  let mut sc = ts::begin(OWNER);
  full_setup(&mut sc, true, PRICE);
  admin_set_sponsor(&mut sc, option::some(STATION));
  create_free(&mut sc, b"hero_one", b"senshi"); // ENotAppSponsored — scenario ctx carries no sponsor
  abort 0
}

#[test]
/// POSITIVE sponsor proof: a tx sponsored by the configured station passes BOTH gates (sponsor + zkLogin) and
/// mints. The scenario cannot fabricate a sponsored tx, so the call runs under a framework test ctx carrying
/// `sponsor = some(STATION)` (sender stays the canonical zkLogin vector — the zkLogin gate still really runs).
fun free_with_sponsor_gate_sponsored_mints() {
  let mut sc = ts::begin(OWNER);
  full_setup(&mut sc, true, PRICE);
  admin_set_sponsor(&mut sc, option::some(STATION));

  sc.next_tx(ZK_ADDR);
  let mut gate = sc.take_shared<Creation>();
  let ver = sc.take_shared<Version>();
  let cfg = sc.take_shared<GameConfig>();
  let clk = clock::create_for_testing(sc.ctx());
  let cust = character::new_customization(1, 2, 3);
  let mut ctx = tx_context::create(
    ZK_ADDR, x"3a985da74fe225b2045c172d6bd390bd855f086e3e9d525b46bfe24511431532",
    0, 0, 0, 1000, 1000, 1_000_000, option::some(STATION),
  );
  let (chr, cpledge) = creation::create_character_free(
    &mut gate, &cfg, b"sponsy".to_string(), b"senshi".to_string(), true, cust, ZK_SEED, &clk, &ver, &mut ctx,
  );
  destroy(chr);
  destroy(cpledge);
  clk.destroy_for_testing();
  ts::return_shared(ver);
  ts::return_shared(gate);
  ts::return_shared(cfg);
  sc.end();
}

#[test, expected_failure(abort_code = EFreeDisabled, location = creation)]
/// BOOTSTRAP SUNSET: after `set_free_enabled(false)` the free path is retired — every character is paid
/// (the station + free chars live only for the launch months).
fun free_after_sunset_aborts() {
  let mut sc = ts::begin(OWNER);
  full_setup(&mut sc, true, PRICE);
  admin_set_free_enabled(&mut sc, false);
  create_free(&mut sc, b"hero_one", b"senshi"); // EFreeDisabled — the sunset switch is flipped
  abort 0
}

#[test]
/// The sunset is admin-reversible until the body-kill upgrade: off → on → the free path mints again.
fun free_sunset_is_reversible() {
  let mut sc = ts::begin(OWNER);
  full_setup(&mut sc, true, PRICE);
  admin_set_free_enabled(&mut sc, false);
  admin_set_free_enabled(&mut sc, true);
  create_free(&mut sc, b"hero_one", b"senshi");
  sc.end();
}
