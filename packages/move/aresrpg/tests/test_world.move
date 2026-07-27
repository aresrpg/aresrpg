// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// Shared test harness for the world / zones / gathering suites: stands up the ONE merged aresrpg package,
/// enables every gate (S-46: no cap-deposit ceremony — first-party writes are public(package) now), creates the
/// Character + Item transfer policies, and offers factories for a configured World, a resource ItemTemplate, and a
/// kiosk-locked Character. Everything downstream (join / search / gather) exercises the REAL value paths against
/// this world.
#[test_only]
module aresrpg::test_world;

use aresrpg::{admin::{Self, AdminCap, Self as catalog, Catalog}, character::Self as character, character_link, config::{Self as config, GameConfig}, equipment, extension, extract, item::{Self as item, Item, ItemTemplate}, item_stats, pet, scribe, version::{Self, Version}, world::{Self as world, World}};
use kiosk::personal_kiosk::{Self, PersonalKioskCap};
use sui::{
  kiosk::{Self, Kiosk},
  package::{Self, Publisher},
  test_scenario::{Self as ts, Scenario},
  transfer_policy::TransferPolicy
};

const OWNER: address = @0xA;

public fun owner(): address { OWNER }

// Resource-template + world constants the factories use (deterministic densities so spawn counts are exact).
const RES_RATE: u16 = 100;
const RES_QTY: u16 = 1; // a FARMER entry now spawns a 1-cell field (remaining=1) → node COUNT stays deterministic
// across the count-based suites; multi-cell FIELD growth is exercised by the dedicated cluster + world_math tests.
const MOB_RATE: u16 = 100;
const MOB_GROUP: u16 = 2;
const DENSITY: u16 = 2; // fixed min==max groups AND nodes → a search always targets exactly 2 of each

// ╔════════════════ [ Boot both packages, enable, deposit caps, make policies ] ═ ]

public fun boot(sc: &mut Scenario) {
  // S-46: ONE package, ONE Version, ONE AdminCap — the cap-deposit ceremony is DEAD (writes are public(package)
  // now). One super cap does the whole stand-up: enable the Version + GameConfig freeze, whitelist the resource.
  version::test_init(sc.ctx());
  admin::test_init(sc.ctx());
  config::test_init(sc.ctx());
  pet::test_init(sc.ctx());
  item::test_init(sc.ctx());
  character::test_init(sc.ctx());
  admin::test_init_catalog(sc.ctx());
  scribe::test_init(sc.ctx());

  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<AdminCap>();
  let mut ver = sc.take_shared<Version>();
  admin::admin_set_enabled(&cap, &mut ver, true, sc.ctx());
  let mut cfg = sc.take_shared<GameConfig>();
  config::set_enabled(&cap, &mut cfg, true, sc.ctx());
  let mut cat = sc.take_shared<Catalog>();
  admin::add_category(&cap, &mut cat, b"resource".to_string(), &ver, sc.ctx());

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
  ts::return_shared(cat);
  sc.return_to_sender(cap);
}

// ╔════════════════ [ Factories ] ════════════════════════════════════════════ ]

/// Author + share a stackable RESOURCE ItemTemplate (category "resource", level 1); returns its id.
public fun make_resource_template(sc: &mut Scenario): ID {
  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<AdminCap>();
  let cat = sc.take_shared<Catalog>();
  let ver = sc.take_shared<Version>();
  let tid = admin::create_template(
    &cap,
    &cat,
    b"Wheat".to_string(), b"A test artifact of the harness.".to_string(),
    b"wheat".to_string(),
    b"resource".to_string(),
    1,
    option::none(),
    option::none(),
    vector[],
    option::none(),
    &ver,
    sc.ctx(),
  );
  ts::return_shared(cat);
  ts::return_shared(ver);
  sc.return_to_sender(cap);
  tid
}

/// Author + share a NON-stackable GEAR ItemTemplate carrying authored [min,max] stat RANGES — the shape every
/// mint seam must roll (#758). `vitality` varies in [`min_vitality`, `max_vitality`]; every other field is
/// degenerate at `min_vitality`, so a rolled block is trivially checkable. `category` must be whitelisted and
/// non-stackable (`admin::create_template` rejects ranges on a stackable one).
public fun make_ranged_gear_template(sc: &mut Scenario, name: vector<u8>, category: vector<u8>, min_vitality: u16, max_vitality: u16): ID {
  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<AdminCap>();
  let cat = sc.take_shared<Catalog>();
  let ver = sc.take_shared<Version>();
  let f = min_vitality;
  let tid = admin::create_template(
    &cap, &cat, name.to_string(), b"A ranged test artifact of the harness.".to_string(), name.to_string(),
    category.to_string(), 1,
    option::some(item_stats::new(min_vitality, f, f, f, f, f, f, f, f, f, f, f, f, f, f, f, f)),
    option::some(item_stats::new(max_vitality, f, f, f, f, f, f, f, f, f, f, f, f, f, f, f, f)),
    vector[], option::none(), &ver, sc.ctx(),
  );
  ts::return_shared(cat);
  ts::return_shared(ver);
  sc.return_to_sender(cap);
  tid
}

/// The rolled block a `make_ranged_gear_template` item must carry, read off the kiosk-locked item — aborts if the
/// item never got a `StatsKey` (that IS the #758 regression: `has_rolled_stats` false ⇒ `rolled_stats` aborts).
public fun rolled_vitality(sc: &mut Scenario, who: address, kiosk_id: ID, item_id: ID): u16 {
  sc.next_tx(who);
  let k = ts::take_shared_by_id<Kiosk>(sc, kiosk_id);
  let pkcap = sc.take_from_sender<PersonalKioskCap>();
  let it = k.borrow<Item>(personal_kiosk::borrow(&pkcap), item_id);
  assert!(item_stats::has_rolled_stats(it), 0);
  let v = item_stats::vitality(item_stats::rolled_stats(it));
  ts::return_shared(k);
  sc.return_to_sender(pkcap);
  v
}

/// Whitelist a category on the items catalog (craft/pet/rune suites author their own categories).
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

/// Author + share a generic ItemTemplate (no stat ranges) of `category` at `level`; returns its id. `category`
/// must already be whitelisted. A stackable category (resource/consumable) rides the `y54` door; every
/// other category is a unique NFT.
public fun make_template(sc: &mut Scenario, name: vector<u8>, item_type: vector<u8>, category: vector<u8>, level: u16): ID {
  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<AdminCap>();
  let cat = sc.take_shared<Catalog>();
  let ver = sc.take_shared<Version>();
  let tid = admin::create_template(
    &cap, &cat, name.to_string(), b"A test artifact of the harness.".to_string(), item_type.to_string(), category.to_string(), level,
    option::none(), option::none(), vector[], option::none(), &ver, sc.ctx(),
  );
  ts::return_shared(cat);
  ts::return_shared(ver);
  sc.return_to_sender(cap);
  tid
}

/// Mint a STACKABLE item of `quantity` units from `template_id` and LOCK it into `who`'s shared personal kiosk
/// (mirrors the real gather/craft mint+lock). Returns the item id.
public fun mint_lock_stack(sc: &mut Scenario, who: address, template_id: ID, quantity: u64): ID {
  sc.next_tx(who);
  let tmpl = ts::take_shared_by_id<ItemTemplate>(sc, template_id);
  let ver = sc.take_shared<Version>();
  let mkt = sc.take_shared<TransferPolicy<Item>>();
  let mut k = sc.take_shared<Kiosk>();
  let pkcap = sc.take_from_sender<PersonalKioskCap>();
  let (it, pledge) = extension::y30(&tmpl, quantity, &ver, sc.ctx());
  let iid = object::id(&it);
  item::lock_in_kiosk(pledge, it, &mut k, personal_kiosk::borrow(&pkcap), &mkt);
  ts::return_shared(tmpl); ts::return_shared(ver); ts::return_shared(mkt); ts::return_shared(k); sc.return_to_sender(pkcap);
  iid
}

/// Mint a NON-stackable (gear) item from `template_id` and LOCK it into `who`'s shared personal kiosk. Returns id.
public fun mint_lock_gear(sc: &mut Scenario, who: address, template_id: ID): ID {
  sc.next_tx(who);
  let tmpl = ts::take_shared_by_id<ItemTemplate>(sc, template_id);
  let ver = sc.take_shared<Version>();
  let mkt = sc.take_shared<TransferPolicy<Item>>();
  let mut k = sc.take_shared<Kiosk>();
  let pkcap = sc.take_from_sender<PersonalKioskCap>();
  let (it, pledge) = extension::y29(&tmpl, option::none(), &ver, sc.ctx());
  let iid = object::id(&it);
  item::lock_in_kiosk(pledge, it, &mut k, personal_kiosk::borrow(&pkcap), &mkt);
  ts::return_shared(tmpl); ts::return_shared(ver); ts::return_shared(mkt); ts::return_shared(k); sc.return_to_sender(pkcap);
  iid
}

/// Mint a RAW item from `template_id` and attach it onto `who`'s character `cid` as an EQUIPPED item DF (bypasses
/// the extract→equip ceremony). Returns the item id — the pet-feed / scribe suites drive the in-place mutators.
public fun equip_item(sc: &mut Scenario, who: address, cid: ID, template_id: ID): ID {
  sc.next_tx(who);
  let tmpl = ts::take_shared_by_id<ItemTemplate>(sc, template_id);
  let ver = sc.take_shared<Version>();
  let mut k = sc.take_shared<Kiosk>();
  let pkcap = sc.take_from_sender<PersonalKioskCap>();
  let it = item::mint_for_testing(&tmpl, sc.ctx());
  let iid = object::id(&it);
  {
    let chr = k.borrow_mut(personal_kiosk::borrow(&pkcap), cid);
    equipment::attach_item_for_testing(chr, it, &ver);
  };
  ts::return_shared(tmpl); ts::return_shared(ver); ts::return_shared(k); sc.return_to_sender(pkcap);
  iid
}

/// Bank `xp` job experience for `job` on `who`'s character `cid` (drives the rune scribe job-70 gate).
public fun bank_job_xp(sc: &mut Scenario, who: address, cid: ID, job: u8, xp: u64) {
  sc.next_tx(who);
  let mut k = sc.take_shared<Kiosk>();
  let pkcap = sc.take_from_sender<PersonalKioskCap>();
  let ver = sc.take_shared<Version>();
  {
    let chr = k.borrow_mut(personal_kiosk::borrow(&pkcap), cid);
    character_link::y3(chr, job, xp, &ver);
  };
  ts::return_shared(k); sc.return_to_sender(pkcap); ts::return_shared(ver);
}

/// Create + share a World seeded with ONE resource entry (given `job`/`tier`) and ONE mob entry, with fixed
/// deterministic density (2 groups + 2 nodes per search). Returns the world id. `required_level` stays 1.
public fun make_world(sc: &mut Scenario, resource_tid: ID, job: u8, tier: u8): ID {
  make_world_tuned(sc, resource_tid, job, tier, RES_QTY, DENSITY, DENSITY)
}

/// Like `make_world` but with a caller-chosen qty band (`min==max==qty`) and fixed density (`dn` nodes + `dg`
/// groups per search). The gather-CLUSTER and id-reservation suites need a controlled K-cell field and node/group
/// target; everything else routes through `make_world`.
public fun make_world_tuned(sc: &mut Scenario, resource_tid: ID, job: u8, tier: u8, qty: u16, dn: u16, dg: u16): ID {
  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<AdminCap>();
  let ver = sc.take_shared<Version>();
  let wid = world::create_world(&cap, &ver, 7, b"glacial".to_string(), sc.ctx());
  sc.next_tx(OWNER);
  let mut w = sc.take_shared<World>();
  world::set_density(&cap, &mut w, dg, dg, dn, dn, &ver, sc.ctx());
  world::add_resource_entry(&cap, &mut w, resource_tid, RES_RATE, qty, qty, job, tier, &ver, sc.ctx());
  world::add_mob_entry(&cap, &mut w, object::id_from_address(@0xB0B), MOB_RATE, MOB_GROUP, MOB_GROUP, &ver, sc.ctx());
  ts::return_shared(w);
  ts::return_shared(ver);
  sc.return_to_sender(cap);
  wid
}

/// Link a base resource template to its rare variant on the shared World (AdminCap-gated) — golden-gather setup.
public fun link_rare(sc: &mut Scenario, base_tid: ID, rare_tid: ID) {
  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<AdminCap>();
  let ver = sc.take_shared<Version>();
  let mut w = sc.take_shared<World>();
  world::set_rare_link(&cap, &mut w, base_tid, rare_tid, &ver, sc.ctx());
  ts::return_shared(w);
  ts::return_shared(ver);
  sc.return_to_sender(cap);
}

/// Set the world's required level (for the join level-gate test).
public fun set_required_level(sc: &mut Scenario, level: u16) {
  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<AdminCap>();
  let ver = sc.take_shared<Version>();
  let mut w = sc.take_shared<World>();
  world::set_required_level(&cap, &mut w, level, &ver, sc.ctx());
  ts::return_shared(w);
  ts::return_shared(ver);
  sc.return_to_sender(cap);
}

/// Mint a fresh Character (experience 0 → level 1) locked into a new PERSONAL kiosk owned by `who`. The kiosk is
/// shared; the wrapped cap is soulbound to `who`. Returns the character id.
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

/// Attach an equipment map to a locked character so the gather tool/pet gates pass (`tool_jobs` = the equipped
/// gathering tool's job; `pet` = mounted). Runs as `who` against the shared kiosk.
public fun equip(sc: &mut Scenario, who: address, cid: ID, tool_jobs: vector<u8>, pet: bool) {
  sc.next_tx(who);
  let mut k = sc.take_shared<Kiosk>();
  let pkcap = sc.take_from_sender<PersonalKioskCap>();
  let ver = sc.take_shared<Version>();
  {
    let chr = k.borrow_mut(personal_kiosk::borrow(&pkcap), cid);
    equipment::attach_map_for_testing(chr, tool_jobs, pet, &ver);
  };
  ts::return_shared(k);
  ts::return_shared(ver);
  sc.return_to_sender(pkcap);
}
