// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// #1806 — A CORPSE RELEASES ITS CELL, chain side. Occupancy is LIVING-only on chain
/// (`displacement::add_living_bodies`, `cast::cell_occupied`), so the instant a mob's hp reaches 0 its cell is
/// walkable — and it stops locking the tackle zone too. Both facts are turn-independent by construction: the
/// occupancy walk re-reads live bodies on every action, so "the same turn" and "the next turn" are the SAME
/// read. The client twin is `packages/fight/test/dead_cell_walkable.test.js`.
#[test_only]
module aresrpg_fight::corpse_release_tests;

use aresrpg_fight::{
  actions,
  cast,
  fight::{Self, Fight},
  fight_events,
  fight_scaffold::{create_fight, mk_clock, stand_up},
  mob,
  participant,
  turns,
  version::Version,
};
use aresrpg_foundation::spell::{Self, Stats};
use aresrpg_foundation::spell_effect;
use sui::{clock, event, test_scenario::{Self as ts, Scenario}};

const OWNER: address = @0xA;
const CHAR: address = @0xC0;
const PLAYER_CELL: u64 = 165;
const CORPSE_CELL: u64 = 166; // the body between me and the prize
const BEYOND_CELL: u64 = 167;

fun z(): Stats { spell::new_stats(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0) }

/// The tackle scaffold's board, mirrored: seat 0 on 165 with AP 6 / MP 3, mob 0 standing due east on 166.
fun blocked_line(sc: &mut Scenario): (Fight, Version) {
  stand_up(sc);
  create_fight(sc, 100, 1, 0, 1000, true, option::none());
  sc.next_tx(OWNER);
  let mut fight = sc.take_shared<Fight>();
  let ver = sc.take_shared<Version>();
  let cell0 = participant::cell(fight::participants(&fight).borrow(0));
  let clock = mk_clock(sc, 1000);
  turns::place_for_testing(&mut fight, object::id_from_address(CHAR), cell0, &ver, &clock, OWNER);
  clock::destroy_for_testing(clock);
  participant::set_cell(fight::participants_mut(&mut fight).borrow_mut(0), PLAYER_CELL);
  mob::set_cell(fight::mobs_mut(&mut fight).borrow_mut(0), CORPSE_CELL);
  (fight, ver)
}

fun kill_the_mob(fight: &mut Fight) {
  let ps = z();
  let mut rng = 1u64;
  // A flat lethal line through the ordinary player→mob dispatch — the mob keeps its cell and goes to hp 0,
  // exactly as any kill leaves it.
  cast::apply_effect_for_testing(
    fight, 0, 0, PLAYER_CELL, &ps, 1, CORPSE_CELL,
    &spell_effect::damage(spell::el_earth(), 100_000), &mut rng,
  );
  assert!(!mob::is_alive(fight::mobs(fight).borrow(0)), 99);
}

#[test]
/// The LIVING body is what blocks — the fixture discriminates before it proves anything.
fun a_living_body_blocks_its_cell() {
  let mut sc = ts::begin(OWNER);
  let (fight, ver) = blocked_line(&mut sc);
  assert!(cast::cell_occupied(&fight, CORPSE_CELL), 0);
  ts::return_shared(fight);
  ts::return_shared(ver);
  sc.end();
}

#[test]
/// Dead ⇒ the cell is free to the chain's own occupancy door, and the walk THROUGH it lands.
fun a_dead_mob_releases_its_cell_to_the_walk() {
  let mut sc = ts::begin(OWNER);
  let (mut fight, ver) = blocked_line(&mut sc);
  kill_the_mob(&mut fight);
  assert!(!cast::cell_occupied(&fight, CORPSE_CELL), 0);
  actions::move_for_testing(&mut fight, object::id_from_address(CHAR), BEYOND_CELL, &ver, 1000, OWNER);
  let p = fight::participants(&fight).borrow(0);
  assert!(participant::cell(p) == BEYOND_CELL, 1); // walked straight through the corpse
  assert!(participant::mp(p) == 1, 2); // two steps, no detour — the corpse cost nothing
  // A corpse locks no tackle zone either: leaving its melee ring never contests.
  assert!(event::events_by_type<fight_events::Tackled>().is_empty(), 3);
  ts::return_shared(fight);
  ts::return_shared(ver);
  sc.end();
}
