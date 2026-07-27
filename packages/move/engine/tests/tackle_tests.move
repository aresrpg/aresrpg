// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// TACKLE — the ordinary-movement escape contest (chain twin of packages/sim/src/fight_actions.js:63-100, the
/// repo's shipped deterministic-sim rule; SPEC.md is silent on tackle and the research corpus carries only the
/// dodge/lock stat-family enum — CORPUS.md:125 — so the sim rule is the authority, same precedent as the esquive
/// contest in spell_formula.move:110-112). Every expected number below was PRE-COMPUTED with the sim's own prng
/// mirror (packages/sim/src/prng.js — scratch generator, cross-oracle law): scaffold turn seed
/// mix(mix(mix(mix(12345, 1), 42), 1), 0) = 3114863173 — the scaffold's turn entropy is 42 (the test crank's
/// fixed draw) at ordinal 1. Raw draws per (slot, mp): (0,3)→582013873 · (0,2)→1529003476 · (0,1)→3234605891.
/// Verdicts follow: at the even contest (num 2 / den 4) mp 3 and mp 2 ESCAPE and mp 1 is TACKLED; at the
/// two-locker product (num 4 / den 16) mp 2 is TACKLED. Every case below drives the MP its stated outcome
/// lives at. Sim golden twin: packages/sim/test/tackle_golden.test.js over test/vectors/tackle_golden.json
/// (ids match the engine_* cases).
#[test_only]
module aresrpg_fight::tackle_tests;

use aresrpg_fight::{
  actions,
  fight::{Self, Fight},
  fight_events,
  fight_scaffold::{combatant, create_fight, first_open_move_neighbor, mk_clock, mob_stats, stand_up, tsreg},
  mob,
  participant,
  statuses,
  turns,
  version::Version,
};
use aresrpg_foundation::{spell, spell_board, spell_effect};
use sui::{clock, event, test_scenario::{Self as ts, Scenario}};

const OWNER: address = @0xA;
const CHAR: address = @0xC0;
const WORLD: address = @0x704D;
const LOOT: address = @0x100;
const MOB_FID: u64 = 1_000; // spell_board fighter id of mob 0 (mirrors invisibility_tests)
const A_EIllegalMove: u64 = 104; // actions::EIllegalMove (module-private consts aren't visible cross-module)

/// agility-only stat block: new_stats(strength, intelligence, chance, AGILITY, raw, …zeros).
fun agi_stats(agility: u64): spell::Stats {
  spell::new_stats(0, 0, 0, agility, 0, 0, 0, 0, 0, 0, 0)
}

/// Stand up the bag fight (world_seed 12345 / spawn_id 1 / place at now=1000 → turn_deadline 61000) and drive to
/// ACTIVE with the creator on the proven-walkable strip: player 165, mob 164 (adjacent, west). Seat 0 begins its
/// turn refilled to AP 6 / MP 3 (scaffold combatant base).
fun active_adjacent_fight(sc: &mut Scenario): (Fight, Version) {
  stand_up(sc);
  create_fight(sc, 100, 1, 0, 1000, true, option::none());
  sc.next_tx(OWNER);
  let mut fight = sc.take_shared<Fight>();
  let ver = sc.take_shared<Version>();
  let cell0 = participant::cell(fight::participants(&fight).borrow(0));
  let clock = mk_clock(sc, 1000);
  turns::place_for_testing(&mut fight, object::id_from_address(CHAR), cell0, &ver, &clock, OWNER);
  clock::destroy_for_testing(clock);
  participant::set_cell(fight::participants_mut(&mut fight).borrow_mut(0), 165);
  mob::set_cell(fight::mobs_mut(&mut fight).borrow_mut(0), 164);
  (fight, ver)
}

fun p_state(fight: &Fight): (u64, u64, u64) {
  let p = fight::participants(fight).borrow(0);
  (participant::cell(p), participant::ap(p), participant::mp(p))
}

fun move_p0(fight: &mut Fight, ver: &Version, cell: u64) {
  actions::move_for_testing(fight, object::id_from_address(CHAR), cell, ver, 1000, OWNER);
}

// ╔════════════════ [ The contest fires on leaving melee ] ══════════════════ ]

#[test]
/// engine_mp1_locker0: runner agi 0 (dodge 2) vs one adjacent agi-0 mob (den 4, num 2 — the even contest);
/// draw 3234605891 % 4 = 3 ≥ 2 → TACKLED: the move is DENIED (cell holds) and the runner loses the failed
/// fraction of both pools — ceil(6·2/4)=3 AP, ceil(1·2/4)=1 MP → AP 6→3, MP 1→0. One Tackled event, no Moved.
fun move_out_of_melee_contested_and_denied() {
  let mut sc = ts::begin(OWNER);
  let (mut fight, ver) = active_adjacent_fight(&mut sc);
  participant::spend_mp(fight::participants_mut(&mut fight).borrow_mut(0), 2); // the MP this contest is priced at
  move_p0(&mut fight, &ver, 166);
  let (cell, ap, mp) = p_state(&fight);
  assert!(cell == 165, 0); // move denied — the runner never left the tackle zone
  assert!(ap == 3, 1);
  assert!(mp == 0, 2);
  assert!(event::events_by_type<fight_events::Moved>().is_empty(), 3); // a denied move never emits Moved
  let tackled = event::events_by_type<fight_events::Tackled>();
  assert!(tackled.length() == 1, 4);
  let (_fid, runner_is_mob, runner_idx, ap_lost, mp_lost, num, den) =
    fight_events::tackled_for_testing(tackled.borrow(0));
  assert!(!runner_is_mob && runner_idx == 0, 5);
  assert!(ap_lost == 3 && mp_lost == 1, 6);
  assert!(num == 2 && den == 4, 7);
  ts::return_shared(fight);
  ts::return_shared(ver);
  sc.end();
}

#[test]
/// engine_escape_100v100: same draw (702229519), richer contest — runner agi 100 (dodge 12) vs locker agi 100
/// (den 24): roll 7 < 12 → ESCAPED. The move completes (165→167, MP 3→1), AP untouched, zero Tackled events.
fun escape_wins_the_contest_and_moves() {
  let mut sc = ts::begin(OWNER);
  let (mut fight, ver) = active_adjacent_fight(&mut sc);
  participant::set_stats_for_testing(fight::participants_mut(&mut fight).borrow_mut(0), agi_stats(100));
  mob::set_stats_for_testing(fight::mobs_mut(&mut fight).borrow_mut(0), agi_stats(100));
  move_p0(&mut fight, &ver, 167);
  let (cell, ap, mp) = p_state(&fight);
  assert!(cell == 167, 0);
  assert!(ap == 6 && mp == 1, 1);
  assert!(event::events_by_type<fight_events::Tackled>().is_empty(), 2);
  ts::return_shared(fight);
  ts::return_shared(ver);
  sc.end();
}

#[test]
/// Dodge ≥ 2·lock is a CERTAIN escape (num == den — the min() cap): runner agi 40 (dodge 6) vs agi-0 locker
/// (den 4): every roll < num. Move completes, pools clean. (sim fight_actions.js:71 `min(den_i, dodge)`.)
fun certain_escape_at_double_lock() {
  let mut sc = ts::begin(OWNER);
  let (mut fight, ver) = active_adjacent_fight(&mut sc);
  participant::set_stats_for_testing(fight::participants_mut(&mut fight).borrow_mut(0), agi_stats(40));
  move_p0(&mut fight, &ver, 167);
  let (cell, ap, mp) = p_state(&fight);
  assert!(cell == 167 && ap == 6 && mp == 1, 0);
  assert!(event::events_by_type<fight_events::Tackled>().is_empty(), 1);
  ts::return_shared(fight);
  ts::return_shared(ver);
  sc.end();
}

#[test]
/// A DEAD adjacent enemy exerts no tackle zone (sim fight_actions.js:34 `health > 0` filter): kill the mob,
/// then walk away freely — no contest, no penalty, no event.
fun dead_tackler_never_locks() {
  let mut sc = ts::begin(OWNER);
  let (mut fight, ver) = active_adjacent_fight(&mut sc);
  let hp = mob::hp(fight::mobs(&fight).borrow(0));
  mob::damage(fight::mobs_mut(&mut fight).borrow_mut(0), hp);
  move_p0(&mut fight, &ver, 167);
  let (cell, ap, mp) = p_state(&fight);
  assert!(cell == 167 && ap == 6 && mp == 1, 0);
  assert!(event::events_by_type<fight_events::Tackled>().is_empty(), 1);
  ts::return_shared(fight);
  ts::return_shared(ver);
  sc.end();
}

#[test]
/// INVISIBILITY never exempts a tackler — bodies are physical (displacement.move add_living_bodies: invisible
/// fighters still block cells; the sim rule carries no visibility filter). An invisible adjacent mob tackles
/// exactly like a visible one — and the Tackled event leaks only what the block already proves.
fun invisible_tackler_still_locks() {
  let mut sc = ts::begin(OWNER);
  let (mut fight, ver) = active_adjacent_fight(&mut sc);
  let inv = spell_effect::new_effect(
    spell_effect::k_invisibility(), spell::el_none(), 0, spell_effect::shape_point(), 0,
    spell_effect::tf_none(), 100, 3, 0, 0, spell_effect::phase_on_enter(),
  );
  spell_board::add_status(fight::fx_mut(&mut fight), MOB_FID, 0, inv);
  assert!(statuses::is_invisible(&fight, true, 0), 0);
  participant::spend_mp(fight::participants_mut(&mut fight).borrow_mut(0), 2);
  move_p0(&mut fight, &ver, 166);
  let (cell, ap, mp) = p_state(&fight);
  assert!(cell == 165 && ap == 3 && mp == 0, 1); // engine_mp1_locker0 numbers — invisibility changed nothing
  assert!(event::events_by_type<fight_events::Tackled>().length() == 1, 2);
  ts::return_shared(fight);
  ts::return_shared(ver);
  sc.end();
}

// ╔════════════════ [ Re-attempts reprice — the MP-bound roll ] ══════════════ ]

#[test]
/// THE ROLL IS MP-BOUND, which is what makes a failed escape RE-PRICE the next attempt: the tackle state folds
/// the runner's live MP, and MP strictly decreases on every failure, so a retry can never be the same roll
/// again. Identical runner, identical locker, identical slot — only the MP differs:
///   mp 3 (slot 0): draw 582013873 % 4 = 1 < 2 → ESCAPES, and the move completes
///   mp 1 (slot 0): draw 3234605891 % 4 = 3 ≥ 2 → TACKLED, AP 6→3, MP 1→0
/// Two runs of the same contest, two verdicts — this half wins, the next one loses. (The old seed happened to
/// make both attempts fail in one cascade; the property under test is the MP binding, never that pair.)
fun escape_at_full_mp_wins_this_contest() {
  let mut sc = ts::begin(OWNER);
  let (mut fight, ver) = active_adjacent_fight(&mut sc);
  move_p0(&mut fight, &ver, 167); // full MP: this contest is won and the move completes
  let (cell, ap, mp) = p_state(&fight);
  assert!(cell == 167 && ap == 6 && mp == 1, 0);
  assert!(event::events_by_type<fight_events::Tackled>().is_empty(), 1);
  ts::return_shared(fight);
  ts::return_shared(ver);
  sc.end();
}

#[test]
/// …and the SAME contest priced at 1 MP is LOST. Same runner, same locker, same slot — only the pool differs,
/// which is exactly the repricing: a failed escape lowers MP, and the next roll moves with it.
fun failed_escape_reprices_the_next_attempt() {
  let mut sc = ts::begin(OWNER);
  let (mut fight, ver) = active_adjacent_fight(&mut sc);
  participant::spend_mp(fight::participants_mut(&mut fight).borrow_mut(0), 2);
  move_p0(&mut fight, &ver, 166);
  let (cell, ap, mp) = p_state(&fight);
  assert!(cell == 165 && ap == 3 && mp == 0, 0);
  assert!(event::events_by_type<fight_events::Tackled>().length() == 1, 1);
  ts::return_shared(fight);
  ts::return_shared(ver);
  sc.end();
}

#[test, expected_failure(abort_code = A_EIllegalMove, location = aresrpg_fight::actions)]
/// A ZERO-MP runner cannot even attempt the contest — insufficient MP rejects BEFORE the roll (sim order:
/// fight_actions.js:59-61 precedes the adjacency scan). No penalty, no event — the move aborts EIllegalMove.
fun zero_mp_runner_cannot_attempt() {
  let mut sc = ts::begin(OWNER);
  let (mut fight, ver) = active_adjacent_fight(&mut sc);
  participant::spend_mp(fight::participants_mut(&mut fight).borrow_mut(0), 3);
  move_p0(&mut fight, &ver, 166);
  abort 9999
}

#[test, expected_failure(abort_code = A_EIllegalMove, location = aresrpg_fight::actions)]
/// An UNREACHABLE destination (cost > MP) aborts EIllegalMove even with a tackler adjacent — path legality
/// precedes the contest, so an illegal move can never be converted into a committed tackle penalty.
fun unreachable_destination_aborts_before_the_contest() {
  let mut sc = ts::begin(OWNER);
  let (mut fight, ver) = active_adjacent_fight(&mut sc);
  participant::spend_mp(fight::participants_mut(&mut fight).borrow_mut(0), 1); // MP 3→2
  move_p0(&mut fight, &ver, 168); // 3 steps east > 2 MP
  abort 9999
}

// ╔════════════════ [ Multiple tacklers — the product contest ] ══════════════ ]

#[test]
/// engine_two_lockers: two agi-0 mobs FLANK the runner (164 + 166 around 165) — per-locker fractions multiply
/// (sim fight_actions.js:67-74): num 2·2=4, den 4·4=16 (25% escape). Driven at 2 MP, where this seed's draw
/// 1529003476 % 16 = 4 ≥ 4 → tackled, AP −ceil(6·12/16)=5 → 1, MP −ceil(2·12/16)=2 → 0.
fun two_lockers_multiply_the_contest() {
  let mut sc = ts::begin(OWNER);
  stand_up(&mut sc);
  sc.next_tx(OWNER);
  {
    let mut registry = tsreg(&sc);
    let ver = sc.take_shared<Version>();
    let loot = vector[mob::new_loot_entry(object::id_from_address(LOOT), 10000, 1, 1)];
    let spec = mob::new_mob_spec(1, 1, 100, 0, 0, mob_stats(), vector[], 100, loot);
    let clock = mk_clock(&mut sc, 1000);
    fight::create_for_testing(&mut registry, object::id_from_address(WORLD), 1, 12345, 100, 200, 0, true, option::none(), &spec, 2, combatant(CHAR, 100), &ver, &clock, sc.ctx());
    clock::destroy_for_testing(clock);
    ts::return_shared(registry);
    ts::return_shared(ver);
  };
  sc.next_tx(OWNER);
  let mut fight = sc.take_shared<Fight>();
  let ver = sc.take_shared<Version>();
  let cell0 = participant::cell(fight::participants(&fight).borrow(0));
  let clock = mk_clock(&mut sc, 1000);
  turns::place_for_testing(&mut fight, object::id_from_address(CHAR), cell0, &ver, &clock, OWNER);
  clock::destroy_for_testing(clock);
  participant::set_cell(fight::participants_mut(&mut fight).borrow_mut(0), 165);
  mob::set_cell(fight::mobs_mut(&mut fight).borrow_mut(0), 164);
  mob::set_cell(fight::mobs_mut(&mut fight).borrow_mut(1), 166);
  participant::spend_mp(fight::participants_mut(&mut fight).borrow_mut(0), 1); // the MP this product contest is priced at
  let dest = first_open_move_neighbor(&fight, 0); // board-agnostic legal 1-step exit (N or S of the flank)
  move_p0(&mut fight, &ver, dest);
  let (cell, ap, mp) = p_state(&fight);
  assert!(cell == 165 && ap == 1 && mp == 0, 0);
  let tackled = event::events_by_type<fight_events::Tackled>();
  assert!(tackled.length() == 1, 1);
  let (_fid, _rim, _ri, ap_lost, mp_lost, num, den) = fight_events::tackled_for_testing(tackled.borrow(0));
  assert!(ap_lost == 5 && mp_lost == 2 && num == 4 && den == 16, 2);
  ts::return_shared(fight);
  ts::return_shared(ver);
  sc.end();
}

// ╔════════════════ [ Mob side — the crank-thread contest ] ══════════════════ ]

#[test]
/// A mob FORCED out of melee by its own kit (min-range 3 spell — it must back off to cast) contests the exit
/// against the adjacent player's tackle zone off the crank rng thread. Player agi 5000 → den 1004, num 2
/// (0.2% escape): the mob is tackled — cell HELD, pools drained to 0 (ceil of the 1002/1004 fraction of
/// AP 4 / MP 6), and its planned cast dies at mob_can_cast (standing distance 1 < range_min 3) so the player
/// takes zero damage. Tackled event carries runner_is_mob = true.
fun mob_backing_off_is_contested() {
  let mut sc = ts::begin(OWNER);
  stand_up(&mut sc);
  sc.next_tx(OWNER);
  {
    let mut registry = tsreg(&sc);
    let ver = sc.take_shared<Version>();
    let loot = vector[mob::new_loot_entry(object::id_from_address(LOOT), 10000, 1, 1)];
    let dmg = spell_effect::new_effect(
      spell_effect::k_damage(), spell::el_earth(), 10, spell_effect::shape_point(), 0,
      spell_effect::tf_not_team(), 100, 0, 0, 0, spell_effect::phase_on_enter(),
    );
    let kit = vector[spell_effect::new_spell_level(
      1, 2, 3, 5, false, false, false, false, 255, 255, 0, 0, false, vector[], vector[], vector[dmg], vector[],
    )];
    let spec = mob::new_mob_spec(1, 1, 500, 4, 6, mob_stats(), kit, 100, loot);
    let clock = mk_clock(&mut sc, 1000);
    fight::create_for_testing(&mut registry, object::id_from_address(WORLD), 1, 12345, 100, 200, 0, true, option::none(), &spec, 1, combatant(CHAR, 100), &ver, &clock, sc.ctx());
    clock::destroy_for_testing(clock);
    ts::return_shared(registry);
    ts::return_shared(ver);
  };
  sc.next_tx(OWNER);
  let mut fight = sc.take_shared<Fight>();
  let ver = sc.take_shared<Version>();
  let cell0 = participant::cell(fight::participants(&fight).borrow(0));
  let clock = mk_clock(&mut sc, 1000);
  turns::place_for_testing(&mut fight, object::id_from_address(CHAR), cell0, &ver, &clock, OWNER);
  clock::destroy_for_testing(clock);
  participant::set_cell(fight::participants_mut(&mut fight).borrow_mut(0), 164);
  participant::set_stats_for_testing(fight::participants_mut(&mut fight).borrow_mut(0), agi_stats(5000));
  mob::set_cell(fight::mobs_mut(&mut fight).borrow_mut(0), 165);

  turns::crank_for_testing(&mut fight, 999_999); // p0 forfeits → the mob's turn resolves off the seeded thread
  let m = fight::mobs(&fight).borrow(0);
  assert!(mob::cell(m) == 165, 0); // the escape failed — the mob never left the zone
  assert!(mob::ap(m) == 0 && mob::mp(m) == 0, 1); // ceil(4·1002/1004)=4, ceil(6·1002/1004)=6 — both pools gone
  assert!(participant::hp(fight::participants(&fight).borrow(0)) == 100, 2); // the planned cast died out-of-band
  let tackled = event::events_by_type<fight_events::Tackled>();
  assert!(tackled.length() == 1, 3);
  let (_fid, runner_is_mob, runner_idx, ap_lost, mp_lost, num, den) =
    fight_events::tackled_for_testing(tackled.borrow(0));
  assert!(runner_is_mob && runner_idx == 0, 4);
  assert!(ap_lost == 4 && mp_lost == 6 && num == 2 && den == 1004, 5);
  ts::return_shared(fight);
  ts::return_shared(ver);
  sc.end();
}
