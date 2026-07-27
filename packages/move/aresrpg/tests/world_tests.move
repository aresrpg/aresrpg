// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// WORLD tests: template creation defaults, setter clamping (coercion not rejection), the well-formed-range
/// aborts, and the OVERFLOW-PROOF zone coordinate math at the interesting edges — zone 0, the max in-bounds edge,
/// out-of-bounds abort, and the default 500k×500k probe (§17.10 "no coordinate overflow, ever").
#[test_only]
module aresrpg::world_tests;

use aresrpg::{admin::{Self, AdminCap}, version::{Self, Version}, world::{Self, World}};
use std::unit_test::assert_eq;
use sui::test_scenario::{Self as ts, Scenario};

const OWNER: address = @0xA;
const TEMP: address = @0xB0B;

// ── mirrored error values (module-local; `location` disambiguates the aborting module) ──
const EOutOfBounds: u64 = 101; // world
const EBadEntryIndex: u64 = 102; // world (a row index past the table end — the boss mask's fail-closed guard)
const EBadRange: u64 = 103; // world
const EWorldNotEmpty: u64 = 104; // world (destroy_world refuses populated tables)
const V_EWrongVersion: u64 = 101; // version
const A_EAdminCapExpired: u64 = 101; // admin

// ╔════════════════ [ Harness ] ══════════════════════════════════════════════ ]

/// Stand up game version + admin (authoring works while DARK — create/setters gate on `assert_latest` only).
fun boot(sc: &mut Scenario) {
  version::test_init(sc.ctx());
  admin::test_init(sc.ctx());
}

fun make(sc: &mut Scenario): ID {
  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<AdminCap>();
  let ver = sc.take_shared<Version>();
  let wid = world::create_world(&cap, &ver, 42, b"glacial".to_string(), sc.ctx());
  ts::return_shared(ver);
  sc.return_to_sender(cap);
  wid
}

// ╔════════════════ [ P1-1 protector pin coverage (ProtectorKey DF door) ] ════ ]

#[test]
/// `resource_protector` (a `ProtectorKey → ID` DF, mirroring `set_mob_level`): pinned answers `some`, never-pinned
/// `none`, unknown template `none`; a re-pin OVERWRITES; `none` disarms; disarming a never-pinned template is a
/// safe no-op (the remove is `exists`-guarded).
fun resource_protector_reads_all_shapes() {
  let mut sc = ts::begin(OWNER);
  boot(&mut sc);
  let _wid = make(&mut sc);
  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<AdminCap>();
  let ver = sc.take_shared<Version>();
  let mut w = sc.take_shared<World>();
  let res_a = object::id_from_address(@0xA11CE);
  let res_b = object::id_from_address(@0xB0B);
  let guard = object::id_from_address(@0x6A);
  let guard2 = object::id_from_address(@0x6B);
  world::add_resource_entry(&cap, &mut w, res_a, 100, 1, 3, 0, 1, &ver, sc.ctx());
  world::add_resource_entry(&cap, &mut w, res_b, 100, 1, 3, 0, 1, &ver, sc.ctx());
  world::set_resource_protector(&cap, &mut w, res_b, option::some(guard), &ver, sc.ctx()); // pin
  assert!(world::resource_protector(&w, res_a).is_none()); // never pinned
  assert_eq!(*world::resource_protector(&w, res_b).borrow(), guard); // pinned
  assert!(world::resource_protector(&w, object::id_from_address(@0xDEAD)).is_none()); // unknown template
  world::set_resource_protector(&cap, &mut w, res_b, option::some(guard2), &ver, sc.ctx()); // re-pin OVERWRITES
  assert_eq!(*world::resource_protector(&w, res_b).borrow(), guard2);
  world::set_resource_protector(&cap, &mut w, res_b, option::none(), &ver, sc.ctx()); // disarm removes the DF
  assert!(world::resource_protector(&w, res_b).is_none());
  world::set_resource_protector(&cap, &mut w, res_a, option::none(), &ver, sc.ctx()); // disarm of never-pinned: no-op
  assert!(world::resource_protector(&w, res_a).is_none());
  ts::return_shared(w); ts::return_shared(ver); sc.return_to_sender(cap);
  sc.end();
}

// ╔════════════════ [ The BOSS MASK (#1110 — the mixed-pack fence's on-chain predicate) ] ═ ]

#[test]
/// The `BossMaskKey → vector<u16>` DF door end to end: absent reads EMPTY (the uniform degradation path a
/// dungeon-only-boss world also lands on), a write round-trips, a rewrite REPLACES wholesale (the mask is a
/// projection of the authored bestiary — a partial edit has no meaning), and an explicitly empty write is a
/// legal state indistinguishable from never having written one.
fun boss_mask_round_trips_and_absent_reads_empty() {
  let mut sc = ts::begin(OWNER);
  boot(&mut sc);
  let _wid = make(&mut sc);
  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<AdminCap>();
  let ver = sc.take_shared<Version>();
  let mut w = sc.take_shared<World>();
  assert_eq!(world::boss_mask(&w), vector<u16>[]); // never written — absent ≡ empty
  let mob = object::id_from_address(@0x60B);
  world::add_mob_entry(&cap, &mut w, mob, 100, 1, 4, &ver, sc.ctx()); // row 0
  world::add_mob_entry(&cap, &mut w, mob, 100, 1, 4, &ver, sc.ctx()); // row 1
  world::add_mob_entry(&cap, &mut w, mob, 100, 1, 4, &ver, sc.ctx()); // row 2
  world::set_boss_mask(&cap, &mut w, vector<u16>[2], &ver, sc.ctx());
  assert_eq!(world::boss_mask(&w), vector<u16>[2]);
  world::set_boss_mask(&cap, &mut w, vector<u16>[0, 2], &ver, sc.ctx()); // rewrite REPLACES
  assert_eq!(world::boss_mask(&w), vector<u16>[0, 2]);
  world::set_boss_mask(&cap, &mut w, vector<u16>[], &ver, sc.ctx()); // an empty mask is a legal state
  assert_eq!(world::boss_mask(&w), vector<u16>[]);
  ts::return_shared(w); ts::return_shared(ver); sc.return_to_sender(cap);
  sc.end();
}

#[test]
/// `clear_tables` retires the mask WITH the table it indexes. The mask is POSITIONAL, so a mask that outlives
/// its table names whatever species later lands on those rows — the exact silent mis-fence the wave exists to
/// prevent. (It also leaves nothing stranded on the UID for the two-step burn.)
fun clearing_the_tables_retires_the_boss_mask() {
  let mut sc = ts::begin(OWNER);
  boot(&mut sc);
  let _wid = make(&mut sc);
  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<AdminCap>();
  let ver = sc.take_shared<Version>();
  let mut w = sc.take_shared<World>();
  world::add_mob_entry(&cap, &mut w, object::id_from_address(@0x60B), 100, 1, 4, &ver, sc.ctx());
  world::set_boss_mask(&cap, &mut w, vector<u16>[0], &ver, sc.ctx());
  assert_eq!(world::boss_mask(&w), vector<u16>[0]);
  world::clear_tables(&cap, &mut w, &ver, sc.ctx());
  assert_eq!(world::boss_mask(&w), vector<u16>[]);
  world::clear_tables(&cap, &mut w, &ver, sc.ctx()); // idempotent — clearing a mask-less world is a no-op
  assert_eq!(world::boss_mask(&w), vector<u16>[]);
  ts::return_shared(w); ts::return_shared(ver); sc.return_to_sender(cap);
  sc.end();
}

#[test, expected_failure(abort_code = EBadEntryIndex, location = world)]
/// FAIL-CLOSED: a mask index past the live table end ABORTS. A stale mask (written against a table that has
/// since shrunk) would silently fence the wrong rows — and a fence that silently points at the wrong species is
/// worse than no fence, because it reads as armed.
fun a_boss_mask_row_past_the_table_end_aborts() {
  let mut sc = ts::begin(OWNER);
  boot(&mut sc);
  let _wid = make(&mut sc);
  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<AdminCap>();
  let ver = sc.take_shared<Version>();
  let mut w = sc.take_shared<World>();
  world::add_mob_entry(&cap, &mut w, object::id_from_address(@0x60B), 100, 1, 4, &ver, sc.ctx()); // one row: 0
  world::set_boss_mask(&cap, &mut w, vector<u16>[1], &ver, sc.ctx()); // row 1 does not exist
  abort
}

#[test, expected_failure(abort_code = EBadRange, location = world)]
/// `add_resource_entry` with max < min aborts (the range guard, param-add regression row).
fun add_resource_entry_bad_range_aborts() {
  let mut sc = ts::begin(OWNER);
  boot(&mut sc);
  let _wid = make(&mut sc);
  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<AdminCap>();
  let ver = sc.take_shared<Version>();
  let mut w = sc.take_shared<World>();
  world::add_resource_entry(&cap, &mut w, object::id_from_address(@0xA11CE), 100, 5, 2, 0, 1, &ver, sc.ctx());
  abort
}

// ╔════════════════ [ Defaults ] ═════════════════════════════════════════════ ]

#[test]
fun create_world_has_spec_defaults() {
  let mut sc = ts::begin(OWNER);
  boot(&mut sc);
  make(&mut sc);

  sc.next_tx(OWNER);
  let w = sc.take_shared<World>();
  assert_eq!(world::seed(&w), 42);
  assert_eq!(world::biome(&w), b"glacial".to_string());
  assert_eq!(world::required_level(&w), 1);
  assert_eq!(world::bounds_x(&w), 500_000);
  assert_eq!(world::bounds_z(&w), 500_000);
  assert_eq!(world::zone_size(&w), 512);
  assert_eq!(world::zone_ttl_ms(&w), 7_200_000);
  assert_eq!(world::speed_budget(&w), 1150);
  assert_eq!(world::spawn_zone_x(&w), 1000);
  assert_eq!(world::protector_bp(&w), 200);
  assert_eq!(world::min_groups(&w), 3);
  assert_eq!(world::max_groups(&w), 8);
  assert_eq!(world::min_nodes(&w), 8);
  assert_eq!(world::max_nodes(&w), 16);
  assert_eq!(world::resource_count(&w), 0);
  ts::return_shared(w);
  sc.end();
}

// ╔════════════════ [ Setter clamping (coercion, never rejection) ] ══════════ ]

#[test]
fun setters_clamp_to_band() {
  let mut sc = ts::begin(OWNER);
  boot(&mut sc);
  make(&mut sc);

  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<AdminCap>();
  let ver = sc.take_shared<Version>();
  let mut w = sc.take_shared<World>();

  world::set_speed_budget(&cap, &mut w, 9_999_999, &ver, sc.ctx()); // over SPEED_MAX(100_000) → pinned
  assert_eq!(world::speed_budget(&w), 100_000);
  world::set_speed_budget(&cap, &mut w, 0, &ver, sc.ctx()); // under SPEED_MIN(1) → pinned to 1
  assert_eq!(world::speed_budget(&w), 1);
  world::set_required_level(&cap, &mut w, 5_000, &ver, sc.ctx()); // over 200 → 200
  assert_eq!(world::required_level(&w), 200);
  world::set_bounds(&cap, &mut w, 10, 10, &ver, sc.ctx()); // under BOUND_MIN(512) → 512
  assert_eq!(world::bounds_x(&w), 512);
  world::set_protector_bp(&cap, &mut w, 50_000, &ver, sc.ctx()); // over 10_000 → 10_000
  assert_eq!(world::protector_bp(&w), 10_000);

  ts::return_shared(w);
  ts::return_shared(ver);
  sc.return_to_sender(cap);
  sc.end();
}

#[test, expected_failure(abort_code = EBadRange, location = world)]
fun density_max_below_min_aborts() {
  let mut sc = ts::begin(OWNER);
  boot(&mut sc);
  make(&mut sc);
  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<AdminCap>();
  let ver = sc.take_shared<Version>();
  let mut w = sc.take_shared<World>();
  world::set_density(&cap, &mut w, 8, 3, 8, 16, &ver, sc.ctx()); // max_groups(3) < min_groups(8) → EBadRange
  abort
}

#[test, expected_failure(abort_code = V_EWrongVersion, location = version)]
fun setter_on_stale_version_aborts() {
  let mut sc = ts::begin(OWNER);
  boot(&mut sc);
  make(&mut sc);
  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<AdminCap>();
  let mut ver = sc.take_shared<Version>();
  version::test_set_stale(&mut ver); // simulate an un-bumped upgrade
  let mut w = sc.take_shared<World>();
  world::set_speed_budget(&cap, &mut w, 600, &ver, sc.ctx()); // assert_latest fails
  abort
}

// ╔════════════════ [ Table setters + read getters ] ═════════════════════════ ]

#[test]
/// The remaining scalar setters (zone size/ttl/spawn — in-band values stick), the dungeon-key setter, the spawn
/// tables (a resource + mob + room row: counts + a row read), and `clear_tables` (empties the three template
/// tables while the dungeon key survives).
fun table_setters_and_read_getters() {
  let mut sc = ts::begin(OWNER);
  boot(&mut sc);
  make(&mut sc);

  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<AdminCap>();
  let ver = sc.take_shared<Version>();
  let mut w = sc.take_shared<World>();
  let res_tid = object::id_from_address(@0xE5);
  let mob_tid = object::id_from_address(@0xB0B);
  let key_tid = object::id_from_address(@0xE7);

  world::set_zone_size(&cap, &mut w, 1024, &ver, sc.ctx()); // in-band [32, 65536]
  assert_eq!(world::zone_size(&w), 1024);
  world::set_zone_ttl_ms(&cap, &mut w, 100_000, &ver, sc.ctx()); // in-band [60k, 30d]
  assert_eq!(world::zone_ttl_ms(&w), 100_000);
  world::set_spawn_zone(&cap, &mut w, 2000, 3000, &ver, sc.ctx()); // clamp [1, bounds]
  assert_eq!(world::spawn_zone_x(&w), 2000);
  assert_eq!(world::spawn_zone_z(&w), 3000);

  assert!(world::dungeon_key_template(&w).is_none()); // unset by default
  world::set_dungeon_key(&cap, &mut w, key_tid, &ver, sc.ctx());
  assert_eq!(*world::dungeon_key_template(&w).borrow(), key_tid);

  world::add_resource_entry(&cap, &mut w, res_tid, 100, 1, 3, 0, 1, &ver, sc.ctx());
  world::add_mob_entry(&cap, &mut w, mob_tid, 100, 2, 2, &ver, sc.ctx());
  world::add_dungeon_room(&cap, &mut w, vector[mob_tid], &ver, sc.ctx());
  assert_eq!(world::resource_count(&w), 1);
  assert_eq!(world::mob_count(&w), 1);
  assert_eq!(world::room_count(&w), 1);
  assert_eq!(world::re_template(world::resource_entry(&w, 0)), res_tid); // resource row read
  let _ = world::mob_entry(&w, 0); // mob row borrow (covers the accessor)

  world::clear_tables(&cap, &mut w, &ver, sc.ctx());
  assert_eq!(world::resource_count(&w), 0);
  assert_eq!(world::mob_count(&w), 0);
  assert_eq!(world::room_count(&w), 0);
  assert!(world::dungeon_key_template(&w).is_some()); // the key is NOT a spawn table — it survives

  ts::return_shared(w);
  ts::return_shared(ver);
  sc.return_to_sender(cap);
  sc.end();
}

// ╔════════════════ [ Zone math — overflow-proof, bounds-checked edges ] ══════ ]

#[test]
fun zone_of_maps_and_origins() {
  let mut sc = ts::begin(OWNER);
  boot(&mut sc);
  make(&mut sc);
  sc.next_tx(OWNER);
  let w = sc.take_shared<World>(); // default zone_size 512, bounds 500_000

  let (zx0, zy0) = world::zone_of(&w, 0, 0);
  assert!(zx0 == 0 && zy0 == 0);
  let (zx1, zy1) = world::zone_of(&w, 511, 511); // last block of zone 0
  assert!(zx1 == 0 && zy1 == 0);
  let (zx2, zy2) = world::zone_of(&w, 512, 0); // first block of zone (1,0)
  assert!(zx2 == 1 && zy2 == 0);

  // 500k×500k overflow probe: the far in-bounds corner maps + its origin stays in-bounds (no u32 overflow)
  let (mzx, mzy) = world::zone_of(&w, 499_999, 499_999);
  assert!(mzx == 976 && mzy == 976); // 499999 / 512 = 976
  let (ox, oz) = world::zone_origin(&w, mzx, mzy);
  assert!(ox == 499_712 && oz == 499_712 && ox < 500_000 && oz < 500_000);

  ts::return_shared(w);
  sc.end();
}

#[test, expected_failure(abort_code = EOutOfBounds, location = world)]
fun zone_of_at_bounds_edge_aborts() {
  let mut sc = ts::begin(OWNER);
  boot(&mut sc);
  make(&mut sc);
  sc.next_tx(OWNER);
  let w = sc.take_shared<World>();
  world::zone_of(&w, 500_000, 0); // x == bounds_x is OUT (bounds are exclusive) → EOutOfBounds
  abort
}

// ╔════════════════ [ Golden-gather rare links (§6) — DF set/read/overwrite/clear + gating ] ═ ]

#[test]
fun rare_link_set_read_overwrite_clear() {
  let mut sc = ts::begin(OWNER);
  boot(&mut sc);
  make(&mut sc);
  let base = object::id_from_address(@0xB1);
  let rare1 = object::id_from_address(@0xB2);
  let rare2 = object::id_from_address(@0xB3);

  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<AdminCap>();
  let ver = sc.take_shared<Version>();
  let mut w = sc.take_shared<World>();

  assert!(world::rare_link(&w, base).is_none()); // absent by default
  world::set_rare_link(&cap, &mut w, base, rare1, &ver, sc.ctx());
  assert_eq!(*world::rare_link(&w, base).borrow(), rare1); // linked
  world::set_rare_link(&cap, &mut w, base, rare2, &ver, sc.ctx()); // upsert overwrites (no dup abort)
  assert_eq!(*world::rare_link(&w, base).borrow(), rare2);
  world::clear_rare_link(&cap, &mut w, base, &ver, sc.ctx());
  assert!(world::rare_link(&w, base).is_none()); // cleared

  ts::return_shared(w);
  ts::return_shared(ver);
  sc.return_to_sender(cap);
  sc.end();
}

#[test, expected_failure(abort_code = A_EAdminCapExpired, location = admin)]
fun set_rare_link_expired_cap_aborts() {
  let mut sc = ts::begin(OWNER);
  boot(&mut sc);
  make(&mut sc);
  sc.next_tx(OWNER);
  let super_cap = sc.take_from_sender<AdminCap>();
  admin::mint_temp_admin_cap(&super_cap, TEMP, sc.ctx());
  sc.return_to_sender(super_cap);
  sc.next_epoch(TEMP); // the temp cap (stamped with the previous epoch) is now stale
  let temp = sc.take_from_sender<AdminCap>();
  let ver = sc.take_shared<Version>();
  let mut w = sc.take_shared<World>();
  world::set_rare_link(&temp, &mut w, object::id_from_address(@0xB1), object::id_from_address(@0xB2), &ver, sc.ctx()); // EAdminCapExpired
  abort
}

#[test, expected_failure(abort_code = V_EWrongVersion, location = version)]
fun set_rare_link_stale_version_aborts() {
  let mut sc = ts::begin(OWNER);
  boot(&mut sc);
  make(&mut sc);
  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<AdminCap>();
  let mut ver = sc.take_shared<Version>();
  version::test_set_stale(&mut ver); // simulate an un-bumped upgrade
  let mut w = sc.take_shared<World>();
  world::set_rare_link(&cap, &mut w, object::id_from_address(@0xB1), object::id_from_address(@0xB2), &ver, sc.ctx()); // assert_latest fails
  abort
}

// ╔════════════════ [ Burn / teardown ] ══════════════════════════════════════ ]

#[test, expected_failure(abort_code = EWorldNotEmpty, location = world)]
/// `destroy_world` refuses while the inline spawn tables still hold rows (`EWorldNotEmpty`) — the deliberate
/// two-step burn forces `clear_tables` first, so a populated LIVE world can't be nuked in one call.
fun destroy_world_refuses_while_populated() {
  let mut sc = ts::begin(OWNER);
  boot(&mut sc);
  make(&mut sc);
  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<AdminCap>();
  let ver = sc.take_shared<Version>();
  let mut w = sc.take_shared<World>();
  world::add_resource_entry(&cap, &mut w, object::id_from_address(@0xA11CE), 100, 1, 3, 0, 1, &ver, sc.ctx());
  world::destroy_world(&cap, w, &ver, sc.ctx()); // EWorldNotEmpty — a resource row is present
  abort
}

#[test]
/// The full teardown: add spawn rows + ALL THREE of this module's DF classes (a rare-link, a mob-level, a
/// protector pin), drain them (proving each clears), clear the inline tables, then destroy the shell — the
/// shared World is GONE.
fun drain_then_destroy_world_happy() {
  let mut sc = ts::begin(OWNER);
  boot(&mut sc);
  make(&mut sc);
  let res = object::id_from_address(@0xA11CE);
  let rare = object::id_from_address(@0x6A);
  let guard = object::id_from_address(@0x6B);
  let mob = object::id_from_address(@0xB0B);

  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<AdminCap>();
  let ver = sc.take_shared<Version>();
  let mut w = sc.take_shared<World>();
  // populate: a resource row, a mob row, a rare-link DF (res→rare), a mob-level DF (mob→50), a protector DF (res→guard)
  world::add_resource_entry(&cap, &mut w, res, 100, 1, 3, 0, 1, &ver, sc.ctx());
  world::add_mob_entry(&cap, &mut w, mob, 100, 1, 2, &ver, sc.ctx());
  world::set_rare_link(&cap, &mut w, res, rare, &ver, sc.ctx());
  world::set_mob_level(&cap, &mut w, mob, 50, &ver, sc.ctx());
  world::set_resource_protector(&cap, &mut w, res, option::some(guard), &ver, sc.ctx());
  assert!(world::rare_link(&w, res).is_some());
  assert_eq!(world::mob_level(&w, mob), 50);
  assert!(world::resource_protector(&w, res).is_some());

  // drain this module's own DF children, proving each class is gone
  world::drain_world_links(&cap, &mut w, vector[res], vector[mob], vector[res], &ver, sc.ctx());
  assert!(world::rare_link(&w, res).is_none()); // rare-link DF removed
  assert_eq!(world::mob_level(&w, mob), 0); // mob-level DF removed (unset defaults to 0)
  assert!(world::resource_protector(&w, res).is_none()); // protector DF removed

  // clear the inline tables, then destroy the emptied shell
  world::clear_tables(&cap, &mut w, &ver, sc.ctx());
  world::destroy_world(&cap, w, &ver, sc.ctx());
  ts::return_shared(ver);
  sc.return_to_sender(cap);

  sc.next_tx(OWNER);
  assert!(!ts::has_most_recent_shared<World>()); // the shell no longer exists
  sc.end();
}

#[test, expected_failure(abort_code = V_EWrongVersion, location = version)]
/// `drain_world_links` on a stale package version aborts — version-gated exactly like every authoring door.
fun drain_world_links_on_stale_version_aborts() {
  let mut sc = ts::begin(OWNER);
  boot(&mut sc);
  make(&mut sc);
  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<AdminCap>();
  let mut ver = sc.take_shared<Version>();
  let mut w = sc.take_shared<World>();
  version::test_set_stale(&mut ver);
  world::drain_world_links(&cap, &mut w, vector[], vector[], vector[], &ver, sc.ctx()); // EWrongVersion
  abort
}

#[test, expected_failure(abort_code = V_EWrongVersion, location = version)]
/// `destroy_world` on a stale package version aborts — the version gate fires before the empty-tables check.
fun destroy_world_on_stale_version_aborts() {
  let mut sc = ts::begin(OWNER);
  boot(&mut sc);
  make(&mut sc);
  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<AdminCap>();
  let mut ver = sc.take_shared<Version>();
  let w = sc.take_shared<World>(); // fresh world: tables empty — isolates the VERSION gate
  version::test_set_stale(&mut ver);
  world::destroy_world(&cap, w, &ver, sc.ctx()); // EWrongVersion
  abort
}

#[test]
/// DUPLICATE TEMPLATE ROWS: authoring permits the same mob template in several rows, and the retired
/// `MobLevelKey` dynamic field was keyed BY TEMPLATE — one level always applied to every row carrying it. The
/// parallel level vector must reproduce that: `set_mob_level` writes EVERY matching row, not just the first,
/// or the later duplicates stay dormant at 0 and spawn outside their authored difficulty band.
fun set_mob_level_updates_every_row_of_a_duplicated_template() {
  let mut sc = ts::begin(OWNER);
  boot(&mut sc);
  let _wid = make(&mut sc);
  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<AdminCap>();
  let ver = sc.take_shared<Version>();
  let mut w = sc.take_shared<World>();
  let dup = object::id_from_address(@0xD00B);
  let other = object::id_from_address(@0x0E1);
  world::add_mob_entry(&cap, &mut w, dup, 100, 1, 4, &ver, sc.ctx()); // row 0
  world::add_mob_entry(&cap, &mut w, other, 100, 1, 4, &ver, sc.ctx()); // row 1
  world::add_mob_entry(&cap, &mut w, dup, 100, 1, 4, &ver, sc.ctx()); // row 2 — same template as row 0
  world::set_mob_level(&cap, &mut w, dup, 77, &ver, sc.ctx());
  // rows 0 AND 2 carry the level; the unrelated row stays at its dormant default
  assert_eq!(world::mob_levels_snapshot(&w), vector<u16>[77, 0, 77]);
  assert_eq!(world::mob_level(&w, dup), 77);
  ts::return_shared(w);
  ts::return_shared(ver);
  sc.return_to_sender(cap);
  sc.end();
}
