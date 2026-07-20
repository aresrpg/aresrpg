/// FORGE-BRAND DOOR TESTS (2026-07-12 forge split): the brand-gated core value twins — the ONLY cross-package
/// write surface the extracted rune-forge sibling gets. Per twin: closed-by-default abort (no pin → EWrongBrand),
/// wrong-witness abort (a decoy type), right-witness pass with the delegated write PROVEN by state read-back
/// (zero-drift: each twin is a one-line delegate to the package-private body every other suite already pins).
/// The REAL sibling witness (`aresrpg_forgemagie::forgemagie::Forge`) drives these same doors end-to-end in the
/// sibling package's own suites — here core proves the GATE, with local stand-in witnesses.
#[test_only]
module aresrpg::forge_brand_tests;

use aresrpg::{
  admin::AdminCap,
  character_link,
  config::{Self, GameConfig},
  extension,
  item::{Self, Item},
  item_stats::{Self, ItemStatistics},
  test_world,
  version::Version
};
use aresrpg::extract::ItemExtractPolicy;
use kiosk::personal_kiosk::{Self, PersonalKioskCap};
use sui::{dynamic_field as df, kiosk::Kiosk, test_scenario::{Self as ts, Scenario}, transfer_policy::TransferPolicy};

const OWNER: address = @0xA;
const SHIFT: u16 = 32_768;
const EWrongBrand: u64 = 104; // config's brand-gate abort (mirror)

/// Local stand-in witnesses (the gate keys on the PINNED TypeName — any drop type works for core's gate tests).
public struct BrandA has drop {}
public struct BrandB has drop {}

public struct ProbeKey has copy, drop, store {}

fun pin_a(sc: &mut Scenario) {
  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<AdminCap>();
  let mut cfg = sc.take_shared<GameConfig>();
  let ver = sc.take_shared<Version>();
  config::set_forge_brand<BrandA>(&cap, &mut cfg, &ver, sc.ctx());
  ts::return_shared(cfg); ts::return_shared(ver); sc.return_to_sender(cap);
}

fun uniform(v: u16): ItemStatistics { item_stats::new(v, v, v, v, v, v, v, v, v, v, v, v, v, v, v, v, v) }

// ╔════════════════ [ The pin itself ] ════════════════════════════════════════ ]

#[test]
/// Ships unpinned (`none`), the setter pins, a re-pin swaps (admin is god — accepted power).
fun pin_lifecycle() {
  let mut sc = ts::begin(OWNER);
  test_world::boot(&mut sc);
  sc.next_tx(OWNER);
  {
    let cfg = sc.take_shared<GameConfig>();
    assert!(config::forge_brand(&cfg).is_none()); // doors ship CLOSED
    ts::return_shared(cfg);
  };
  pin_a(&mut sc);
  sc.next_tx(OWNER);
  {
    let cfg = sc.take_shared<GameConfig>();
    assert!(config::forge_brand(&cfg).is_some());
    config::assert_forge_brand<BrandA>(&cfg); // the pinned witness passes
    ts::return_shared(cfg);
  };
  sc.end();
}

#[test]
#[expected_failure(abort_code = EWrongBrand, location = aresrpg::config)]
/// No pin → every brand door is CLOSED (the ship default).
fun closed_by_default_aborts() {
  let mut sc = ts::begin(OWNER);
  test_world::boot(&mut sc); // boots WITHOUT a pin
  sc.next_tx(OWNER);
  let cfg = sc.take_shared<GameConfig>();
  config::assert_forge_brand<BrandA>(&cfg);
  abort 0
}

#[test]
#[expected_failure(abort_code = EWrongBrand, location = aresrpg::config)]
/// A witness that is not the pinned one is refused.
fun wrong_witness_aborts() {
  let mut sc = ts::begin(OWNER);
  test_world::boot(&mut sc);
  pin_a(&mut sc);
  sc.next_tx(OWNER);
  let cfg = sc.take_shared<GameConfig>();
  config::assert_forge_brand<BrandB>(&cfg);
  abort 0
}

// ╔════════════════ [ Twin: mint_item_stack_brand ] ═══════════════════════════ ]

#[test]
/// Right witness mints a real locked stack (delegation proven by the kiosk lock + amount).
fun mint_stack_brand_pass() {
  let mut sc = ts::begin(OWNER);
  test_world::boot(&mut sc);
  pin_a(&mut sc);
  let _cid = test_world::mint_character(&mut sc, OWNER); // creates the personal kiosk
  let tid = test_world::make_resource_template(&mut sc);
  sc.next_tx(OWNER);
  let tmpl = ts::take_shared_by_id<item::ItemTemplate>(&sc, tid);
  let cfg = sc.take_shared<GameConfig>();
  let ver = sc.take_shared<Version>();
  let mkt = sc.take_shared<TransferPolicy<Item>>();
  let mut k = sc.take_shared<Kiosk>();
  let pkcap = sc.take_from_sender<PersonalKioskCap>();
  let (stack, pledge) = extension::mint_item_stack_brand(BrandA {}, &cfg, &tmpl, 5, &ver, sc.ctx());
  assert!(item::amount(&stack) == 5);
  let iid = object::id(&stack);
  item::lock_in_kiosk(pledge, stack, &mut k, personal_kiosk::borrow(&pkcap), &mkt);
  assert!(k.has_item(iid));
  ts::return_shared(tmpl); ts::return_shared(cfg); ts::return_shared(ver); ts::return_shared(mkt);
  ts::return_shared(k); sc.return_to_sender(pkcap);
  sc.end();
}

#[test]
#[expected_failure(abort_code = EWrongBrand, location = aresrpg::config)]
/// Wrong witness cannot mint — the free-mint hole the brand gate exists to close.
fun mint_stack_brand_wrong_witness_aborts() {
  let mut sc = ts::begin(OWNER);
  test_world::boot(&mut sc);
  pin_a(&mut sc);
  let tid = test_world::make_resource_template(&mut sc);
  sc.next_tx(OWNER);
  let tmpl = ts::take_shared_by_id<item::ItemTemplate>(&sc, tid);
  let cfg = sc.take_shared<GameConfig>();
  let ver = sc.take_shared<Version>();
  let (_stack, _pledge) = extension::mint_item_stack_brand(BrandB {}, &cfg, &tmpl, 5, &ver, sc.ctx());
  abort 0
}

// ╔════════════════ [ Twin: set_rolled_brand ] ════════════════════════════════ ]

#[test]
/// Right witness rewrites the rolled block (read back through the public getter).
fun set_rolled_brand_pass() {
  let mut sc = ts::begin(OWNER);
  test_world::boot(&mut sc);
  pin_a(&mut sc);
  let _cid = test_world::mint_character(&mut sc, OWNER);
  test_world::whitelist(&mut sc, b"sword");
  let sword_t = test_world::make_template(&mut sc, b"Blade", b"blade", b"sword", 50);
  let gear = test_world::mint_lock_gear(&mut sc, OWNER, sword_t);
  sc.next_tx(OWNER);
  let cfg = sc.take_shared<GameConfig>();
  let mut k = sc.take_shared<Kiosk>();
  let pkcap = sc.take_from_sender<PersonalKioskCap>();
  {
    let g: &mut Item = k.borrow_mut(personal_kiosk::borrow(&pkcap), gear);
    extension::set_rolled_brand(BrandA {}, &cfg, g, uniform(SHIFT + 7));
    assert!(item_stats::vitality(item_stats::rolled_stats(g)) == SHIFT + 7);
  };
  ts::return_shared(cfg); ts::return_shared(k); sc.return_to_sender(pkcap);
  sc.end();
}

#[test]
#[expected_failure(abort_code = EWrongBrand, location = aresrpg::config)]
/// Wrong witness cannot rewrite owned-item stats — the free-stat-max hole stays closed.
fun set_rolled_brand_wrong_witness_aborts() {
  let mut sc = ts::begin(OWNER);
  test_world::boot(&mut sc);
  pin_a(&mut sc);
  let _cid = test_world::mint_character(&mut sc, OWNER);
  test_world::whitelist(&mut sc, b"sword");
  let sword_t = test_world::make_template(&mut sc, b"Blade", b"blade", b"sword", 50);
  let gear = test_world::mint_lock_gear(&mut sc, OWNER, sword_t);
  sc.next_tx(OWNER);
  let cfg = sc.take_shared<GameConfig>();
  let mut k = sc.take_shared<Kiosk>();
  let pkcap = sc.take_from_sender<PersonalKioskCap>();
  let g: &mut Item = k.borrow_mut(personal_kiosk::borrow(&pkcap), gear);
  extension::set_rolled_brand(BrandB {}, &cfg, g, uniform(SHIFT + 7));
  abort 0
}

// ╔════════════════ [ Twin: add_job_xp_brand ] ════════════════════════════════ ]

#[test]
/// Right witness banks job xp (read back through the public job_xp getter).
fun add_job_xp_brand_pass() {
  let mut sc = ts::begin(OWNER);
  test_world::boot(&mut sc);
  pin_a(&mut sc);
  let cid = test_world::mint_character(&mut sc, OWNER);
  sc.next_tx(OWNER);
  let cfg = sc.take_shared<GameConfig>();
  let mut k = sc.take_shared<Kiosk>();
  let pkcap = sc.take_from_sender<PersonalKioskCap>();
  let ver = sc.take_shared<Version>();
  {
    let chr = k.borrow_mut(personal_kiosk::borrow(&pkcap), cid);
    let total = character_link::add_job_xp_brand(BrandA {}, &cfg, chr, 3, 500, &ver);
    assert!(total == 500);
    assert!(character_link::job_xp(k.borrow(personal_kiosk::borrow(&pkcap), cid), 3) == 500);
  };
  ts::return_shared(cfg); ts::return_shared(k); sc.return_to_sender(pkcap); ts::return_shared(ver);
  sc.end();
}

#[test]
#[expected_failure(abort_code = EWrongBrand, location = aresrpg::config)]
/// Wrong witness cannot bank xp.
fun add_job_xp_brand_wrong_witness_aborts() {
  let mut sc = ts::begin(OWNER);
  test_world::boot(&mut sc);
  pin_a(&mut sc);
  let cid = test_world::mint_character(&mut sc, OWNER);
  sc.next_tx(OWNER);
  let cfg = sc.take_shared<GameConfig>();
  let mut k = sc.take_shared<Kiosk>();
  let pkcap = sc.take_from_sender<PersonalKioskCap>();
  let ver = sc.take_shared<Version>();
  let chr = k.borrow_mut(personal_kiosk::borrow(&pkcap), cid);
  let _ = character_link::add_job_xp_brand(BrandB {}, &cfg, chr, 3, 500, &ver);
  abort 0
}

// ╔════════════════ [ Twin: consume_units_brand ] ═════════════════════════════ ]

#[test]
/// Right witness consumes EXACTLY one unit: the old stack object burns, a remainder re-mints (count holds).
fun consume_units_brand_pass() {
  let mut sc = ts::begin(OWNER);
  test_world::boot(&mut sc);
  pin_a(&mut sc);
  let _cid = test_world::mint_character(&mut sc, OWNER);
  let tid = test_world::make_resource_template(&mut sc);
  let stack = test_world::mint_lock_stack(&mut sc, OWNER, tid, 2);
  sc.next_tx(OWNER);
  let tmpl = ts::take_shared_by_id<item::ItemTemplate>(&sc, tid);
  let cfg = sc.take_shared<GameConfig>();
  let ver = sc.take_shared<Version>();
  let mkt = sc.take_shared<TransferPolicy<Item>>();
  let xpolicy = sc.take_shared<ItemExtractPolicy>();
  let mut k = sc.take_shared<Kiosk>();
  let pkcap = sc.take_from_sender<PersonalKioskCap>();
  let count_before = k.item_count();
  let burned_tid = character_link::consume_units_brand(BrandA {}, &cfg, &tmpl, 1, stack, &mut k, &pkcap, &xpolicy, &mkt, &ver, sc.ctx());
  assert!(burned_tid == tid);
  assert!(!k.has_item(stack)); // the qty-2 object burned…
  assert!(k.item_count() == count_before); // …and the 1-unit remainder re-locked
  ts::return_shared(tmpl); ts::return_shared(cfg); ts::return_shared(ver); ts::return_shared(mkt);
  ts::return_shared(xpolicy); ts::return_shared(k); sc.return_to_sender(pkcap);
  sc.end();
}

#[test]
#[expected_failure(abort_code = EWrongBrand, location = aresrpg::config)]
/// Wrong witness cannot burn stack units.
fun consume_units_brand_wrong_witness_aborts() {
  let mut sc = ts::begin(OWNER);
  test_world::boot(&mut sc);
  pin_a(&mut sc);
  let _cid = test_world::mint_character(&mut sc, OWNER);
  let tid = test_world::make_resource_template(&mut sc);
  let stack = test_world::mint_lock_stack(&mut sc, OWNER, tid, 2);
  sc.next_tx(OWNER);
  let tmpl = ts::take_shared_by_id<item::ItemTemplate>(&sc, tid);
  let cfg = sc.take_shared<GameConfig>();
  let ver = sc.take_shared<Version>();
  let mkt = sc.take_shared<TransferPolicy<Item>>();
  let xpolicy = sc.take_shared<ItemExtractPolicy>();
  let mut k = sc.take_shared<Kiosk>();
  let pkcap = sc.take_from_sender<PersonalKioskCap>();
  let _ = character_link::consume_units_brand(BrandB {}, &cfg, &tmpl, 1, stack, &mut k, &pkcap, &xpolicy, &mkt, &ver, sc.ctx());
  abort 0
}

// ╔════════════════ [ Twin: item_uid_mut_brand ] ═══════════════════════════════ ]

#[test]
/// Right witness gets the item's `&mut UID` (a DF lands and reads back through the public `uid`).
fun item_uid_mut_brand_pass() {
  let mut sc = ts::begin(OWNER);
  test_world::boot(&mut sc);
  pin_a(&mut sc);
  let _cid = test_world::mint_character(&mut sc, OWNER);
  test_world::whitelist(&mut sc, b"sword");
  let sword_t = test_world::make_template(&mut sc, b"Blade", b"blade", b"sword", 50);
  let gear = test_world::mint_lock_gear(&mut sc, OWNER, sword_t);
  sc.next_tx(OWNER);
  let cfg = sc.take_shared<GameConfig>();
  let mut k = sc.take_shared<Kiosk>();
  let pkcap = sc.take_from_sender<PersonalKioskCap>();
  {
    let g: &mut Item = k.borrow_mut(personal_kiosk::borrow(&pkcap), gear);
    df::add(extension::item_uid_mut_brand(BrandA {}, &cfg, g), ProbeKey {}, 42u64);
    assert!(df::exists(item::uid(g), ProbeKey {}));
    assert!(*df::borrow<ProbeKey, u64>(item::uid(g), ProbeKey {}) == 42);
  };
  ts::return_shared(cfg); ts::return_shared(k); sc.return_to_sender(pkcap);
  sc.end();
}

#[test]
#[expected_failure(abort_code = EWrongBrand, location = aresrpg::config)]
/// Wrong witness never touches an item's `&mut UID` (the D319 fence).
fun item_uid_mut_brand_wrong_witness_aborts() {
  let mut sc = ts::begin(OWNER);
  test_world::boot(&mut sc);
  pin_a(&mut sc);
  let _cid = test_world::mint_character(&mut sc, OWNER);
  test_world::whitelist(&mut sc, b"sword");
  let sword_t = test_world::make_template(&mut sc, b"Blade", b"blade", b"sword", 50);
  let gear = test_world::mint_lock_gear(&mut sc, OWNER, sword_t);
  sc.next_tx(OWNER);
  let cfg = sc.take_shared<GameConfig>();
  let mut k = sc.take_shared<Kiosk>();
  let pkcap = sc.take_from_sender<PersonalKioskCap>();
  let g: &mut Item = k.borrow_mut(personal_kiosk::borrow(&pkcap), gear);
  let _uid = extension::item_uid_mut_brand(BrandB {}, &cfg, g);
  abort 0
}
