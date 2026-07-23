// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// Coverage for `fight`'s zero-covered accessors and the REAL branded `join<W>` door — every existing test drives
/// joins through `fight::join_for_testing`/`join_with_cap_for_testing` (which bypass `join` and call `seat_joiner`
/// directly), so `join` itself has never been exercised. Defines its own witness `W` (a `TestBrand` value can only
/// be constructed inside `fight.move` itself) and drives the real public `create<W>`/`join<W>` doors directly.
#[test_only]
module aresrpg_fight::fight_more_tests;

use aresrpg_fight::{fight::{Self, Fight}, fight_registry::{Self, FightRegistry}, version::Version};
use aresrpg_fight::fight_scaffold::{bag_spec, combatant, mk_clock, stand_up, tsreg};
use sui::{clock, test_scenario::{Self as ts}};

const OWNER: address = @0xA;
const CHAR: address = @0xC0;
const CHAR2: address = @0xC2;
const WORLD: address = @0x704D;
const LOOT: address = @0x100;

public struct W has drop {}

#[test]
fun real_create_and_join_door_cover_seat_and_field_getters() {
  let mut sc = ts::begin(OWNER);
  stand_up(&mut sc);
  sc.next_tx(OWNER);
  let mut registry = tsreg(&sc);
  let ver = sc.take_shared<Version>();
  let clock = mk_clock(&mut sc, 1_000);
  fight::create<W>(
    W {}, &mut registry, object::id_from_address(WORLD), 9, 12345, 100, 200, 0, true, option::none(), false,
    &bag_spec(50), 1, 42, object::id_from_address(LOOT), combatant(CHAR, 100), vector[], option::none(), fight::test_dials(), &ver, &clock, sc.ctx(),
  );
  clock::destroy_for_testing(clock);
  ts::return_shared(registry);
  ts::return_shared(ver);

  sc.next_tx(OWNER);
  let mut fight = sc.take_shared<Fight>();
  let mut registry = tsreg(&sc);
  let ver = sc.take_shared<Version>();
  fight::join<W>(W {}, &mut fight, &mut registry, combatant(CHAR2, 100), vector[], option::none(), option::none(), 0, false, &ver, sc.ctx());
  assert!(fight::participant_count(&fight) == 2);

  assert!(fight::group_template(&fight) == object::id_from_address(LOOT));
  assert!(fight::team_bound(&fight) == 6);
  assert!(fight::all_start_cells(&fight).length() > 0);
  assert!(fight::last_action_ms(&fight) == 0);
  assert!(fight::placement_deadline_ms(&fight) == 1_000 + 120_000);
  fight::set_last_action_ms(&mut fight, 555);
  assert!(fight::last_action_ms(&fight) == 555);

  let fid = fight::id(&fight);
  assert!(object::uid_to_inner(fight::uid(&fight)) == fid);
  {
    let u = fight::uid_mut(&mut fight);
    assert!(object::uid_to_inner(u) == fid);
  };

  ts::return_shared(fight);
  ts::return_shared(registry);
  ts::return_shared(ver);
  sc.end();
}
