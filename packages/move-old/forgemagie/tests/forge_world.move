// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// Shared #[test_only] scaffold for the forgemagie suites — the ITEMS+CHARACTER slice of core's `test_world`
/// (that module lives in the core package's tests/ directory, which a dependent package's test build cannot
/// see; the core #[test_only] SOURCE helpers — `config::test_init`, `character::new_for_testing`,
/// `extension::mint_item_for_testing`, … — remain available and are exactly what this scaffold composes).
/// Boots core's Version + AdminCap + GameConfig + Catalog + BOTH transfer policies + the extract policy,
/// ENABLED, and — the split's one new move — PINS this package's `Forge` witness into `GameConfig.forge_brand`
/// (`set_forge_brand<Forge>`), so every suite drives the REAL brand-gated core doors end to end.
#[test_only]
module aresrpg_forgemagie::forge_world;

use aresrpg::{admin::{Self, AdminCap, Self as catalog, Catalog}, character::Self as character, config::{Self as config, GameConfig}, extract, item::{Self as item, Item, ItemTemplate}, item_stats::ItemStatistics, version::{Self, Version}};
use aresrpg_forgemagie::forgemagie::{Self, Forge};
use kiosk::personal_kiosk::{Self, PersonalKioskCap};
use sui::{
  kiosk::{Self, Kiosk},
  package::{Self, Publisher},
  test_scenario::{Self as ts, Scenario},
  transfer_policy::TransferPolicy
};

const OWNER: address = @0xA;

public fun owner(): address { OWNER }

/// Stand up the CORE half this package composes over: Version + AdminCap + GameConfig + Catalog + Item and
/// Character policies + the extract policy — all ENABLED — then pin `Forge` as the live forge brand.
public fun boot(sc: &mut Scenario) {
  version::test_init(sc.ctx());
  admin::test_init(sc.ctx());
  config::test_init(sc.ctx());
  item::test_init(sc.ctx());
  character::test_init(sc.ctx());
  admin::test_init_catalog(sc.ctx());

  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<AdminCap>();
  let mut ver = sc.take_shared<Version>();
  admin::admin_set_enabled(&cap, &mut ver, true, sc.ctx());
  let mut cfg = sc.take_shared<GameConfig>();
  config::set_enabled(&cap, &mut cfg, true, sc.ctx());
  // THE SPLIT'S PIN: this package's witness becomes the ONE key the brand-gated core doors accept.
  config::set_forge_brand<Forge>(&cap, &mut cfg, &ver, sc.ctx());

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

/// Whitelist a category on the items catalog (the suites author their own sword/rune categories).
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
    &cap, &cat, name.to_string(), b"A forge-suite artifact.".to_string(), item_type.to_string(), category.to_string(), level,
    option::none(), option::none(), vector[], option::none(), &ver, sc.ctx(),
  );
  ts::return_shared(cat);
  ts::return_shared(ver);
  sc.return_to_sender(cap);
  tid
}

/// Author + share an ItemTemplate WITH [min,max] roll ranges (the old two-step make+attach collapsed — the
/// core `attach_ranges` write is package-private; `create_template` attaches the same block at authoring).
public fun make_template_ranged(sc: &mut Scenario, name: vector<u8>, item_type: vector<u8>, category: vector<u8>, level: u16, min: ItemStatistics, max: ItemStatistics): ID {
  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<AdminCap>();
  let cat = sc.take_shared<Catalog>();
  let ver = sc.take_shared<Version>();
  let tid = admin::create_template(
    &cap, &cat, name.to_string(), b"A forge-suite artifact.".to_string(), item_type.to_string(), category.to_string(), level,
    option::some(min), option::some(max), vector[], option::none(), &ver, sc.ctx(),
  );
  ts::return_shared(cat);
  ts::return_shared(ver);
  sc.return_to_sender(cap);
  tid
}

/// Mint a STACKABLE item of `quantity` units and LOCK it into `who`'s shared personal kiosk — through the REAL
/// brand-gated mint door (the fixture is itself a brand-path proof). Returns the item id.
public fun mint_lock_stack(sc: &mut Scenario, who: address, template_id: ID, quantity: u64): ID {
  sc.next_tx(who);
  let tmpl = ts::take_shared_by_id<ItemTemplate>(sc, template_id);
  let cfg = sc.take_shared<GameConfig>();
  let ver = sc.take_shared<Version>();
  let mkt = sc.take_shared<TransferPolicy<Item>>();
  let mut k = sc.take_shared<Kiosk>();
  let pkcap = sc.take_from_sender<PersonalKioskCap>();
  let iid = forgemagie::mint_lock_stack_for_testing(&cfg, &tmpl, quantity, &mut k, &pkcap, &mkt, &ver, sc.ctx());
  ts::return_shared(tmpl); ts::return_shared(cfg); ts::return_shared(ver); ts::return_shared(mkt); ts::return_shared(k); sc.return_to_sender(pkcap);
  iid
}

/// Mint a NON-stackable (gear) item and LOCK it into `who`'s shared personal kiosk. Returns the item id.
public fun mint_lock_gear(sc: &mut Scenario, who: address, template_id: ID): ID {
  sc.next_tx(who);
  let tmpl = ts::take_shared_by_id<ItemTemplate>(sc, template_id);
  let ver = sc.take_shared<Version>();
  let mkt = sc.take_shared<TransferPolicy<Item>>();
  let mut k = sc.take_shared<Kiosk>();
  let pkcap = sc.take_from_sender<PersonalKioskCap>();
  let iid = forgemagie::mint_lock_gear_for_testing(&tmpl, &mut k, &pkcap, &mkt, &ver, sc.ctx());
  ts::return_shared(tmpl); ts::return_shared(ver); ts::return_shared(mkt); ts::return_shared(k); sc.return_to_sender(pkcap);
  iid
}

/// Bank `xp` job experience for `job` on `who`'s character `cid` — through the REAL brand-gated xp door.
public fun bank_job_xp(sc: &mut Scenario, who: address, cid: ID, job: u8, xp: u64) {
  sc.next_tx(who);
  let cfg = sc.take_shared<GameConfig>();
  let mut k = sc.take_shared<Kiosk>();
  let pkcap = sc.take_from_sender<PersonalKioskCap>();
  let ver = sc.take_shared<Version>();
  forgemagie::bank_job_xp_for_testing(&cfg, &mut k, &pkcap, cid, job, xp, &ver);
  ts::return_shared(cfg); ts::return_shared(k); sc.return_to_sender(pkcap); ts::return_shared(ver);
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
