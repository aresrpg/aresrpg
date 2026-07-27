// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// Extract-seam tests (c): the two royalty-safe ways a kiosk-LOCKED item leaves the market. EQUIP — pull it out
/// (`extract_for_equip`) and re-attach it onto a character (`confirm_equip`), then reverse (`unequip` → a
/// `LockPledge` forcing a personal re-lock). CONSUME — pull it out (`extract_for_burn`) and DESTROY it (`burn`),
/// which returns the exact `(template, amount)` that died. Plus the adversarial matrix: confirm under the WRONG
/// namespace cap aborts, burn under the WRONG cap aborts, an emergency stop freezes extraction, and a burn tolerates
/// a still-attached dynamic field. The pledges are abilityless (drop is a COMPILE error — proven by the struct
/// defs, not a runtime test), and no function here transfers an `Item` to an address (the module-doc type argument +
/// a package grep are the R-02 evasion probe).
#[test_only]
module aresrpg::extract_tests;

use aresrpg::{
  admin::{Self, AdminCap},
  catalog::{Self, Catalog},
  character,
  extension,
  extract::{Self, ItemExtractPolicy},
  item::{Self, Item, ItemTemplate},
  version::{Self, Version}
};
use kiosk::personal_kiosk::{Self, PersonalKioskCap};
use std::unit_test::{assert_eq, destroy};
use sui::{kiosk::{Self, Kiosk}, package::Publisher, test_scenario::{Self as ts, Scenario}, transfer_policy::TransferPolicy};

const OWNER: address = @0xA;

const V_ENotEnabled: u64 = 102; // version

/// A module-local DF key, for the "burn tolerates an attached field" test.
public struct TestKey has copy, drop, store {}

// ╔════════════════ [ Harness ] ══════════════════════════════════════════════ ]

/// Stand the package up ENABLED, whitelist `category`, author ONE template (no ranges), and create BOTH the
/// marketplace item policy (for the initial lock) and the wrapped extraction policy (for the seam). Each test uses
/// exactly one `setup*`, so `take_shared<ItemTemplate>` / `<TransferPolicy<Item>>` are unambiguous.
fun setup_with(sc: &mut Scenario, category: vector<u8>, name: vector<u8>, itype: vector<u8>) {
  version::test_init(sc.ctx());
  admin::test_init(sc.ctx());
  item::test_init(sc.ctx());
  catalog::test_init(sc.ctx());

  sc.next_tx(OWNER);
  let acap = sc.take_from_sender<AdminCap>();
  let mut ver = sc.take_shared<Version>();
  let mut cat = sc.take_shared<Catalog>();
  admin::admin_set_enabled(&acap, &mut ver, true, sc.ctx());
  admin::add_category(&acap, &mut cat, category.to_string(), &ver, sc.ctx());
  admin::create_template(
    &acap, &cat, name.to_string(), b"".to_string(), itype.to_string(), category.to_string(), 1,
    option::none(), option::none(), vector[], option::none(), &ver, sc.ctx(),
  );
  ts::return_shared(cat);

  sc.next_tx(OWNER);
  let publisher = sc.take_from_sender<Publisher>();
  let (mkt_policy, mkt_cap) = item::create_item_policy(&publisher, &ver, sc.ctx());
  transfer::public_share_object(mkt_policy);
  transfer::public_transfer(mkt_cap, OWNER);
  extract::create_extract_policy(&publisher, &ver, sc.ctx()); // the wrapped, empty extraction policy (ceremony)
  transfer::public_transfer(publisher, OWNER);

  ts::return_shared(ver);
  sc.return_to_sender(acap);
}

fun setup(sc: &mut Scenario) { setup_with(sc, b"sword", b"Sword", b"sword") } // gear (amount 1)

fun setup_stackable(sc: &mut Scenario) { setup_with(sc, b"resource", b"Wood", b"wood") } // fungible

/// Mint ONE gear item through the cap-gated mint door and LOCK it into a fresh personal kiosk. Returns the owned
/// kiosk + cap + the item id (the kiosk is a test-owned value, held across txs and destroyed at the end).
fun mint_and_lock(sc: &mut Scenario, actor: address): (Kiosk, PersonalKioskCap, ID) {
  sc.next_tx(actor);
  let tmpl = sc.take_shared<ItemTemplate>();
  let ver = sc.take_shared<Version>();
  let mkt = sc.take_shared<TransferPolicy<Item>>();
  let (it, pledge) = extension::mint_item(&tmpl, &ver, sc.ctx());
  let item_id = object::id(&it);
  let (mut kiosk, kcap) = kiosk::new(sc.ctx());
  let pkcap = personal_kiosk::new(&mut kiosk, kcap, sc.ctx());
  item::lock_in_kiosk(pledge, it, &mut kiosk, personal_kiosk::borrow(&pkcap), &mkt);
  ts::return_shared(tmpl); ts::return_shared(ver); ts::return_shared(mkt);
  (kiosk, pkcap, item_id)
}

/// Mint ONE stackable of `quantity` units and lock it — also returns the template id (for the burn assertion).
fun mint_stack_and_lock(sc: &mut Scenario, actor: address, quantity: u64): (Kiosk, PersonalKioskCap, ID, ID) {
  sc.next_tx(actor);
  let tmpl = sc.take_shared<ItemTemplate>();
  let ver = sc.take_shared<Version>();
  let mkt = sc.take_shared<TransferPolicy<Item>>();
  let tid = item::template_id(&tmpl);
  let (it, pledge) = extension::mint_item_stack(&tmpl, quantity, &ver, sc.ctx());
  let item_id = object::id(&it);
  let (mut kiosk, kcap) = kiosk::new(sc.ctx());
  let pkcap = personal_kiosk::new(&mut kiosk, kcap, sc.ctx());
  item::lock_in_kiosk(pledge, it, &mut kiosk, personal_kiosk::borrow(&pkcap), &mkt);
  ts::return_shared(tmpl); ts::return_shared(ver); ts::return_shared(mkt);
  (kiosk, pkcap, item_id, tid)
}

fun a_character(sc: &mut Scenario): (character::Character, character::LockPledge) {
  let cust = character::new_customization(1, 2, 3);
  character::new_for_testing(b"hero".to_string(), b"senshi".to_string(), true, cust, 0, sc.ctx())
}

// ╔════════════════ [ EQUIP flavor ] ═════════════════════════════════════════ ]

#[test]
/// Happy equip: extract pulls the item OUT of the kiosk; confirm attaches it as a DF under the equipment namespace.
fun equip_extract_then_confirm_attaches_item_to_character() {
  let mut sc = ts::begin(OWNER);
  setup(&mut sc);
  let (mut kiosk, pkcap, item_id) = mint_and_lock(&mut sc, OWNER);

  sc.next_tx(OWNER);
  let ver = sc.take_shared<Version>();
  let xpolicy = sc.take_shared<ItemExtractPolicy>();
  let (xitem, epledge) = extract::extract_for_equip(&mut kiosk, &pkcap, item_id, &xpolicy, &ver, sc.ctx());
  assert!(!kiosk.has_item(item_id)); // pulled OUT of the kiosk
  let (mut chr, cpledge) = a_character(&mut sc);
  extract::confirm_equip(epledge, xitem, &mut chr, &ver);
  assert!(extension::character_field_exists(&chr, extension::q8(), item_id)); // now on the character

  destroy(chr); destroy(cpledge); destroy(kiosk); destroy(pkcap);
  ts::return_shared(ver); ts::return_shared(xpolicy);
  sc.end();
}

#[test]
/// unequip returns the item + a LockPledge that FORCES a personal re-lock (discharged here into the personal kiosk).
fun unequip_returns_item_and_forces_personal_relock() {
  let mut sc = ts::begin(OWNER);
  setup(&mut sc);
  let (mut kiosk, pkcap, item_id) = mint_and_lock(&mut sc, OWNER);

  sc.next_tx(OWNER);
  let ver = sc.take_shared<Version>();
  let mkt = sc.take_shared<TransferPolicy<Item>>();
  let xpolicy = sc.take_shared<ItemExtractPolicy>();

  let (xitem, epledge) = extract::extract_for_equip(&mut kiosk, &pkcap, item_id, &xpolicy, &ver, sc.ctx());
  let (mut chr, cpledge) = a_character(&mut sc);
  extract::confirm_equip(epledge, xitem, &mut chr, &ver);

  let (item2, lockpledge) = extract::unequip(&mut chr, item_id, &ver);
  assert_eq!(object::id(&item2), item_id);
  item::lock_in_kiosk(lockpledge, item2, &mut kiosk, personal_kiosk::borrow(&pkcap), &mkt); // pledge MUST be discharged
  assert!(kiosk.has_item(item_id)); // re-locked into the personal kiosk

  destroy(chr); destroy(cpledge); destroy(kiosk); destroy(pkcap);
  ts::return_shared(ver); ts::return_shared(mkt); ts::return_shared(xpolicy);
  sc.end();
}

#[test, expected_failure(abort_code = V_ENotEnabled, location = version)]
/// Emergency stop: after the item is locked, disabling the package FREEZES extraction (the value gate aborts).
fun extract_for_equip_while_dark_aborts() {
  let mut sc = ts::begin(OWNER);
  setup(&mut sc);
  let (mut kiosk, pkcap, item_id) = mint_and_lock(&mut sc, OWNER);

  sc.next_tx(OWNER);
  let acap = sc.take_from_sender<AdminCap>();
  let mut ver = sc.take_shared<Version>();
  admin::admin_set_enabled(&acap, &mut ver, false, sc.ctx()); // emergency stop
  let xpolicy = sc.take_shared<ItemExtractPolicy>();
  let (xitem, epledge) = extract::extract_for_equip(&mut kiosk, &pkcap, item_id, &xpolicy, &ver, sc.ctx()); // V_ENotEnabled
  destroy(xitem); destroy(epledge); destroy(kiosk); destroy(pkcap); destroy(acap);
  ts::return_shared(ver); ts::return_shared(xpolicy);
  abort
}

// ╔════════════════ [ CONSUME flavor ] ═══════════════════════════════════════ ]

#[test]
/// Happy burn: extract pulls a stackable out; burn destroys it and returns the EXACT (template, amount) that died.
fun burn_extract_destroys_and_returns_template_and_amount() {
  let mut sc = ts::begin(OWNER);
  setup_stackable(&mut sc);
  let (mut kiosk, pkcap, item_id, tid) = mint_stack_and_lock(&mut sc, OWNER, 9);

  sc.next_tx(OWNER);
  let ver = sc.take_shared<Version>();
  let xpolicy = sc.take_shared<ItemExtractPolicy>();
  let (xitem, bpledge) = extract::extract_for_burn(&mut kiosk, &pkcap, item_id, &xpolicy, &ver, sc.ctx());
  let (template, amount) = extract::burn(bpledge, xitem, &ver);
  assert_eq!(template, tid); // exactly the template that died
  assert_eq!(amount, 9); // exactly the units that died (reads the real amount, not a hardcoded 1)
  assert!(!kiosk.has_item(item_id)); // the item is gone

  destroy(kiosk); destroy(pkcap);
  ts::return_shared(ver); ts::return_shared(xpolicy);
  sc.end();
}

#[test]
/// A multi-unit stack keeps its ORIGINAL id, amount minus one, and kiosk lock. Only a fresh one-unit child crosses
/// the door, paired with a BurnPledge and destroyed immediately; total units are conserved (7 = 6 + 1).
fun extract_one_splits_and_relocks_the_remainder() {
  let mut sc = ts::begin(OWNER);
  setup_stackable(&mut sc);
  let (mut kiosk, pkcap, stack_id, tid) = mint_stack_and_lock(&mut sc, OWNER, 7);

  sc.next_tx(OWNER);
  let ver = sc.take_shared<Version>();
  let xpolicy = sc.take_shared<ItemExtractPolicy>();
  let (unit, pledge) = extract::extract_one_for_burn(
    &mut kiosk, &pkcap, stack_id, &xpolicy, &ver, sc.ctx(),
  );
  assert_eq!(item::amount(&unit), 1); // exactly one unit is transiently burn-bound
  assert!(kiosk.has_item(stack_id)); // the original stack id survives as the remainder
  assert!(kiosk.is_locked(stack_id)); // the remainder is never returned unlocked
  assert_eq!(kiosk.item_count(), 1); // only the relocked remainder survives in the kiosk
  let remainder = kiosk.borrow<Item>(personal_kiosk::borrow(&pkcap), stack_id);
  assert_eq!(item::amount(remainder), 6); // amount conserved: 7 = 6 locked + 1 burned
  let (template, burned) = extract::burn(pledge, unit, &ver);
  assert_eq!(template, tid);
  assert_eq!(burned, 1);

  destroy(kiosk); destroy(pkcap);
  ts::return_shared(ver); ts::return_shared(xpolicy);
  sc.end();
}

#[test, expected_failure(abort_code = 0, location = sui::kiosk)]
/// Ownership is the kiosk cap: a cap for another personal kiosk cannot split or extract this stack.
fun extract_one_with_wrong_kiosk_cap_aborts() {
  let mut sc = ts::begin(OWNER);
  setup_stackable(&mut sc);
  let (mut kiosk, pkcap, stack_id, _tid) = mint_stack_and_lock(&mut sc, OWNER, 2);

  sc.next_tx(OWNER);
  let (mut other_kiosk, other_owner_cap) = kiosk::new(sc.ctx());
  let other_pkcap = personal_kiosk::new(&mut other_kiosk, other_owner_cap, sc.ctx());
  let ver = sc.take_shared<Version>();
  let xpolicy = sc.take_shared<ItemExtractPolicy>();
  let (unit, pledge) = extract::extract_one_for_burn(
    &mut kiosk, &other_pkcap, stack_id, &xpolicy, &ver, sc.ctx(),
  ); // sui::kiosk::ENotOwner
  destroy(unit); destroy(pledge); destroy(kiosk); destroy(pkcap); destroy(other_kiosk); destroy(other_pkcap);
  abort
}

#[test]
/// burn tolerates a still-attached dynamic field (a crushed gear's rolled stats / pet metadata orphans harmlessly —
/// `object::delete` does not abort on a live DF). Proves the destroy path is safe for gear crush.
fun burn_tolerates_attached_dynamic_field() {
  let mut sc = ts::begin(OWNER);
  setup(&mut sc);

  sc.next_tx(OWNER);
  let tmpl = sc.take_shared<ItemTemplate>();
  let ver = sc.take_shared<Version>();
  let mkt = sc.take_shared<TransferPolicy<Item>>();
  let xpolicy = sc.take_shared<ItemExtractPolicy>();
  let (mut it, pledge) = extension::mint_item(&tmpl, &ver, sc.ctx());
  let item_id = object::id(&it);
  extension::add_item_field(extension::ns_item(), &mut it, TestKey {}, 123u64, &ver); // a live DF on the item
  let (mut kiosk, kcap) = kiosk::new(sc.ctx());
  let pkcap = personal_kiosk::new(&mut kiosk, kcap, sc.ctx());
  item::lock_in_kiosk(pledge, it, &mut kiosk, personal_kiosk::borrow(&pkcap), &mkt);

  let (xitem, bpledge) = extract::extract_for_burn(&mut kiosk, &pkcap, item_id, &xpolicy, &ver, sc.ctx());
  let (_t, amount) = extract::burn(bpledge, xitem, &ver); // must NOT abort despite the attached DF
  assert_eq!(amount, 1);

  destroy(kiosk); destroy(pkcap);
  ts::return_shared(tmpl); ts::return_shared(ver); ts::return_shared(mkt); ts::return_shared(xpolicy);
  sc.end();
}

// ╔════════════════ [ Extraction policy ] ════════════════════════════════════ ]

#[test]
/// The ceremony creates a SHARED, wrapped extraction policy (its inner TransferPolicy<Item> + cap are sealed away).
fun create_extract_policy_shares_a_wrapped_policy() {
  let mut sc = ts::begin(OWNER);
  setup(&mut sc);
  sc.next_tx(OWNER);
  let xpolicy = sc.take_shared<ItemExtractPolicy>(); // proves it was created + shared
  ts::return_shared(xpolicy);
  sc.end();
}
