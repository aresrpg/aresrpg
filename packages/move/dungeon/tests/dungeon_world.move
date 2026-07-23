// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// Shared #[test_only] scaffold for the dungeon engine-bridge suite — the WORLD+CHARACTER+ITEM slice of core's
/// `test_world` (which lives in the core package's tests/ and a dependent package's test build cannot see). Boots
/// core's Version + AdminCap + GameConfig + Catalog + BOTH transfer policies + the extract policy + the `resource`
/// category, ENABLED, and — the split's one new move — PINS this package's `Dungeon` witness into
/// `GameConfig.dungeon_brand` (`set_dungeon_brand<Dungeon>`), so `dungeon::next_fight`/`join_fight` drive the REAL
/// brand-gated core fight doors end to end. The ENGINE half (registry/version) is booted by the suite's own
/// `boot_engine`.
#[test_only]
module aresrpg_dungeon::dungeon_world;

use aresrpg::{
  admin::{Self, AdminCap},
  catalog::{Self as catalog, Catalog},
  character::{Self as character},
  config::{Self as config, GameConfig},
  extension,
  extract,
  item::{Self as item, Item, ItemTemplate},
  version::{Self, Version},
  world::{Self as world, World}
};
use aresrpg_dungeon::dungeon::Dungeon;
use kiosk::personal_kiosk::{Self, PersonalKioskCap};
use sui::{
  kiosk::{Self, Kiosk},
  package::{Self, Publisher},
  test_scenario::{Self as ts, Scenario},
  transfer_policy::TransferPolicy
};

const OWNER: address = @0xA;

// Resource-template + world constants (deterministic densities so spawn counts are exact).
const RES_RATE: u16 = 100;
const RES_QTY: u16 = 1;
const MOB_RATE: u16 = 100;
const MOB_GROUP: u16 = 2;
const DENSITY: u16 = 2;

public fun owner(): address { OWNER }

/// Stand up the CORE half the dungeon suite composes over — all ENABLED — then pin `Dungeon` as the live brand.
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
  // THE SPLIT'S PIN: this package's witness becomes the ONE key the brand-gated core fight doors accept.
  config::set_dungeon_brand<Dungeon>(&cap, &mut cfg, &ver, sc.ctx());
  let mut cat = sc.take_shared<Catalog>();
  admin::add_category(&cap, &mut cat, b"resource".to_string(), &ver, sc.ctx());

  // both Displays claim a Publisher (same package, different module) — disambiguate by module, then make policies
  let pub_a = sc.take_from_sender<Publisher>();
  let pub_b = sc.take_from_sender<Publisher>();
  let (item_pub, char_pub) = if (package::from_module<Item>(&pub_a)) (pub_a, pub_b) else (pub_b, pub_a);
  let (ipolicy, ipolicy_cap) = item::create_item_policy(&item_pub, &ver, sc.ctx());
  let (cpolicy, cpolicy_cap) = character::create_character_policy(&char_pub, &ver, sc.ctx());
  extract::create_extract_policy(&item_pub, &ver, sc.ctx());
  transfer::public_share_object(ipolicy);
  transfer::public_share_object(cpolicy);

  transfer::public_transfer(ipolicy_cap, OWNER);
  transfer::public_transfer(cpolicy_cap, OWNER);
  transfer::public_transfer(item_pub, OWNER);
  transfer::public_transfer(char_pub, OWNER);
  ts::return_shared(ver);
  ts::return_shared(cfg);
  ts::return_shared(cat);
  sc.return_to_sender(cap);
}

/// Author + share a stackable RESOURCE ItemTemplate (category "resource", level 1); returns its id.
public fun make_resource_template(sc: &mut Scenario): ID {
  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<AdminCap>();
  let cat = sc.take_shared<Catalog>();
  let ver = sc.take_shared<Version>();
  let tid = admin::create_template(
    &cap, &cat, b"Wheat".to_string(), b"A dungeon-suite artifact.".to_string(), b"wheat".to_string(),
    b"resource".to_string(), 1, option::none(), option::none(), vector[], option::none(), &ver, sc.ctx(),
  );
  ts::return_shared(cat);
  ts::return_shared(ver);
  sc.return_to_sender(cap);
  tid
}

/// Create + share a World seeded with ONE resource entry (given `job`/`tier`) and ONE mob entry, fixed density.
/// Returns the world id. `required_level` stays 1.
public fun make_world(sc: &mut Scenario, resource_tid: ID, job: u8, tier: u8): ID {
  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<AdminCap>();
  let ver = sc.take_shared<Version>();
  let wid = world::create_world(&cap, &ver, 7, b"glacial".to_string(), sc.ctx());
  sc.next_tx(OWNER);
  let mut w = sc.take_shared<World>();
  world::set_density(&cap, &mut w, DENSITY, DENSITY, DENSITY, DENSITY, &ver, sc.ctx());
  world::add_resource_entry(&cap, &mut w, resource_tid, RES_RATE, RES_QTY, RES_QTY, job, tier, &ver, sc.ctx());
  world::add_mob_entry(&cap, &mut w, object::id_from_address(@0xB0B), MOB_RATE, MOB_GROUP, MOB_GROUP, &ver, sc.ctx());
  ts::return_shared(w);
  ts::return_shared(ver);
  sc.return_to_sender(cap);
  wid
}

/// Mint a STACKABLE item of `quantity` units and LOCK it into `who`'s shared personal kiosk (via the public core
/// test route to a (stack, LockPledge)). Returns the item id.
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

/// Mint a fresh Character (level 1) locked into a new PERSONAL kiosk owned by `who`. Returns the character id.
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
