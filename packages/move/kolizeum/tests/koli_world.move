/// Shared #[test_only] scaffold for the kolizeum suites — the CHARACTER-ONLY slice of core's `test_world` (that
/// module lives in the core package's tests/ directory, which a dependent package's test build cannot see; the
/// core #[test_only] SOURCE helpers — `config::test_init`, `character::new_for_testing`, … — remain available and
/// are exactly what this scaffold composes). Boots core's Version + AdminCap + GameConfig + the Character policy,
/// ENABLED, and mints kiosk-locked characters — everything the real-door and engine-bridge suites need.
#[test_only]
module aresrpg_kolizeum::koli_world;

use aresrpg::{
  admin::{Self, AdminCap},
  character,
  config::{Self, GameConfig},
  version::{Self, Version}
};
use kiosk::personal_kiosk;
use sui::{kiosk, package::Publisher, test_scenario::{Self as ts, Scenario}, transfer_policy::TransferPolicy};

const OWNER: address = @0xA;

public fun owner(): address { OWNER }

/// Stand up the CORE half this package composes over: Version + AdminCap + GameConfig + the Character transfer
/// policy — all ENABLED. Only `character::test_init` claims a Publisher here (no item half), so the single
/// Publisher is unambiguous. Lands on a fresh OWNER tx.
public fun boot(sc: &mut Scenario) {
  version::test_init(sc.ctx());
  admin::test_init(sc.ctx());
  config::test_init(sc.ctx());
  character::test_init(sc.ctx());

  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<AdminCap>();
  let mut ver = sc.take_shared<Version>();
  admin::admin_set_enabled(&cap, &mut ver, true, sc.ctx());
  let mut cfg = sc.take_shared<GameConfig>();
  config::set_enabled(&cap, &mut cfg, true, sc.ctx());

  let char_pub = sc.take_from_sender<Publisher>(); // character::test_init's claim — the only Publisher here
  let (cpolicy, cpolicy_cap) = character::create_character_policy(&char_pub, &ver, sc.ctx());
  transfer::public_share_object(cpolicy);
  transfer::public_transfer(cpolicy_cap, OWNER);
  transfer::public_transfer(char_pub, OWNER);

  ts::return_shared(ver);
  ts::return_shared(cfg);
  sc.return_to_sender(cap);
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

/// Lower the PvP-arena level gate to 1 (its minimum) so a fresh level-1 character clears the §17.30 gate.
public fun open_gate(sc: &mut Scenario) {
  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<AdminCap>();
  let mut cfg = sc.take_shared<GameConfig>();
  let ver = sc.take_shared<Version>();
  config::set_pvp_level_gate(&cap, &mut cfg, 1, &ver, sc.ctx());
  ts::return_shared(cfg); ts::return_shared(ver); sc.return_to_sender(cap);
}
