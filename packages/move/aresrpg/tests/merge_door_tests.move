// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// MERGE-DOOR tests: `extract::merge_locked_stacks` — the ghost-zero-refill / stack-dedup door. Folds two
/// kiosk-LOCKED stacks of the SAME template (in ONE personal kiosk ⇒ ONE owner) into a
/// single object, re-locked. Proves: amount CONSERVED (no value created/lost), object COUNT drops to 1 (the
/// storage-bloat fix), and the adversarial matrix — same-stack refused, cross-template refused, frozen while dark.
/// Cross-OWNER is impossible by construction (one PersonalKioskCap names one kiosk), so there is no test for it —
/// no parameter can even express it.
#[test_only]
module aresrpg::merge_door_tests;

use aresrpg::{
  admin::{Self, AdminCap},
  catalog::{Self, Catalog},
  extension,
  extract::{Self, ItemExtractPolicy},
  item::{Self, Item, ItemTemplate},
  version::{Self, Version}
};
use kiosk::personal_kiosk::{Self, PersonalKioskCap};
use std::unit_test::{assert_eq, destroy};
use sui::{kiosk::{Self, Kiosk}, package::Publisher, test_scenario::{Self as ts, Scenario}, transfer_policy::TransferPolicy};

const OWNER: address = @0xA;

// ── mirrored error values (module-local; `location` disambiguates the aborting module) ──
const V_ENotEnabled: u64 = 102; // version
const ESameStack: u64 = 102; // extract::merge_locked_stacks
const ETemplateMismatch: u64 = 106; // item::merge

// ╔════════════════ [ Harness ] ══════════════════════════════════════════════ ]

/// Boot items ENABLED, whitelist "resource", author TWO stackable templates (Wood, Stone), and create BOTH the
/// marketplace policy (for the lock) and the wrapped extraction policy (for the merge door). Returns (wood, stone).
fun boot(sc: &mut Scenario): (ID, ID) {
  version::test_init(sc.ctx());
  admin::test_init(sc.ctx());
  item::test_init(sc.ctx());
  catalog::test_init(sc.ctx());

  sc.next_tx(OWNER);
  let acap = sc.take_from_sender<AdminCap>();
  let mut ver = sc.take_shared<Version>();
  let mut cat = sc.take_shared<Catalog>();
  admin::admin_set_enabled(&acap, &mut ver, true, sc.ctx());
  admin::add_category(&acap, &mut cat, b"resource".to_string(), &ver, sc.ctx());
  let wood = admin::create_template(&acap, &cat, b"Wood".to_string(), b"".to_string(), b"wood".to_string(), b"resource".to_string(), 1, option::none(), option::none(), vector[], option::none(), &ver, sc.ctx());
  let stone = admin::create_template(&acap, &cat, b"Stone".to_string(), b"".to_string(), b"stone".to_string(), b"resource".to_string(), 1, option::none(), option::none(), vector[], option::none(), &ver, sc.ctx());
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
  (wood, stone)
}

/// A fresh OWNED personal kiosk (held as a value across txs, like the extract-seam tests).
fun new_kiosk(sc: &mut Scenario): (Kiosk, PersonalKioskCap) {
  sc.next_tx(OWNER);
  let (mut k, kcap) = kiosk::new(sc.ctx());
  let pkcap = personal_kiosk::new(&mut k, kcap, sc.ctx());
  (k, pkcap)
}

/// Mint a `qty`-unit stack of `tid` and lock it into the held `kiosk`. Returns the item id.
fun mint_lock_into(sc: &mut Scenario, tid: ID, kiosk: &mut Kiosk, pkcap: &PersonalKioskCap, qty: u64): ID {
  sc.next_tx(OWNER);
  let tmpl = sc.take_shared_by_id<ItemTemplate>(tid);
  let ver = sc.take_shared<Version>();
  let mkt = sc.take_shared<TransferPolicy<Item>>();
  let (it, pledge) = extension::mint_item_stack(&tmpl, qty, &ver, sc.ctx());
  let id = object::id(&it);
  item::lock_in_kiosk(pledge, it, kiosk, personal_kiosk::borrow(pkcap), &mkt);
  ts::return_shared(tmpl); ts::return_shared(ver); ts::return_shared(mkt);
  id
}

// ╔════════════════ [ Happy paths — free split / merge conserve + stay locked ] ═══════════════════════════════ ]

#[test]
/// Split 3 units from a locked 10-stack: both 7 + 3 survivors are present in the SAME personal kiosk and their sum
/// remains exactly 10. The public door returns only the child's ID; no raw Item or address-delivery path exists.
fun split_locked_stack_conserves_and_relocks_both_halves() {
  let mut sc = ts::begin(OWNER);
  let (wood, _stone) = boot(&mut sc);
  let (mut k, pkcap) = new_kiosk(&mut sc);
  let source = mint_lock_into(&mut sc, wood, &mut k, &pkcap, 10);
  assert_eq!(k.item_count(), 1);

  sc.next_tx(OWNER);
  let ver = sc.take_shared<Version>();
  let mkt = sc.take_shared<TransferPolicy<Item>>();
  let xpolicy = sc.take_shared<ItemExtractPolicy>();
  let child = extract::split_locked_stack(&mut k, &pkcap, source, 3, &xpolicy, &mkt, &ver, sc.ctx());

  assert!(k.has_item(source));
  assert!(k.has_item(child));
  assert_eq!(k.item_count(), 2);
  let remainder = k.borrow<Item>(personal_kiosk::borrow(&pkcap), source);
  let split = k.borrow<Item>(personal_kiosk::borrow(&pkcap), child);
  assert_eq!(item::amount(remainder), 7);
  assert_eq!(item::amount(split), 3);
  assert_eq!(item::amount(remainder) + item::amount(split), 10); // no units minted or destroyed

  destroy(k); destroy(pkcap);
  ts::return_shared(ver); ts::return_shared(mkt); ts::return_shared(xpolicy);
  sc.end();
}

#[test]
/// Two locked Wood stacks (9 + 5) fold into ONE — amount CONSERVED (14), source deleted, target re-locked, and the
/// kiosk holds exactly ONE object for the template afterwards (the ~0.77 SUI/day dead-storage fix).
fun merge_folds_two_stacks_and_conserves_amount() {
  let mut sc = ts::begin(OWNER);
  let (wood, _stone) = boot(&mut sc);
  let (mut k, pkcap) = new_kiosk(&mut sc);
  let target = mint_lock_into(&mut sc, wood, &mut k, &pkcap, 9);
  let source = mint_lock_into(&mut sc, wood, &mut k, &pkcap, 5);
  assert_eq!(k.item_count(), 2); // two separate stacks pre-merge

  sc.next_tx(OWNER);
  let ver = sc.take_shared<Version>();
  let mkt = sc.take_shared<TransferPolicy<Item>>();
  let xpolicy = sc.take_shared<ItemExtractPolicy>();
  let merged = extract::merge_locked_stacks_and_relock(&mut k, &pkcap, target, source, &xpolicy, &mkt, &ver, sc.ctx());
  assert_eq!(merged, target); // the TARGET survives (stable id — the ghost/primary is kept)
  assert!(k.has_item(target)); // target back in the kiosk
  assert!(!k.has_item(source)); // source consumed + deleted
  assert_eq!(k.item_count(), 1); // ONE object per template now
  let stack = k.borrow<Item>(personal_kiosk::borrow(&pkcap), target);
  assert_eq!(item::amount(stack), 14); // 9 + 5 — conserved, no value created or lost

  destroy(k); destroy(pkcap);
  ts::return_shared(ver); ts::return_shared(mkt); ts::return_shared(xpolicy);
  sc.end();
}

// ╔════════════════ [ Adversarial matrix ] ═══════════════════════════════════ ]

#[test, expected_failure(abort_code = ESameStack, location = aresrpg::extract)]
/// Distinct-stack guard: folding an object into ITSELF is refused before any extraction (double-extract of one id).
fun merge_same_stack_aborts() {
  let mut sc = ts::begin(OWNER);
  let (wood, _stone) = boot(&mut sc);
  let (mut k, pkcap) = new_kiosk(&mut sc);
  let a = mint_lock_into(&mut sc, wood, &mut k, &pkcap, 7);

  sc.next_tx(OWNER);
  let ver = sc.take_shared<Version>();
  let xpolicy = sc.take_shared<ItemExtractPolicy>();
  let (merged, pledge) = extract::merge_locked_stacks(&mut k, &pkcap, a, a, &xpolicy, &ver, sc.ctx()); // ESameStack
  destroy(merged); destroy(pledge); destroy(k); destroy(pkcap);
  ts::return_shared(ver); ts::return_shared(xpolicy);
  abort
}

#[test, expected_failure(abort_code = ETemplateMismatch, location = aresrpg::item)]
/// Cross-template guard: a Wood stack cannot absorb a Stone stack — `item::merge` aborts ETemplateMismatch, so the
/// tx reverts and both stacks are restored (no value moved across templates).
fun merge_cross_template_aborts() {
  let mut sc = ts::begin(OWNER);
  let (wood, stone) = boot(&mut sc);
  let (mut k, pkcap) = new_kiosk(&mut sc);
  let target = mint_lock_into(&mut sc, wood, &mut k, &pkcap, 9);
  let source = mint_lock_into(&mut sc, stone, &mut k, &pkcap, 5);

  sc.next_tx(OWNER);
  let ver = sc.take_shared<Version>();
  let xpolicy = sc.take_shared<ItemExtractPolicy>();
  let (merged, pledge) = extract::merge_locked_stacks(&mut k, &pkcap, target, source, &xpolicy, &ver, sc.ctx()); // ETemplateMismatch
  destroy(merged); destroy(pledge); destroy(k); destroy(pkcap);
  ts::return_shared(ver); ts::return_shared(xpolicy);
  abort
}

#[test, expected_failure(abort_code = V_ENotEnabled, location = version)]
/// Emergency stop freezes the merge door (it is a value path — `assert_enabled`).
fun merge_while_dark_aborts() {
  let mut sc = ts::begin(OWNER);
  let (wood, _stone) = boot(&mut sc);
  let (mut k, pkcap) = new_kiosk(&mut sc);
  let target = mint_lock_into(&mut sc, wood, &mut k, &pkcap, 9);
  let source = mint_lock_into(&mut sc, wood, &mut k, &pkcap, 5);

  sc.next_tx(OWNER);
  let acap = sc.take_from_sender<AdminCap>();
  let mut ver = sc.take_shared<Version>();
  admin::admin_set_enabled(&acap, &mut ver, false, sc.ctx()); // dark
  let xpolicy = sc.take_shared<ItemExtractPolicy>();
  let (merged, pledge) = extract::merge_locked_stacks(&mut k, &pkcap, target, source, &xpolicy, &ver, sc.ctx()); // V_ENotEnabled
  destroy(merged); destroy(pledge); destroy(k); destroy(pkcap); destroy(acap);
  ts::return_shared(ver); ts::return_shared(xpolicy);
  abort
}
