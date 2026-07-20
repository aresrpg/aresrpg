// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// KOLIZEUM engine-bridge e2e — the fight-composition surface the money-core unit suite punts here. Stands up the
/// core half (koli_world) + the branded fight engine and drives the REAL own-branded bridge: `start` (creator
/// commits the lobby to a `KolizeumBrand` PvP `Fight` on the generic engine) → `seat` (a member self-seats via
/// the branded `engine::join`) → `settle` (release the pot off a branded outcome) → `open` (the outcome terminal:
/// brand-asserted consume). Plus the adversary: a FOREIGN-branded outcome is refused at `open` (the PvM-outcome
/// shredder guard). This is the moved-and-rebased half of core's old `dungeon_engine_tests` kolizeum section
/// (package-split 2026-07-11).
#[test_only]
module aresrpg_kolizeum::kolizeum_engine_tests;

use aresrpg::{character::Character, config::GameConfig, version::Version};
use aresrpg_fight::{
  admin as eadmin,
  fight::{Self as engine, Fight},
  fight_registry::{Self, FightRegistry},
  settlement,
  version::{Self as eversion, Version as EVersion}
};
use aresrpg_kolizeum::{koli_world, kolizeum::{Self, Kolizeum}};
use kiosk::personal_kiosk::{Self, PersonalKioskCap};
use std::type_name;
use sui::{clock, coin, kiosk::Kiosk, sui::SUI, test_scenario::{Self as ts, Scenario}};

const PLEDGE: u64 = 1_000;
const JOINER: address = @0xB1;

// ── mirrored error values (`location` disambiguates the aborting module) ──
const EWrongOutcomeBrand: u64 = 117; // kolizeum::open

/// Boot the ENGINE half: registry + version + admin, engine Version flipped live.
fun boot_engine(sc: &mut Scenario) {
  sc.next_tx(koli_world::owner());
  fight_registry::test_init(sc.ctx());
  eversion::test_init(sc.ctx());
  eadmin::test_init(sc.ctx());
  sc.next_tx(koli_world::owner());
  let ecap = sc.take_from_sender<eadmin::AdminCap>();
  let mut ever = sc.take_shared<EVersion>();
  eadmin::admin_set_enabled(&ecap, &mut ever, true, sc.ctx());
  ts::return_shared(ever);
  sc.return_to_sender(ecap);
}

/// The most-recently-shared personal kiosk id (mint_character shares it immediately before this).
fun last_kiosk_id(): ID { ts::most_recent_id_shared<Kiosk>().destroy_some() }

#[test]
/// A 1v1 lobby end to end: `create_public` → `join` → `start` (the creator commits the lobby to an OWN-BRANDED
/// PvP `Fight` on the generic engine) → `seat` (the member self-seats via the branded join) → `settle` (release
/// the pot off a branded side-A-wins outcome) → `open` (the outcome terminal consumes it). Drives core's public
/// `combat_snapshot`/`dial_snapshot` factories and the lobby board derivation (`board_anchor`, `u32_at`).
fun kolizeum_start_seat_settle_open() {
  let mut sc = ts::begin(koli_world::owner());
  koli_world::boot(&mut sc);
  boot_engine(&mut sc);
  koli_world::open_gate(&mut sc);

  let creator_cid = koli_world::mint_character(&mut sc, koli_world::owner());
  sc.next_tx(koli_world::owner());
  let creator_kid = last_kiosk_id();
  let joiner_cid = koli_world::mint_character(&mut sc, JOINER);
  sc.next_tx(JOINER);
  let joiner_kid = last_kiosk_id();

  // CREATE public 1v1 lobby (creator level read off the real character)
  sc.next_tx(koli_world::owner());
  {
    let k = ts::take_shared_by_id<Kiosk>(&sc, creator_kid);
    let pkcap = sc.take_from_sender<PersonalKioskCap>();
    let cfg = sc.take_shared<GameConfig>();
    let ver = sc.take_shared<Version>();
    let pay = coin::mint_for_testing<SUI>(PLEDGE, sc.ctx());
    let chr = k.borrow<Character>(personal_kiosk::borrow(&pkcap), creator_cid);
    kolizeum::create_public(&cfg, 1, PLEDGE, 100, chr, pay, &ver, sc.ctx());
    ts::return_shared(k); sc.return_to_sender(pkcap); ts::return_shared(cfg); ts::return_shared(ver);
  };

  // JOIN (the second player's level read off THEIR character)
  sc.next_tx(JOINER);
  {
    let mut lobby = sc.take_shared<Kolizeum>();
    let k = ts::take_shared_by_id<Kiosk>(&sc, joiner_kid);
    let pkcap = sc.take_from_sender<PersonalKioskCap>();
    let cfg = sc.take_shared<GameConfig>();
    let ver = sc.take_shared<Version>();
    let pay = coin::mint_for_testing<SUI>(PLEDGE, sc.ctx());
    let jc = k.borrow<Character>(personal_kiosk::borrow(&pkcap), joiner_cid);
    kolizeum::join(&mut lobby, jc, pay, &cfg, &ver, sc.ctx());
    ts::return_shared(lobby); ts::return_shared(k); sc.return_to_sender(pkcap); ts::return_shared(cfg); ts::return_shared(ver);
  };

  // START — creator commits the lobby to an OWN-BRANDED PvP fight (shared)
  sc.next_tx(koli_world::owner());
  {
    let mut lobby = sc.take_shared<Kolizeum>();
    let mut reg = sc.take_shared<FightRegistry>();
    let k = ts::take_shared_by_id<Kiosk>(&sc, creator_kid);
    let pkcap = sc.take_from_sender<PersonalKioskCap>();
    let cfg = sc.take_shared<GameConfig>();
    let ver = sc.take_shared<Version>();
    let ever = sc.take_shared<EVersion>();
    let mut clk = clock::create_for_testing(sc.ctx());
    clk.set_for_testing(1000);
    kolizeum::start(&mut lobby, &mut reg, &k, &pkcap, creator_cid, vector[], &cfg, &ver, &ever, &clk, sc.ctx());
    clk.destroy_for_testing();
    ts::return_shared(lobby); ts::return_shared(reg); ts::return_shared(k); sc.return_to_sender(pkcap);
    ts::return_shared(cfg); ts::return_shared(ver); ts::return_shared(ever);
  };

  // SEAT — the member self-seats into the started fight on their side (the branded engine join)
  sc.next_tx(JOINER);
  {
    let lobby = sc.take_shared<Kolizeum>();
    let mut f = sc.take_shared<Fight>();
    let mut reg = sc.take_shared<FightRegistry>();
    let k = ts::take_shared_by_id<Kiosk>(&sc, joiner_kid);
    let pkcap = sc.take_from_sender<PersonalKioskCap>();
    let cfg = sc.take_shared<GameConfig>();
    let ver = sc.take_shared<Version>();
    let ever = sc.take_shared<EVersion>();
    let mut clk = clock::create_for_testing(sc.ctx());
    clk.set_for_testing(1000);
    kolizeum::seat(&lobby, &mut f, &mut reg, &k, &pkcap, joiner_cid, vector[], &cfg, &ver, &ever, &clk, sc.ctx());
    clk.destroy_for_testing();
    ts::return_shared(lobby); ts::return_shared(f); ts::return_shared(reg); ts::return_shared(k); sc.return_to_sender(pkcap);
    ts::return_shared(cfg); ts::return_shared(ver); ts::return_shared(ever);
  };

  // SETTLE off a branded side-A-wins outcome (fight id = the started fight), then OPEN it (the outcome terminal)
  sc.next_tx(koli_world::owner());
  {
    let mut lobby = sc.take_shared<Kolizeum>();
    let f = sc.take_shared<Fight>();
    let fight_id = object::id(&f);
    let ver = sc.take_shared<Version>();
    let outcome = settlement::outcome_for_testing(
      kolizeum::brand_type(), fight_id, object::id_from_address(@0x0), creator_cid,
      engine::status_victory(), 0, 0, 0, 0, 0, vector[], true, 0, option::some(0), 100, sc.ctx(),
    );
    kolizeum::settle(&mut lobby, &outcome, &ver, sc.ctx());
    kolizeum::open(outcome); // the brand-asserted terminal consumes it (storage rebate)
    assert!(kolizeum::pot_value(&lobby) == 0); // the pot fully distributed to the winning side
    ts::return_shared(lobby); ts::return_shared(f); ts::return_shared(ver);
  };
  sc.end();
}

#[test, expected_failure(abort_code = EWrongOutcomeBrand, location = kolizeum)]
/// The outcome terminal is NOT a universal shredder: a FOREIGN-branded outcome (e.g. a core PvM outcome, whose
/// consume must land xp/hp write-backs + clear the fight marker in core's results door) is REFUSED at `open`.
fun open_foreign_brand_refused() {
  let mut sc = ts::begin(koli_world::owner());
  let outcome = settlement::outcome_for_testing(
    type_name::with_defining_ids<Kolizeum>(), // any type that is NOT KolizeumBrand
    object::id_from_address(@0xF16), object::id_from_address(@0x0), object::id_from_address(@0xC0),
    2, 0, 0, 0, 0, 0, vector[], false, 0, option::some(0), 100, sc.ctx(),
  );
  kolizeum::open(outcome); // EWrongOutcomeBrand
  abort
}

// ╔════════════════ [ REAL-DOOR abort matrix — start/seat gates against the live engine ] ═ ]

const ENotCreator: u64 = 111; // kolizeum
const ENotParticipant: u64 = 110; // kolizeum
const ENotStarted: u64 = 112; // kolizeum
const EWrongFight: u64 = 116; // kolizeum

/// Boot world+engine+gate, mint a creator character + kiosk, create a PUBLIC 1v1 lobby. Returns (creator_cid, creator_kid).
fun lobby_up(sc: &mut Scenario): (ID, ID) {
  koli_world::boot(sc);
  boot_engine(sc);
  koli_world::open_gate(sc);
  let creator_cid = koli_world::mint_character(sc, koli_world::owner());
  sc.next_tx(koli_world::owner());
  let creator_kid = last_kiosk_id();
  sc.next_tx(koli_world::owner());
  {
    let k = ts::take_shared_by_id<Kiosk>(sc, creator_kid);
    let pkcap = sc.take_from_sender<PersonalKioskCap>();
    let cfg = sc.take_shared<GameConfig>();
    let ver = sc.take_shared<Version>();
    let pay = coin::mint_for_testing<SUI>(PLEDGE, sc.ctx());
    let chr = k.borrow<Character>(personal_kiosk::borrow(&pkcap), creator_cid);
    kolizeum::create_public(&cfg, 1, PLEDGE, 100, chr, pay, &ver, sc.ctx());
    ts::return_shared(k); sc.return_to_sender(pkcap); ts::return_shared(cfg); ts::return_shared(ver);
  };
  (creator_cid, creator_kid)
}

/// Drive the REAL `start` as `who` with `character_id` (helper for the abort matrix; the happy path is above).
fun do_start(sc: &mut Scenario, who: address, kid: ID, character_id: ID) {
  sc.next_tx(who);
  let mut lobby = sc.take_shared<Kolizeum>();
  let mut reg = sc.take_shared<FightRegistry>();
  let k = ts::take_shared_by_id<Kiosk>(sc, kid);
  let pkcap = sc.take_from_sender<PersonalKioskCap>();
  let cfg = sc.take_shared<GameConfig>();
  let ver = sc.take_shared<Version>();
  let ever = sc.take_shared<EVersion>();
  let mut clk = clock::create_for_testing(sc.ctx());
  clk.set_for_testing(1000);
  kolizeum::start(&mut lobby, &mut reg, &k, &pkcap, character_id, vector[], &cfg, &ver, &ever, &clk, sc.ctx());
  clk.destroy_for_testing();
  ts::return_shared(lobby); ts::return_shared(reg); ts::return_shared(k); sc.return_to_sender(pkcap);
  ts::return_shared(cfg); ts::return_shared(ver); ts::return_shared(ever);
}

#[test, expected_failure(abort_code = ENotCreator, location = kolizeum)]
/// Only the CREATOR may start: a joiner (member, side B) driving the real `start` is refused.
fun start_by_non_creator_refused() {
  let mut sc = ts::begin(koli_world::owner());
  let (_creator_cid, _ckid) = lobby_up(&mut sc);
  let joiner_cid = koli_world::mint_character(&mut sc, JOINER);
  sc.next_tx(JOINER);
  let joiner_kid = last_kiosk_id();
  sc.next_tx(JOINER);
  {
    let mut lobby = sc.take_shared<Kolizeum>();
    let k = ts::take_shared_by_id<Kiosk>(&sc, joiner_kid);
    let pkcap = sc.take_from_sender<PersonalKioskCap>();
    let cfg = sc.take_shared<GameConfig>();
    let ver = sc.take_shared<Version>();
    let pay = coin::mint_for_testing<SUI>(PLEDGE, sc.ctx());
    let jc = k.borrow<Character>(personal_kiosk::borrow(&pkcap), joiner_cid);
    kolizeum::join(&mut lobby, jc, pay, &cfg, &ver, sc.ctx());
    ts::return_shared(lobby); ts::return_shared(k); sc.return_to_sender(pkcap); ts::return_shared(cfg); ts::return_shared(ver);
  };
  do_start(&mut sc, JOINER, joiner_kid, joiner_cid); // ENotCreator
  abort
}

#[test, expected_failure(abort_code = ENotParticipant, location = kolizeum)]
/// The creator must field their REGISTERED lobby character: starting with a different (unregistered) character
/// they also own is refused.
fun start_with_unregistered_character_refused() {
  let mut sc = ts::begin(koli_world::owner());
  let (_creator_cid, _ckid) = lobby_up(&mut sc);
  let other_cid = koli_world::mint_character(&mut sc, koli_world::owner()); // a second character, never pledged
  sc.next_tx(koli_world::owner());
  let other_kid = last_kiosk_id();
  do_start(&mut sc, koli_world::owner(), other_kid, other_cid); // ENotParticipant
  abort
}

#[test, expected_failure(abort_code = ENotStarted, location = kolizeum)]
/// `seat` refuses an OPEN (never-started) lobby even when a real Fight object is at hand (borrowed from a
/// SECOND, started lobby): the status gate fires before any fight binding is read.
fun seat_on_open_lobby_refused() {
  let mut sc = ts::begin(koli_world::owner());
  let (creator_cid, creator_kid) = lobby_up(&mut sc); // lobby A (stays OPEN)
  sc.next_tx(koli_world::owner());
  let lobby_a_id = ts::most_recent_id_shared<Kolizeum>().destroy_some(); // captured BEFORE lobby B exists
  // a started fight needs its own lobby: make B with a SECOND character, start it, then aim its Fight at A.
  let b_cid = koli_world::mint_character(&mut sc, koli_world::owner());
  sc.next_tx(koli_world::owner());
  let b_kid = last_kiosk_id();
  sc.next_tx(koli_world::owner());
  {
    let cfg = sc.take_shared<GameConfig>();
    let ver = sc.take_shared<Version>();
    let pay = coin::mint_for_testing<SUI>(PLEDGE, sc.ctx());
    let k = ts::take_shared_by_id<Kiosk>(&sc, b_kid);
    let pkcap = sc.take_from_sender<PersonalKioskCap>();
    let chr = k.borrow<Character>(personal_kiosk::borrow(&pkcap), b_cid);
    kolizeum::create_public(&cfg, 1, PLEDGE, 100, chr, pay, &ver, sc.ctx());
    ts::return_shared(cfg); ts::return_shared(ver); ts::return_shared(k); sc.return_to_sender(pkcap);
  };
  // start lobby B (the most-recently-shared Kolizeum) → its Fight shares
  sc.next_tx(koli_world::owner());
  let lobby_b_id = ts::most_recent_id_shared<Kolizeum>().destroy_some();
  {
    let mut lobby = ts::take_shared_by_id<Kolizeum>(&sc, lobby_b_id);
    let mut reg = sc.take_shared<FightRegistry>();
    let k = ts::take_shared_by_id<Kiosk>(&sc, b_kid);
    let pkcap = sc.take_from_sender<PersonalKioskCap>();
    let cfg = sc.take_shared<GameConfig>();
    let ver = sc.take_shared<Version>();
    let ever = sc.take_shared<EVersion>();
    let mut clk = clock::create_for_testing(sc.ctx());
    clk.set_for_testing(1000);
    kolizeum::start(&mut lobby, &mut reg, &k, &pkcap, b_cid, vector[], &cfg, &ver, &ever, &clk, sc.ctx());
    clk.destroy_for_testing();
    ts::return_shared(lobby); ts::return_shared(reg); ts::return_shared(k); sc.return_to_sender(pkcap);
    ts::return_shared(cfg); ts::return_shared(ver); ts::return_shared(ever);
  };
  // aim lobby B's Fight at the OPEN lobby A → ENotStarted
  sc.next_tx(koli_world::owner());
  {
    let lobby_a = ts::take_shared_by_id<Kolizeum>(&sc, lobby_a_id);
    let mut f = sc.take_shared<Fight>();
    let mut reg = sc.take_shared<FightRegistry>();
    let k = ts::take_shared_by_id<Kiosk>(&sc, creator_kid);
    let pkcap = sc.take_from_sender<PersonalKioskCap>();
    let cfg = sc.take_shared<GameConfig>();
    let ver = sc.take_shared<Version>();
    let ever = sc.take_shared<EVersion>();
    let mut clk = clock::create_for_testing(sc.ctx());
    clk.set_for_testing(1000);
    kolizeum::seat(&lobby_a, &mut f, &mut reg, &k, &pkcap, creator_cid, vector[], &cfg, &ver, &ever, &clk, sc.ctx()); // ENotStarted
    abort 0
  }
}

/// Start the given lobby as `who` fielding `character_id` (kiosk `kid`), returning the spawned Fight's id.
fun start_lobby(sc: &mut Scenario, lobby_id: ID, who: address, kid: ID, character_id: ID): ID {
  sc.next_tx(who);
  {
    let mut lobby = ts::take_shared_by_id<Kolizeum>(sc, lobby_id);
    let mut reg = sc.take_shared<FightRegistry>();
    let k = ts::take_shared_by_id<Kiosk>(sc, kid);
    let pkcap = sc.take_from_sender<PersonalKioskCap>();
    let cfg = sc.take_shared<GameConfig>();
    let ver = sc.take_shared<Version>();
    let ever = sc.take_shared<EVersion>();
    let mut clk = clock::create_for_testing(sc.ctx());
    clk.set_for_testing(1000);
    kolizeum::start(&mut lobby, &mut reg, &k, &pkcap, character_id, vector[], &cfg, &ver, &ever, &clk, sc.ctx());
    clk.destroy_for_testing();
    ts::return_shared(lobby); ts::return_shared(reg); ts::return_shared(k); sc.return_to_sender(pkcap);
    ts::return_shared(cfg); ts::return_shared(ver); ts::return_shared(ever);
  };
  sc.next_tx(who);
  ts::most_recent_id_shared<Fight>().destroy_some()
}

/// Drive the REAL `seat` on (lobby, fight) as `who` with `character_id` off kiosk `kid` (abort-matrix helper).
fun do_seat(sc: &mut Scenario, lobby_id: ID, fight_id: ID, who: address, kid: ID, character_id: ID) {
  sc.next_tx(who);
  let lobby = ts::take_shared_by_id<Kolizeum>(sc, lobby_id);
  let mut f = ts::take_shared_by_id<Fight>(sc, fight_id);
  let mut reg = sc.take_shared<FightRegistry>();
  let k = ts::take_shared_by_id<Kiosk>(sc, kid);
  let pkcap = sc.take_from_sender<PersonalKioskCap>();
  let cfg = sc.take_shared<GameConfig>();
  let ver = sc.take_shared<Version>();
  let ever = sc.take_shared<EVersion>();
  let mut clk = clock::create_for_testing(sc.ctx());
  clk.set_for_testing(1000);
  kolizeum::seat(&lobby, &mut f, &mut reg, &k, &pkcap, character_id, vector[], &cfg, &ver, &ever, &clk, sc.ctx());
  clk.destroy_for_testing();
  ts::return_shared(lobby); ts::return_shared(f); ts::return_shared(reg); ts::return_shared(k); sc.return_to_sender(pkcap);
  ts::return_shared(cfg); ts::return_shared(ver); ts::return_shared(ever);
}

#[test, expected_failure(abort_code = EWrongFight, location = kolizeum)]
/// Anti cross-settle at the SEAT: a member cannot seat into a DIFFERENT lobby's fight — lobby A refuses lobby B's
/// Fight (both STARTED, so only the fight-binding assert can fire).
fun seat_wrong_fight_refused() {
  let mut sc = ts::begin(koli_world::owner());
  let (a_cid, a_kid) = lobby_up(&mut sc); // lobby A
  sc.next_tx(koli_world::owner());
  let lobby_a_id = ts::most_recent_id_shared<Kolizeum>().destroy_some();
  let _fight_a = start_lobby(&mut sc, lobby_a_id, koli_world::owner(), a_kid, a_cid);

  // lobby B (second character, same owner) — started, its own fight
  let b_cid = koli_world::mint_character(&mut sc, koli_world::owner());
  sc.next_tx(koli_world::owner());
  let b_kid = last_kiosk_id();
  sc.next_tx(koli_world::owner());
  {
    let cfg = sc.take_shared<GameConfig>();
    let ver = sc.take_shared<Version>();
    let pay = coin::mint_for_testing<SUI>(PLEDGE, sc.ctx());
    let k = ts::take_shared_by_id<Kiosk>(&sc, b_kid);
    let pkcap = sc.take_from_sender<PersonalKioskCap>();
    let chr = k.borrow<Character>(personal_kiosk::borrow(&pkcap), b_cid);
    kolizeum::create_public(&cfg, 1, PLEDGE, 100, chr, pay, &ver, sc.ctx());
    ts::return_shared(cfg); ts::return_shared(ver); ts::return_shared(k); sc.return_to_sender(pkcap);
  };
  sc.next_tx(koli_world::owner());
  let lobby_b_id = ts::most_recent_id_shared<Kolizeum>().destroy_some();
  let fight_b = start_lobby(&mut sc, lobby_b_id, koli_world::owner(), b_kid, b_cid);

  do_seat(&mut sc, lobby_a_id, fight_b, koli_world::owner(), a_kid, a_cid); // EWrongFight
  abort
}

#[test, expected_failure(abort_code = ENotParticipant, location = kolizeum)]
/// A STRANGER (never pledged) cannot seat into a started lobby's fight — the membership gate refuses before any
/// engine join (the anti-hired-gun wall's lobby half; the engine's brand assert is the other half).
fun seat_stranger_refused() {
  let mut sc = ts::begin(koli_world::owner());
  let (a_cid, a_kid) = lobby_up(&mut sc);
  sc.next_tx(koli_world::owner());
  let lobby_a_id = ts::most_recent_id_shared<Kolizeum>().destroy_some();
  let fight_a = start_lobby(&mut sc, lobby_a_id, koli_world::owner(), a_kid, a_cid);

  let stranger_cid = koli_world::mint_character(&mut sc, JOINER); // owns a character, never pledged
  sc.next_tx(JOINER);
  let stranger_kid = last_kiosk_id();
  do_seat(&mut sc, lobby_a_id, fight_a, JOINER, stranger_kid, stranger_cid); // ENotParticipant
  abort
}

#[test, expected_failure(abort_code = EWrongFight, location = kolizeum)]
/// The fight-binding assert's SHORT-CIRCUIT arm: a STARTED lobby with NO bound fight (reachable only through the
/// test door — production `start` always binds before flipping) refuses every seat (`fight_id.is_none()` →
/// EWrongFight before the id compare). Borrow a real Fight from a second, properly-started lobby.
fun seat_unbound_lobby_refused() {
  let mut sc = ts::begin(koli_world::owner());
  let (a_cid, a_kid) = lobby_up(&mut sc); // lobby A
  sc.next_tx(koli_world::owner());
  let lobby_a_id = ts::most_recent_id_shared<Kolizeum>().destroy_some();
  // flip A STARTED via the test door — fight_id stays NONE (the unbound state under test)
  sc.next_tx(koli_world::owner());
  {
    let mut lobby = ts::take_shared_by_id<Kolizeum>(&sc, lobby_a_id);
    kolizeum::start_for_testing(&mut lobby);
    ts::return_shared(lobby);
  };
  // lobby B (second character) started properly — donates the real Fight object
  let b_cid = koli_world::mint_character(&mut sc, koli_world::owner());
  sc.next_tx(koli_world::owner());
  let b_kid = last_kiosk_id();
  sc.next_tx(koli_world::owner());
  {
    let cfg = sc.take_shared<GameConfig>();
    let ver = sc.take_shared<Version>();
    let pay = coin::mint_for_testing<SUI>(PLEDGE, sc.ctx());
    let k = ts::take_shared_by_id<Kiosk>(&sc, b_kid);
    let pkcap = sc.take_from_sender<PersonalKioskCap>();
    let chr = k.borrow<Character>(personal_kiosk::borrow(&pkcap), b_cid);
    kolizeum::create_public(&cfg, 1, PLEDGE, 100, chr, pay, &ver, sc.ctx());
    ts::return_shared(cfg); ts::return_shared(ver); ts::return_shared(k); sc.return_to_sender(pkcap);
  };
  sc.next_tx(koli_world::owner());
  let lobby_b_id = ts::most_recent_id_shared<Kolizeum>().destroy_some();
  let fight_b = start_lobby(&mut sc, lobby_b_id, koli_world::owner(), b_kid, b_cid);

  do_seat(&mut sc, lobby_a_id, fight_b, koli_world::owner(), a_kid, a_cid); // EWrongFight (unbound arm)
  abort
}
