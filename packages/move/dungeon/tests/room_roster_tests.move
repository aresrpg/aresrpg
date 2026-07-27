// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// THE ROOM ROSTER (#1110 ⑤) — a dungeon room can now be a BOSS PLUS ITS ADDS, and it can only be fought as
/// exactly that.
///
/// The old door is template-strict: it takes one `&MobTemplate`, asserts it is `roster[0]`, and demands every
/// other roster row equal it — which makes a donor-pattern room unauthorable at all. Relaxing that assert alone
/// would have been the weakest-template-×N exploit: any authored row, N times, for the boss room's rewards. The
/// resolution is that the room's authored roster IS the builder's commitment, so the allowlist and the create
/// path are one mechanism, checked position by position.
#[test_only]
module aresrpg_dungeon::room_roster_tests;

use aresrpg::{admin::AdminCap, config::GameConfig, fight as fight_doors, mob_template::{Self, MobTemplate}, version::Version, world::{Self, World}};
use aresrpg_dungeon::{dungeon, run::{Self, RunPass}, dungeon_world as test_world};
use aresrpg_fight::{
  admin as eadmin,
  fight::{Self as engine, Fight},
  fight_registry::{Self, FightRegistry},
  version::{Self as eversion, Version as EVersion}
};
use aresrpg_foundation::spell;
use kiosk::personal_kiosk::PersonalKioskCap;
use std::unit_test::assert_eq;
use sui::{clock, kiosk::Kiosk, test_scenario::{Self as ts, Scenario}};

const ERoomNotHomogeneous: u64 = 108; // aresrpg_dungeon::dungeon — the OLD door's template-equality assert
const EWrongMember: u64 = 114; // aresrpg_fight::fight — add_member: not the next committed template

fun boot_engine(sc: &mut Scenario) {
  sc.next_tx(test_world::owner());
  fight_registry::test_init(sc.ctx());
  eversion::test_init(sc.ctx());
  eadmin::test_init(sc.ctx());
  sc.next_tx(test_world::owner());
  let ecap = sc.take_from_sender<eadmin::AdminCap>();
  let mut ever = sc.take_shared<EVersion>();
  eadmin::admin_set_enabled(&ecap, &mut ever, true, sc.ctx());
  ts::return_shared(ever);
  sc.return_to_sender(ecap);
}

/// A shared template at its own band — the boss and its add are different templates of one authored family.
fun template(sc: &mut Scenario, name: vector<u8>, min_level: u16, max_level: u16, xp: u64): ID {
  sc.next_tx(test_world::owner());
  let cap = sc.take_from_sender<AdminCap>();
  let ver = sc.take_shared<Version>();
  let tid = mob_template::mint(
    &cap, &ver, name.to_string(), min_level, max_level, 50, 6, 3, 0,
    spell::new_stats(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0), vector[], vector[], xp, sc.ctx(),
  );
  ts::return_shared(ver);
  sc.return_to_sender(cap);
  tid
}

fun last_kiosk_id(): ID { ts::most_recent_id_shared<Kiosk>().destroy_some() }

/// Boot both halves, author ONE room with the DONOR PATTERN (boss + two adds), and hand back a latched-ready
/// pass at room 1. Returns `(pass, boss, add, kiosk, character)`.
fun donor_room(sc: &mut Scenario): (RunPass, ID, ID, ID, ID) {
  test_world::boot(sc);
  boot_engine(sc);
  let boss = template(sc, b"draugr-lord", 40, 40, 900);
  let add = template(sc, b"draugr", 10, 10, 100);

  sc.next_tx(test_world::owner());
  let cap = sc.take_from_sender<AdminCap>();
  let ver = sc.take_shared<Version>();
  let wid = world::create_world(&cap, &ver, 7, b"cave".to_string(), sc.ctx());
  sc.next_tx(test_world::owner());
  let mut w = sc.take_shared<World>();
  world::add_dungeon_room(&cap, &mut w, vector[boss, add, add], &ver, sc.ctx());
  ts::return_shared(w);
  ts::return_shared(ver);
  sc.return_to_sender(cap);

  let cid = test_world::mint_character(sc, test_world::owner());
  sc.next_tx(test_world::owner());
  let kid = last_kiosk_id();
  sc.next_tx(test_world::owner());
  let pass = run::new(wid, test_world::owner(), 0, 0, cid, sc.ctx());
  (pass, boss, add, kid, cid)
}

/// Drive the roster door: open the room's build, add `order` template by template, create.
fun engage(sc: &mut Scenario, pass: &mut RunPass, kid: ID, cid: ID, order: vector<ID>, boss: ID, add: ID) {
  sc.next_tx(test_world::owner());
  let mut reg = sc.take_shared<FightRegistry>();
  let world = sc.take_shared<World>();
  let mut k = ts::take_shared_by_id<Kiosk>(sc, kid);
  let pkcap = sc.take_from_sender<PersonalKioskCap>();
  let cfg = sc.take_shared<GameConfig>();
  let ver = sc.take_shared<Version>();
  let ever = sc.take_shared<EVersion>();
  let t_boss = ts::take_shared_by_id<MobTemplate>(sc, boss);
  let t_add = ts::take_shared_by_id<MobTemplate>(sc, add);
  let mut clk = clock::create_for_testing(sc.ctx());
  clk.set_for_testing(1000);
  let mut build = dungeon::open_room_fight(&mut reg, &world, pass, &mut k, &pkcap, cid, vector[], &cfg, &ever, &ver, &ver, &clk, sc.ctx());
  let mut i = 0;
  while (i < order.length()) {
    if (order[i] == boss) fight_doors::add_member(&mut build, &t_boss)
    else fight_doors::add_member(&mut build, &t_add);
    i = i + 1;
  };
  engine::create_members(build, &mut reg, &ever, &clk, sc.ctx());
  clk.destroy_for_testing();
  ts::return_shared(reg); ts::return_shared(world); ts::return_shared(k); sc.return_to_sender(pkcap);
  ts::return_shared(cfg); ts::return_shared(ver); ts::return_shared(ever);
  ts::return_shared(t_boss); ts::return_shared(t_add);
}

#[test]
/// THE DONOR ROOM RUNS — boss plus two adds, seated in the authored order, each at its own authored level. This
/// room shape had no door at all before: `next_fight` refuses it (the test below), so the content was
/// unauthorable rather than merely unfought.
fun a_boss_plus_adds_room_fights_as_authored() {
  let mut sc = ts::begin(test_world::owner());
  let (mut pass, boss, add, kid, cid) = donor_room(&mut sc);
  engage(&mut sc, &mut pass, kid, cid, vector[boss, add, add], boss, add);

  sc.next_tx(test_world::owner());
  let fight = sc.take_shared<Fight>();
  assert_eq!(engine::mob_count(&fight), 3);
  assert_eq!(engine::mob_template_at(&fight, 0), boss);
  assert_eq!(engine::mob_template_at(&fight, 1), add);
  assert_eq!(engine::mob_template_at(&fight, 2), add);
  // the boss is worth what the boss is worth — a roster-blind create would have paid three adds or three bosses
  assert_eq!(engine::mob_xp_at(&fight, 0), 900);
  assert_eq!(engine::mob_xp_at(&fight, 1), 100);
  assert!(run::is_latched(&pass));
  ts::return_shared(fight);
  let (_, _, _, _, _) = run::consume(pass);
  sc.end();
}

#[test, expected_failure(abort_code = EWrongMember, location = aresrpg_fight::fight)]
/// THE WEAKEST-TEMPLATE EXPLOIT, refused. The room authored `[boss, add, add]`; the caller offers three adds —
/// an authored-set allowlist alone would accept every one of them, and the party would farm the boss room's
/// rewards off three trash mobs. The positional commitment refuses at slot 0.
fun running_the_boss_room_as_three_adds_aborts() {
  let mut sc = ts::begin(test_world::owner());
  let (mut pass, boss, add, kid, cid) = donor_room(&mut sc);
  engage(&mut sc, &mut pass, kid, cid, vector[add, add, add], boss, add);
  abort 0
}

#[test, expected_failure(abort_code = EWrongMember, location = aresrpg_fight::fight)]
/// A FOREIGN template is refused for the same reason and by the same check — the room's own authoring is the
/// only allowlist there is.
fun a_template_the_room_never_authored_aborts() {
  let mut sc = ts::begin(test_world::owner());
  let (mut pass, boss, add, kid, cid) = donor_room(&mut sc);
  let intruder = template(&mut sc, b"chicklet", 1, 1, 1);
  engage(&mut sc, &mut pass, kid, cid, vector[boss, intruder, add], boss, intruder);
  abort 0
}

#[test, expected_failure(abort_code = ERoomNotHomogeneous, location = aresrpg_dungeon::dungeon)]
/// THE OLD DOOR still refuses the donor room, exactly as it always did — which is why the roster door had to
/// exist rather than the assert simply being relaxed. `next_fight` keeps serving homogeneous rooms untouched.
fun the_template_strict_door_still_refuses_a_donor_room() {
  let mut sc = ts::begin(test_world::owner());
  let (mut pass, boss, _add, kid, cid) = donor_room(&mut sc);
  sc.next_tx(test_world::owner());
  let mut reg = sc.take_shared<FightRegistry>();
  let world = sc.take_shared<World>();
  let mut k = ts::take_shared_by_id<Kiosk>(&sc, kid);
  let pkcap = sc.take_from_sender<PersonalKioskCap>();
  let cfg = sc.take_shared<GameConfig>();
  let ver = sc.take_shared<Version>();
  let ever = sc.take_shared<EVersion>();
  let tmpl = ts::take_shared_by_id<MobTemplate>(&sc, boss);
  let mut clk = clock::create_for_testing(sc.ctx());
  clk.set_for_testing(1000);
  dungeon::next_fight(&mut reg, &world, &mut pass, &tmpl, &mut k, &pkcap, cid, vector[], &cfg, &ever, &ver, &ver, &clk, sc.ctx());
  abort 0
}
