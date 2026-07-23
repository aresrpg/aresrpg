// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// Shared #[test_only] scaffold for the gifting suites that need a full CORE stand-up (the ITEMS+CHARACTER slice
/// of core's `test_world`, which lives in the core package's tests/ and a dependent package's test build cannot
/// see). Boots core's Version + AdminCap + GameConfig + Catalog + BOTH transfer policies + the extract policy,
/// ENABLED. The gifting-brand PIN is deliberately OMITTED — the sole consumer (`consume_link_tests`) drives the
/// NON-brand `character_link::consume_units`; the brand-door suites (airdrop/loot_box/consume/pool/creation) pin
/// their own witness inside their own inline boots.
#[test_only]
module aresrpg_gifting::gift_world;

use aresrpg::{
  admin::{Self, AdminCap},
  catalog::{Self as catalog, Catalog},
  character::{Self as character},
  config::{Self as config, GameConfig},
  extension,
  extract,
  item::{Self as item, Item, ItemTemplate},
  version::{Self, Version}
};
use aresrpg_gifting::gifting::Gifting;
use kiosk::personal_kiosk::{Self, PersonalKioskCap};
use sui::{
  kiosk::{Self, Kiosk},
  package::{Self, Publisher},
  test_scenario::{Self as ts, Scenario},
  transfer_policy::TransferPolicy
};

const OWNER: address = @0xA;

public fun owner(): address { OWNER }

/// Stand up the CORE half the gifting suites compose over: Version + AdminCap + GameConfig + Catalog + Item and
/// Character policies + the extract policy — all ENABLED.
public fun boot(sc: &mut Scenario) {
  version::test_init(sc.ctx());
  admin::test_init(sc.ctx());
  config::test_init(sc.ctx());
  item::test_init(sc.ctx());
  character::test_init(sc.ctx());
  catalog::test_init(sc.ctx());

  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<AdminCap>();
  let mut ver = sc.take_shared<Version>();
  admin::admin_set_enabled(&cap, &mut ver, true, sc.ctx());
  let mut cfg = sc.take_shared<GameConfig>();
  config::set_enabled(&cap, &mut cfg, true, sc.ctx());
  config::set_gifting_brand<Gifting>(&cap, &mut cfg, &ver, sc.ctx()); // the split's pin: gifting's witness

  // both Displays claim a Publisher (same package, different module) — disambiguate by module, then make policies
  let pub_a = sc.take_from_sender<Publisher>();
  let pub_b = sc.take_from_sender<Publisher>();
  let (item_pub, char_pub) = if (package::from_module<Item>(&pub_a)) (pub_a, pub_b) else (pub_b, pub_a);
  let (ipolicy, ipolicy_cap) = item::create_item_policy(&item_pub, &ver, sc.ctx());
  let (cpolicy, cpolicy_cap) = character::create_character_policy(&char_pub, &ver, sc.ctx());
  extract::create_extract_policy(&item_pub, &ver, sc.ctx()); // the wrapped extraction policy the burn seam needs
  transfer::public_share_object(ipolicy);
  transfer::public_share_object(cpolicy);

  transfer::public_transfer(ipolicy_cap, OWNER);
  transfer::public_transfer(cpolicy_cap, OWNER);
  transfer::public_transfer(item_pub, OWNER);
  transfer::public_transfer(char_pub, OWNER);
  ts::return_shared(ver);
  ts::return_shared(cfg);
  sc.return_to_sender(cap);
}

/// Whitelist a category on the items catalog (the suites author their own consumable categories).
public fun whitelist(sc: &mut Scenario, category: vector<u8>) {
  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<AdminCap>();
  let mut cat = sc.take_shared<Catalog>();
  let ver = sc.take_shared<Version>();
  admin::add_category(&cap, &mut cat, category.to_string(), &ver, sc.ctx());
  ts::return_shared(cat);
  ts::return_shared(ver);
  sc.return_to_sender(cap);
}

/// Author + share a generic ItemTemplate (no stat ranges) of `category` at `level`; returns its id.
public fun make_template(sc: &mut Scenario, name: vector<u8>, item_type: vector<u8>, category: vector<u8>, level: u16): ID {
  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<AdminCap>();
  let cat = sc.take_shared<Catalog>();
  let ver = sc.take_shared<Version>();
  let tid = admin::create_template(
    &cap, &cat, name.to_string(), b"A gifting-suite artifact.".to_string(), item_type.to_string(), b"icon".to_string(), category.to_string(), level,
    option::none(), option::none(), vector[], option::none(), &ver, sc.ctx(),
  );
  ts::return_shared(cat);
  ts::return_shared(ver);
  sc.return_to_sender(cap);
  tid
}

/// Mint a STACKABLE item of `quantity` units and LOCK it into `who`'s shared personal kiosk (via the public
/// core test route to a (stack, LockPledge)). Returns the item id.
public fun mint_lock_stack(sc: &mut Scenario, who: address, template_id: ID, quantity: u64): ID {
  sc.next_tx(who);
  let tmpl = ts::take_shared_by_id<ItemTemplate>(sc, template_id);
  let ver = sc.take_shared<Version>();
  let mkt = sc.take_shared<TransferPolicy<Item>>();
  let mut k = sc.take_shared<Kiosk>();
  let pkcap = sc.take_from_sender<PersonalKioskCap>();
  let (it, pledge) = extension::mint_item_stack_for_testing(&tmpl, quantity, &ver, sc.ctx());
  let iid = object::id(&it);
  item::lock_in_kiosk(pledge, it, &mut k, personal_kiosk::borrow(&pkcap), &mkt);
  ts::return_shared(tmpl); ts::return_shared(ver); ts::return_shared(mkt); ts::return_shared(k); sc.return_to_sender(pkcap);
  iid
}

/// Mint a fresh Character (level 1) locked into a new PERSONAL kiosk owned by `who` (the kiosk is shared; the
/// PersonalKioskCap goes to `who`). Mirrors core `test_world::mint_character` verbatim.
public fun mint_character(sc: &mut Scenario, who: address): ID {
  sc.next_tx(who);
  let cpolicy = sc.take_shared<TransferPolicy<aresrpg::character::Character>>();
  let cust = character::new_customization(1, 2, 3);
  let (chr, pledge) = character::new_for_testing(b"hero".to_string(), b"senshi".to_string(), true, cust, 1000, sc.ctx());
  let cid = character::id(&chr);
  let (mut k, kcap) = kiosk::new(sc.ctx());
  let pkcap = personal_kiosk::new(&mut k, kcap, sc.ctx());
  character::lock_in_kiosk(pledge, chr, &mut k, personal_kiosk::borrow(&pkcap), &cpolicy);
  personal_kiosk::transfer_to_sender(pkcap, sc.ctx());
  transfer::public_share_object(k);
  ts::return_shared(cpolicy);
  cid
}
