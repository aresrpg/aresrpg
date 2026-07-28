// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// Issue #1260 producer tooth: a group spawn must accumulate every seated mob cell before drawing the next.
///
/// Both tests use the production board `(world_seed=12345, anchor=100,200)`. On the pre-fix fixed-exclusion
/// loops, `group_seed=21` makes `create` seat `[49,49]`, while `group_seed=38` makes `create_members` seat
/// `[29,29]`. The corrected loops keep the draw count and final PRNG state unchanged, but probe forward past the
/// occupied cell to `[49,50]` and `[29,30]`.
#[test_only]
module aresrpg_fight::spawn_occupancy_tests;

use aresrpg_fight::{
  fight::{Self, Fight},
  fight_scaffold::{bag_spec, combatant, mk_clock, stand_up, tsregs_for},
  mob,
  version::Version,
};
use std::unit_test::assert_eq;
use sui::{clock, test_scenario::{Self as ts}};

const OWNER: address = @0xA;
const CHAR: address = @0xC0;
const WORLD: address = @0x704D;
const LOOT: address = @0x100;
const MEMBER_A: address = @0xA1;
const MEMBER_B: address = @0xB1;

public struct W has drop {}

fun tid(a: address): ID { object::id_from_address(a) }

#[test]
fun create_accumulates_occupied_cells_between_group_members() {
  let mut sc = ts::begin(OWNER);
  stand_up(&mut sc);
  sc.next_tx(OWNER);
  {
    let (mut registry, mut latch) = tsregs_for(&sc, tid(WORLD), tid(CHAR));
    let ver = sc.take_shared<Version>();
    let clock = mk_clock(&mut sc, 1_000);
    fight::create<W>(
      W {}, &mut registry, &mut latch, tid(WORLD), 1, 12345, 100, 200, 0, true, option::none(), false,
      &bag_spec(100), 2, 21, tid(LOOT), combatant(CHAR, 100), vector[], option::none(), fight::test_dials(),
      &ver, &clock, sc.ctx(),
    );
    clock::destroy_for_testing(clock);
    ts::return_shared(latch);
    ts::return_shared(registry);
    ts::return_shared(ver);
  };

  sc.next_tx(OWNER);
  let fight = sc.take_shared<Fight>();
  assert_eq!(fight::mob_count(&fight), 2);
  assert_eq!(mob::cell(fight::mobs(&fight).borrow(0)), 49);
  assert_eq!(mob::cell(fight::mobs(&fight).borrow(1)), 50);
  ts::return_shared(fight);
  sc.end();
}

#[test]
fun create_members_accumulates_occupied_cells_between_group_members() {
  let mut sc = ts::begin(OWNER);
  stand_up(&mut sc);
  sc.next_tx(OWNER);
  {
    let (mut registry, mut latch) = tsregs_for(&sc, tid(WORLD), tid(CHAR));
    let ver = sc.take_shared<Version>();
    let clock = mk_clock(&mut sc, 1_000);
    let committed = vector[tid(MEMBER_A), tid(MEMBER_B)];
    let mut build = fight::open_group_for_testing(
      tid(WORLD), 2, 38, 0, committed, combatant(CHAR, 100), &ver,
    );
    let spec_a = bag_spec(100);
    let spec_b = bag_spec(100);
    fight::add_member(&mut build, tid(MEMBER_A), &spec_a);
    fight::add_member(&mut build, tid(MEMBER_B), &spec_b);
    fight::create_members(build, &mut registry, &mut latch, &ver, &clock, sc.ctx());
    clock::destroy_for_testing(clock);
    ts::return_shared(latch);
    ts::return_shared(registry);
    ts::return_shared(ver);
  };

  sc.next_tx(OWNER);
  let fight = sc.take_shared<Fight>();
  assert_eq!(fight::mob_count(&fight), 2);
  assert_eq!(mob::cell(fight::mobs(&fight).borrow(0)), 29);
  assert_eq!(mob::cell(fight::mobs(&fight).borrow(1)), 30);
  ts::return_shared(fight);
  sc.end();
}
