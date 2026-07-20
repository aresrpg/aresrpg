// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// DUNGEON tests — the COMPOSITION-LAYER surfaces the run-primitive suite (`run_tests`) does not reach:
///   • the ENTRY version gate (dark/stale) — the "no dungeon activates before launch / on a stale package" law
///     (activate's `config.assert_enabled` + `version.assert_enabled` proxy — activate itself needs a full world);
///   • the NEXT-FIGHT roster read (`dungeon::roster_for_room`) — the 1-based→0-indexed conversion + `EBadRoom(0)`.
/// Character-bound activation, abandon, settlement, and the fight bridge use the full world/kiosk harness in
/// `dungeon_engine_tests`; run lifecycle primitives are proven in `run_tests`.
#[test_only]
module aresrpg_dungeon::dungeon_tests;

use aresrpg::{admin::{Self, AdminCap}, version::{Self, Version}, world::{Self, World}};
use aresrpg_dungeon::dungeon;
use std::{string, unit_test::assert_eq};
use sui::test_scenario as ts;

const OWNER: address = @0xA;

// ── mirrored error values (`location = <module>` disambiguates which module aborted) ──
const V_EWrongVersion: u64 = 101; // version
const V_ENotEnabled: u64 = 102; // version
const D_EBadRoom: u64 = 105; // dungeon
fun mob_id(): ID { object::id_from_address(@0xB0B) }

// ╔════════════════ [ VERSION — the ENTRY gate (activate's assert_enabled proxy) ] ═ ]

#[test, expected_failure(abort_code = V_ENotEnabled, location = version)]
fun version_dark_rejects_entry() {
  let mut sc = ts::begin(OWNER);
  version::test_init(sc.ctx()); // ships DARK (enabled == false)
  sc.next_tx(OWNER);
  let ver = sc.take_shared<Version>();
  version::assert_enabled(&ver); // dark → no dungeon may be activated
  abort
}

#[test, expected_failure(abort_code = V_EWrongVersion, location = version)]
fun version_stale_rejects_entry() {
  let mut sc = ts::begin(OWNER);
  version::test_init(sc.ctx());
  sc.next_tx(OWNER);
  let mut ver = sc.take_shared<Version>();
  version::test_set_stale(&mut ver);
  version::assert_enabled(&ver); // stale → assert_latest fails first (outdated package version)
  abort
}

// ╔════════════════ [ ROSTER — NEXT FIGHT read: 1-based→0-indexed + EBadRoom(0) ] ═ ]

#[test]
fun roster_for_room_reads_current_room() {
  let mut sc = ts::begin(OWNER);
  admin::test_init(sc.ctx());
  version::test_init(sc.ctx());

  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<AdminCap>();
  let ver = sc.take_shared<Version>();
  let _ = world::create_world(&cap, &ver, 42, string::utf8(b"cave"), sc.ctx()); // dark game version is still latest
  ts::return_shared(ver);
  sc.return_to_sender(cap);

  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<AdminCap>();
  let ver = sc.take_shared<Version>();
  let mut w = sc.take_shared<World>();
  world::add_dungeon_room(&cap, &mut w, vector[mob_id()], &ver, sc.ctx()); // room 1's roster
  assert_eq!(dungeon::roster_for_room(&w, 1), vector[mob_id()]); // pass room 1 → reads dungeon_rooms[0]
  ts::return_shared(w);
  ts::return_shared(ver);
  sc.return_to_sender(cap);
  sc.end();
}

#[test, expected_failure(abort_code = D_EBadRoom, location = dungeon)]
fun roster_for_room_zero_room_aborts() {
  let mut sc = ts::begin(OWNER);
  admin::test_init(sc.ctx());
  version::test_init(sc.ctx());

  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<AdminCap>();
  let ver = sc.take_shared<Version>();
  let _ = world::create_world(&cap, &ver, 42, string::utf8(b"cave"), sc.ctx());
  ts::return_shared(ver);
  sc.return_to_sender(cap);

  sc.next_tx(OWNER);
  let w = sc.take_shared<World>();
  let _ = dungeon::roster_for_room(&w, 0); // the room counter is 1-based → room 0 is illegal
  abort
}

// NOTE (S-46 final split): the §9 same-room re-derivation tests need an engine FightRegistry fixture —
// dependency test_only doors are not compiled, so they ride the testnet e2e gate (house law).
