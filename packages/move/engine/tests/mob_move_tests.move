// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// MOB-MOVE observability (chain-forensics 2026-07-11): a mob whose turn draws REPOSITION-ONLY (no cast) used to
/// emit NOTHING, so no client/indexer could ever render the move (`emit_moved` had a single call site — the
/// player's own move). `resolve_mob_turn` now fires `MobMoved` on any cell change. This drives a real
/// reposition-only mob turn — a mob with MOVEMENT points but an EMPTY kit (so it can ONLY move, never cast) —
/// through the crank and asserts the mob's cell CHANGED: the observable proof that the `moved` branch (which now
/// emits) executed. Move unit tests cannot inspect event payloads (see `fight_events_more_tests`), so the cell
/// delta is the oracle; the emit wrapper itself is covered there. The scaffold's `bag_spec` mob has MP 0 (it can
/// never move — that is why the crank test only asserts turn advance), so this builds a custom MP>0 spec.
#[test_only]
module aresrpg_fight::mob_move_tests;

use aresrpg_fight::{fight::{Self, Fight}, mob, participant, turns, version::Version};
use aresrpg_fight::fight_scaffold::{combatant, mk_clock, mob_stats, stand_up, tsreg};
use sui::{clock, test_scenario::{Self as ts}};

const OWNER: address = @0xA;
const CHAR: address = @0xC0; // creator character id source (mirrors the scaffold)
const CHAR2: address = @0xC2; // second player (survives the crank; the mob closes on it)
const WORLD: address = @0x704D; // world id source (mirrors the scaffold)
const LOOT: address = @0x100; // loot template id source

#[test]
/// A 2-player + 1-mob fight (queue p0,m0,p1): p0 stalls past its deadline, ANYONE cranks → p0 forfeits and the mob
/// resolves its turn. The mob has MP 6 and NO kit, so its only legal action is to MOVE toward a living player;
/// assert its cell changed — the reposition-only branch (now emitting MobMoved) fired.
fun mob_reposition_only_turn_changes_cell() {
  let mut sc = ts::begin(OWNER);
  stand_up(&mut sc);

  // A custom mob: base_hp 500, AP 0, MP 6, NO spells (reposition-only), one 100%-drop loot row.
  sc.next_tx(OWNER);
  {
    let mut registry = tsreg(&sc);
    let ver = sc.take_shared<Version>();
    let loot = vector[mob::new_loot_entry(object::id_from_address(LOOT), 10000, 1, 1)];
    let spec = mob::new_mob_spec(1, 1, 500, 0, 6, mob_stats(), vector[], 100, loot); // MP 6, empty kit
    let clock = mk_clock(&mut sc, 1000);
    fight::create_for_testing(&mut registry, object::id_from_address(WORLD), 1, 12345, 100, 200, 0, true, option::none(), &spec, 1, combatant(CHAR, 100), &ver, &clock, sc.ctx());
    clock::destroy_for_testing(clock);
    ts::return_shared(registry);
    ts::return_shared(ver);
  };

  sc.next_tx(OWNER);
  let mut fight = sc.take_shared<Fight>();
  let ver = sc.take_shared<Version>();
  fight::join_for_testing(&mut fight, combatant(CHAR2, 100), option::none(), &ver, sc.ctx());
  let c0 = participant::cell(fight::participants(&fight).borrow(0));
  let c1 = participant::cell(fight::participants(&fight).borrow(1));
  let clock = mk_clock(&mut sc, 1000);
  turns::place_for_testing(&mut fight, object::id_from_address(CHAR), c0, &ver, &clock, OWNER);
  turns::place_for_testing(&mut fight, object::id_from_address(CHAR2), c1, &ver, &clock, OWNER);
  clock::destroy_for_testing(clock);
  assert!(fight::status(&fight) == fight::status_active());

  let mob_cell_before = mob::cell(fight::mobs(&fight).borrow(0));
  turns::crank_for_testing(&mut fight, 999_999); // p0 forfeits (>> deadline) → the mob's turn resolves
  let mob_cell_after = mob::cell(fight::mobs(&fight).borrow(0));
  assert!(mob_cell_after != mob_cell_before); // the mob repositioned → the MobMoved emit branch executed

  ts::return_shared(fight);
  ts::return_shared(ver);
  sc.end();
}
