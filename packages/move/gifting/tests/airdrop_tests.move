// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// AIRDROP tests: whitelist claim-mint (`airdrop`). Drives the REAL mint-lock path (`mint_and_lock_output`) into
/// genuine personal kiosks. Covers: a whitelisted claim mints + locks EXACTLY one into the claimer's own kiosk
/// and removes them from the whitelist (minted counter ticks); a second claim by the same address aborts
/// `ENotEligible` (one-claim by construction); a non-whitelisted claim aborts `ENotEligible`; a wrong-template
/// claim aborts `EWrongTemplate`; two independent whitelisted recipients each claim their own item;
/// `admin_close` consumes the drop (dropping a partially-claimed whitelist table); and the whitelist lifecycle —
/// dup-add is idempotent (set-count exact), remove REVOKES a pending claim, remove-absent is a no-op.
#[test_only]
module aresrpg_gifting::airdrop_tests;

use aresrpg::{
  admin::{Self, AdminCap},
  catalog::{Self, Catalog},
  config::{Self, GameConfig},
  item::{Self, Item, ItemTemplate},
  version::{Self, Version}
};
use aresrpg_gifting::{airdrop, gifting::Gifting};
use kiosk::personal_kiosk::{Self, PersonalKioskCap};
use std::unit_test::assert_eq;
use sui::{
  kiosk::{Self, Kiosk},
  package::Publisher,
  test_scenario::{Self as ts, Scenario},
  transfer_policy::TransferPolicy
};

const OWNER: address = @0xA;
const ALICE: address = @0xA11CE;
const BOB: address = @0xB0B;
const CAROL: address = @0xCA401; // never whitelisted

// ── mirrored error consts (the #[expected_failure] `location` disambiguates the aborting module) ──
const ENotEligible: u64 = 101; // airdrop
const EWrongTemplate: u64 = 102; // airdrop

// ╔════════════════ [ Harness ] ══════════════════════════════════════════════ ]

/// Boot the package ENABLED, whitelist a cosmetic (non-stackable) category, author ONE reserved template + a
/// DECOY template (for the wrong-template test), and create a bare Item policy. Returns (reserved_tid, decoy_tid).
fun boot(sc: &mut Scenario): (ID, ID) {
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
  config::set_gifting_brand<Gifting>(&acap, &mut cfg, &ver, sc.ctx()); // the split's pin
  let mut cat = sc.take_shared<Catalog>();
  admin::add_category(&acap, &mut cat, b"cosmetic".to_string(), &ver, sc.ctx());
  let reserved = admin::create_template(&acap, &cat, b"Vaporeon Aura".to_string(), b"".to_string(), b"vaporeon_aura".to_string(), b"icon".to_string(), b"cosmetic".to_string(), 1, option::none(), option::none(), vector[], option::none(), &ver, sc.ctx());
  let decoy = admin::create_template(&acap, &cat, b"Decoy".to_string(), b"".to_string(), b"decoy".to_string(), b"icon".to_string(), b"cosmetic".to_string(), 1, option::none(), option::none(), vector[], option::none(), &ver, sc.ctx());
  ts::return_shared(cat);

  sc.next_tx(OWNER);
  let publisher = sc.take_from_sender<Publisher>();
  let (policy, cap) = item::create_item_policy(&publisher, &ver, sc.ctx());
  transfer::public_share_object(policy);
  transfer::public_transfer(cap, OWNER);
  transfer::public_transfer(publisher, OWNER);
  ts::return_shared(ver);
  ts::return_shared(cfg);
  sc.return_to_sender(acap);
  (reserved, decoy)
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

/// OWNER creates + shares an `Airdrop` for template `tid`.
fun create_airdrop(sc: &mut Scenario, tid: ID) {
  sc.next_tx(OWNER);
  let acap = sc.take_from_sender<AdminCap>();
  let ver = sc.take_shared<Version>();
  let tmpl = ts::take_shared_by_id<ItemTemplate>(sc, tid);
  airdrop::admin_create(&acap, &tmpl, b"Vaporeon Drop".to_string(), b"For the Vaporeon community.".to_string(), &ver, sc.ctx());
  ts::return_shared(tmpl); ts::return_shared(ver); sc.return_to_sender(acap);
}

/// OWNER whitelists `addrs` on the (single) shared `Airdrop`.
fun whitelist(sc: &mut Scenario, addrs: vector<address>) {
  sc.next_tx(OWNER);
  let acap = sc.take_from_sender<AdminCap>();
  let ver = sc.take_shared<Version>();
  let mut a = ts::take_shared<airdrop::Airdrop>(sc);
  airdrop::admin_add_addresses(&acap, &mut a, addrs, &ver, sc.ctx());
  ts::return_shared(a); ts::return_shared(ver); sc.return_to_sender(acap);
}

/// OWNER removes `addrs` from the (single) shared `Airdrop`'s whitelist.
fun unwhitelist(sc: &mut Scenario, addrs: vector<address>) {
  sc.next_tx(OWNER);
  let acap = sc.take_from_sender<AdminCap>();
  let ver = sc.take_shared<Version>();
  let mut a = ts::take_shared<airdrop::Airdrop>(sc);
  airdrop::admin_remove_addresses(&acap, &mut a, addrs, &ver, sc.ctx());
  ts::return_shared(a); ts::return_shared(ver); sc.return_to_sender(acap);
}

/// `who` claims into their kiosk `kid` with template `tid`.
fun do_claim(sc: &mut Scenario, who: address, kid: ID, tid: ID) {
  sc.next_tx(who);
  let mut a = ts::take_shared<airdrop::Airdrop>(sc);
  let tmpl = ts::take_shared_by_id<ItemTemplate>(sc, tid);
  let mut k = ts::take_shared_by_id<Kiosk>(sc, kid);
  let pkcap = sc.take_from_sender<PersonalKioskCap>();
  let policy = sc.take_shared<TransferPolicy<Item>>();
  let cfg = sc.take_shared<GameConfig>();
  let ver = sc.take_shared<Version>();
  airdrop::claim(&mut a, &tmpl, &mut k, &pkcap, &policy, &cfg, &ver, sc.ctx());
  ts::return_shared(a); ts::return_shared(tmpl); ts::return_shared(k); sc.return_to_sender(pkcap); ts::return_shared(policy); ts::return_shared(cfg); ts::return_shared(ver);
}

// ╔════════════════ [ Tests ] ════════════════════════════════════════════════ ]

#[test]
/// Golden: a whitelisted claim mints + locks exactly one item into the claimer's own kiosk, removes the claimer
/// from the whitelist, and ticks the minted counter.
fun claim_mints_locks_and_removes() {
  let mut sc = ts::begin(OWNER);
  let (tid, _decoy) = boot(&mut sc);
  let kid = make_kiosk(&mut sc, ALICE);
  create_airdrop(&mut sc, tid);
  whitelist(&mut sc, vector[ALICE]);
  do_claim(&mut sc, ALICE, kid, tid);

  sc.next_tx(ALICE);
  let a = ts::take_shared<airdrop::Airdrop>(&sc);
  let k = ts::take_shared_by_id<Kiosk>(&sc, kid);
  assert_eq!(kiosk::item_count(&k), 1); // exactly one item minted + locked in
  assert!(!airdrop::is_eligible(&a, ALICE)); // removed → one-claim by construction
  assert_eq!(airdrop::minted(&a), 1);
  ts::return_shared(a); ts::return_shared(k);
  sc.end();
}

#[test, expected_failure(abort_code = ENotEligible, location = aresrpg_gifting::airdrop)]
/// A second claim by the same address aborts `ENotEligible` — the first claim removed them.
fun double_claim_aborts() {
  let mut sc = ts::begin(OWNER);
  let (tid, _decoy) = boot(&mut sc);
  let kid = make_kiosk(&mut sc, ALICE);
  create_airdrop(&mut sc, tid);
  whitelist(&mut sc, vector[ALICE]);
  do_claim(&mut sc, ALICE, kid, tid);
  do_claim(&mut sc, ALICE, kid, tid); // ABORTS ENotEligible
  abort 0
}

#[test, expected_failure(abort_code = ENotEligible, location = aresrpg_gifting::airdrop)]
/// A non-whitelisted address cannot claim (`ENotEligible`).
fun non_whitelisted_claim_aborts() {
  let mut sc = ts::begin(OWNER);
  let (tid, _decoy) = boot(&mut sc);
  let kid = make_kiosk(&mut sc, CAROL);
  create_airdrop(&mut sc, tid);
  whitelist(&mut sc, vector[ALICE]); // CAROL is NOT whitelisted
  do_claim(&mut sc, CAROL, kid, tid); // ABORTS ENotEligible
  abort 0
}

#[test, expected_failure(abort_code = EWrongTemplate, location = aresrpg_gifting::airdrop)]
/// Claiming with a template other than the drop's aborts `EWrongTemplate`.
fun wrong_template_aborts() {
  let mut sc = ts::begin(OWNER);
  let (tid, decoy) = boot(&mut sc);
  let kid = make_kiosk(&mut sc, ALICE);
  create_airdrop(&mut sc, tid);
  whitelist(&mut sc, vector[ALICE]);
  do_claim(&mut sc, ALICE, kid, decoy); // ABORTS EWrongTemplate
  abort 0
}

#[test]
/// Two independent whitelisted recipients each claim their OWN item into their OWN kiosk (the "different
/// recipient" case — delivery is always to the signer's own kiosk, so each recipient == its own claimer).
fun two_recipients_claim_independently() {
  let mut sc = ts::begin(OWNER);
  let (tid, _decoy) = boot(&mut sc);
  let akid = make_kiosk(&mut sc, ALICE);
  let bkid = make_kiosk(&mut sc, BOB);
  create_airdrop(&mut sc, tid);
  whitelist(&mut sc, vector[ALICE, BOB]);
  do_claim(&mut sc, ALICE, akid, tid);
  do_claim(&mut sc, BOB, bkid, tid);

  sc.next_tx(OWNER);
  let a = ts::take_shared<airdrop::Airdrop>(&sc);
  let ak = ts::take_shared_by_id<Kiosk>(&sc, akid);
  let bk = ts::take_shared_by_id<Kiosk>(&sc, bkid);
  assert_eq!(kiosk::item_count(&ak), 1);
  assert_eq!(kiosk::item_count(&bk), 1);
  assert_eq!(airdrop::minted(&a), 2);
  assert!(!airdrop::is_eligible(&a, ALICE) && !airdrop::is_eligible(&a, BOB));
  ts::return_shared(a); ts::return_shared(ak); ts::return_shared(bk);
  sc.end();
}

#[test]
/// Close semantics: after a partial claim, `admin_close` consumes the drop and drops the (non-empty) whitelist
/// table — the scenario ends with no leaked Airdrop.
fun admin_close_consumes_drop() {
  let mut sc = ts::begin(OWNER);
  let (tid, _decoy) = boot(&mut sc);
  let kid = make_kiosk(&mut sc, ALICE);
  create_airdrop(&mut sc, tid);
  whitelist(&mut sc, vector[ALICE, BOB]); // BOB never claims → table non-empty at close
  do_claim(&mut sc, ALICE, kid, tid);

  sc.next_tx(OWNER);
  let acap = sc.take_from_sender<AdminCap>();
  let ver = sc.take_shared<Version>();
  let a = ts::take_shared<airdrop::Airdrop>(&sc);
  airdrop::admin_close(&acap, a, &ver, sc.ctx());
  ts::return_shared(ver); sc.return_to_sender(acap);
  sc.end();
}

#[test]
/// Duplicate add does NOT abort (idempotent — an overlapping snapshot re-run is safe): ALICE added twice across
/// two batches → still counted once; BOB (the batch's new entry) lands. The eligible count reflects the ACTUAL
/// set, matching the applied-delta events.
fun dup_add_does_not_abort() {
  let mut sc = ts::begin(OWNER);
  let (tid, _decoy) = boot(&mut sc);
  create_airdrop(&mut sc, tid);
  whitelist(&mut sc, vector[ALICE]);
  whitelist(&mut sc, vector[ALICE, BOB]); // ALICE is a dup — skipped, not an abort

  sc.next_tx(OWNER);
  let a = ts::take_shared<airdrop::Airdrop>(&sc);
  assert_eq!(airdrop::eligible_count(&a), 2); // ALICE once + BOB — the dup applied nothing
  assert!(airdrop::is_eligible(&a, ALICE) && airdrop::is_eligible(&a, BOB));
  ts::return_shared(a);
  sc.end();
}

#[test, expected_failure(abort_code = ENotEligible, location = aresrpg_gifting::airdrop)]
/// Removed-then-claim aborts `ENotEligible`: an address struck off the whitelist (bad snapshot row, abuse) can
/// no longer claim — remove is a real revocation, not cosmetic.
fun remove_then_claim_aborts() {
  let mut sc = ts::begin(OWNER);
  let (tid, _decoy) = boot(&mut sc);
  let kid = make_kiosk(&mut sc, ALICE);
  create_airdrop(&mut sc, tid);
  whitelist(&mut sc, vector[ALICE]);
  unwhitelist(&mut sc, vector[ALICE]);
  do_claim(&mut sc, ALICE, kid, tid); // ABORTS ENotEligible — revoked
  abort 0
}

#[test]
/// Removing an ABSENT address is a no-op (idempotent): no abort, and the existing whitelist is untouched.
fun remove_absent_is_noop() {
  let mut sc = ts::begin(OWNER);
  let (tid, _decoy) = boot(&mut sc);
  create_airdrop(&mut sc, tid);
  whitelist(&mut sc, vector[ALICE]);
  unwhitelist(&mut sc, vector[CAROL]); // CAROL was never whitelisted — skipped, not an abort

  sc.next_tx(OWNER);
  let a = ts::take_shared<airdrop::Airdrop>(&sc);
  assert_eq!(airdrop::eligible_count(&a), 1); // ALICE untouched
  assert!(airdrop::is_eligible(&a, ALICE));
  ts::return_shared(a);
  sc.end();
}
