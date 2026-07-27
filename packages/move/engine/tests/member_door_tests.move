// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// THE MEMBER DOOR (#1110 amendment 3) — the hot-potato builder that lets a pack hold several species, and the
/// per-member content that makes each of them itself once the fight is running.
///
/// The security claim under test is narrow and total: a caller composes the `add_member` commands, so the ONLY
/// thing standing between a claimed pack and a substituted one is the committed roster the builder checks. Every
/// substitution shape gets its own abort here — reorder, foreign row, short roster, long roster — because each
/// one is a different way to farm a hard group's rewards off a soft group's fight.
#[test_only]
module aresrpg_fight::member_door_tests;

use aresrpg_fight::{
  fight::{Self, Fight},
  fight_scaffold::{stand_up, combatant, mk_clock, tsregs_for, mob_stats},
  mob::{Self, MobSpec},
  settlement::{Self as results, FightOutcome},
  turns,
  version::Version
};
use sui::{clock, test_scenario::{Self as ts, Scenario}};
use std::unit_test::assert_eq;

const OWNER: address = @0xA;
const CHAR: address = @0xC0;
const WORLD: address = @0x704D;
const CHICKLET: address = @0xC1; // the soft row — the one an attacker wants N of
const DRAUGR: address = @0xD1; // the hard row the pack actually committed
const LOOT_A: address = @0x1A;
const LOOT_B: address = @0x1B;

fun tid(a: address): ID { object::id_from_address(a) }

/// A species: `[min,max]` band, its own xp reward and its own one-line loot table. The whole point of a mixed
/// pack is that these differ per member.
fun species(min_level: u16, max_level: u16, xp: u64, loot_src: address, base_ap: u64): MobSpec {
  let loot = vector[mob::new_loot_entry(tid(loot_src), 10000, 1, 1)];
  mob::new_mob_spec(min_level, max_level, 100, base_ap, 3, mob_stats(), vector[], xp, loot)
}

fun chicklet(): MobSpec { species(1, 1, 10, LOOT_A, 4) }
/// The THREE-SPECIES roster `mob_graded_level_tests.move` and `spawn_compose.test.js` both pin: a real band, a
/// POINT band, a wide band. Same seed, same order — so a level that changes here changes in three places at once.
fun graded_roster(): vector<MobSpec> {
  vector[species(10, 20, 1, LOOT_A, 6), species(30, 30, 1, LOOT_A, 6), species(100, 200, 1, LOOT_A, 6)]
}
fun draugr(): MobSpec { species(50, 50, 500, LOOT_B, 9) }

/// Compose the full door: open with `committed`, add every spec in `order`, create. The two vectors are passed
/// SEPARATELY on purpose — that is exactly the freedom a PTB author has, and what the builder must police.
fun run_door(sc: &mut Scenario, spawn_id: u64, committed: vector<ID>, order: vector<ID>, specs: vector<MobSpec>) {
  sc.next_tx(OWNER);
  let (mut registry, mut latch) = tsregs_for(sc, tid(WORLD), tid(CHAR));
  let ver = sc.take_shared<Version>();
  let clock = mk_clock(sc, 1000);
  let mut build = fight::open_group_for_testing(tid(WORLD), spawn_id, 4242, 1000, committed, combatant(CHAR, 100), &ver);
  let mut i = 0;
  while (i < order.length()) {
    fight::add_member(&mut build, order[i], &specs[i]);
    i = i + 1;
  };
  fight::create_members(build, &mut registry, &mut latch, &ver, &clock, sc.ctx());
  clock::destroy_for_testing(clock);
  ts::return_shared(latch);
  ts::return_shared(registry);
  ts::return_shared(ver);
}

#[test]
/// THE PACK IS MIXED — and every member is ITSELF. Two species seat off one stream: the draugr keeps its own
/// authored level band (50, not the chicklet's 1) and its own AP base, which is the per-member kit read that
/// `turns`/`cast` now make. Before the member door this fight could only have been two chicklets or two draugrs.
fun a_mixed_pack_seats_each_member_from_its_own_spec() {
  let mut sc = ts::begin(OWNER);
  stand_up(&mut sc);
  run_door(&mut sc, 1, vector[tid(CHICKLET), tid(DRAUGR)], vector[tid(CHICKLET), tid(DRAUGR)], vector[chicklet(), draugr()]);
  sc.next_tx(OWNER);
  let fight = sc.take_shared<Fight>();
  assert_eq!(fight::mob_count(&fight), 2);
  assert_eq!(mob::level(fight::mobs(&fight).borrow(0)), 1); // the chicklet's own point band
  assert_eq!(mob::level(fight::mobs(&fight).borrow(1)), 50); // the draugr's — a shared spec could not do this
  // the per-index content door: species, kit and xp all resolve per member
  assert_eq!(fight::content_template(fight::member_content(&fight, 0)), tid(CHICKLET));
  assert_eq!(fight::content_template(fight::member_content(&fight, 1)), tid(DRAUGR));
  assert_eq!(mob::kit_base_ap(fight::content_kit(fight::member_content(&fight, 0))), 4);
  assert_eq!(mob::kit_base_ap(fight::content_kit(fight::member_content(&fight, 1))), 9);
  ts::return_shared(fight);
  sc.end();
}

#[test, expected_failure(abort_code = fight::EWrongMember)]
/// THE SWAP — the exploit the ruling names. The zone committed `[chicklet, draugr]`; the caller adds the
/// chicklet TWICE, which under a roster-blind create would have been a legal fight paying draugr rewards for a
/// chicklet's difficulty. The second `add_member` refuses: slot 1 is spoken for.
fun substituting_a_softer_row_for_a_committed_member_aborts() {
  let mut sc = ts::begin(OWNER);
  stand_up(&mut sc);
  run_door(&mut sc, 2, vector[tid(CHICKLET), tid(DRAUGR)], vector[tid(CHICKLET), tid(CHICKLET)], vector[chicklet(), chicklet()]);
  abort 0
}

#[test, expected_failure(abort_code = fight::EWrongMember)]
/// REORDERING is a swap too: the roster is positional (member `j` draws from `members[j]`), so accepting the
/// same multiset in another order would seat a different pack than the one the commitment binds.
fun adding_the_committed_members_out_of_order_aborts() {
  let mut sc = ts::begin(OWNER);
  stand_up(&mut sc);
  run_door(&mut sc, 3, vector[tid(CHICKLET), tid(DRAUGR)], vector[tid(DRAUGR), tid(CHICKLET)], vector[draugr(), chicklet()]);
  abort 0
}

#[test, expected_failure(abort_code = fight::EPartialRoster)]
/// COUNT MISMATCH (short) — stopping early would seat a smaller pack than the world advertised, so the potato
/// refuses to close.
fun creating_with_fewer_members_than_committed_aborts() {
  let mut sc = ts::begin(OWNER);
  stand_up(&mut sc);
  run_door(&mut sc, 4, vector[tid(CHICKLET), tid(DRAUGR)], vector[tid(CHICKLET)], vector[chicklet()]);
  abort 0
}

#[test, expected_failure(abort_code = fight::ERosterFull)]
/// COUNT MISMATCH (long) — there is no slot past the commitment, so a padded roster dies on the extra add
/// rather than at close.
fun adding_more_members_than_committed_aborts() {
  let mut sc = ts::begin(OWNER);
  stand_up(&mut sc);
  run_door(&mut sc, 5, vector[tid(CHICKLET)], vector[tid(CHICKLET), tid(DRAUGR)], vector[chicklet(), draugr()]);
  abort 0
}

#[test]
/// SETTLEMENT reads the pack member by member: XP is the SUM of what each species is worth (10 + 500, not the
/// primary's 10 twice), and the loot checklist is the two tables CONCATENATED and repeated once — every dead mob
/// rolls its own table exactly once, which is the same law a single-spec fight obeys with one table × N.
fun settlement_sums_member_xp_and_concatenates_member_loot() {
  let mut sc = ts::begin(OWNER);
  stand_up(&mut sc);
  run_door(&mut sc, 6, vector[tid(CHICKLET), tid(DRAUGR)], vector[tid(CHICKLET), tid(DRAUGR)], vector[chicklet(), draugr()]);
  sc.next_tx(OWNER);
  let mut fight = sc.take_shared<Fight>();
  let ver = sc.take_shared<Version>();
  turns::finish_victory_for_testing(&mut fight);
  results::settle_and_destroy(fight, &ver, sc.ctx());
  sc.next_tx(OWNER);
  let outcome = sc.take_from_sender<FightOutcome>();
  // party 1, wisdom 0, aging 0, mult 100 — so the share IS the pack's total xp through the kernel
  assert_eq!(results::xp_share(&outcome), results::xp_share_kernel(510, 1, 0, 0, 100));
  let (_b, _f, _w, _c, _o, _hp, _xp, _ag, _ch, repeats, loot, _pvp, _t, _wt, _lm) = results::unpack(outcome);
  assert_eq!(repeats, 1); // the checklist already holds one row PER MOB — repeating it would double the pack
  assert_eq!(loot.length(), 2);
  assert_eq!(mob::loot_entry_item_template(&loot[0]), tid(LOOT_A));
  assert_eq!(mob::loot_entry_item_template(&loot[1]), tid(LOOT_B)); // the draugr's own drop, unreachable before
  ts::return_shared(ver);
  sc.end();
}

#[test]
/// THE FALLBACK — the property that let 10 call-sites migrate with no branch. A fight created through the OLD
/// door has no member fields, so every index reads the shared block: content, kit and settlement shape are
/// exactly what they were, and `is_mixed` says so.
fun a_single_spec_fight_reads_the_shared_block_at_every_index() {
  let mut sc = ts::begin(OWNER);
  stand_up(&mut sc);
  sc.next_tx(OWNER);
  {
    let (mut registry, mut latch) = tsregs_for(&sc, tid(WORLD), tid(CHAR));
    let ver = sc.take_shared<Version>();
    let clock = mk_clock(&mut sc, 1000);
    fight::create_for_testing(&mut registry, &mut latch, tid(WORLD), 7, 12345, 100, 200, 0, true, option::none(), &draugr(), 3, combatant(CHAR, 100), &ver, &clock, sc.ctx());
    clock::destroy_for_testing(clock);
    ts::return_shared(latch);
    ts::return_shared(registry);
    ts::return_shared(ver);
  };
  sc.next_tx(OWNER);
  let fight = sc.take_shared<Fight>();
  assert!(!fight::is_mixed(&fight));
  let mut i = 0;
  while (i < fight::mob_count(&fight)) {
    assert_eq!(fight::content_xp(fight::member_content(&fight, i)), 500);
    assert_eq!(mob::kit_base_ap(fight::content_kit(fight::member_content(&fight, i))), 9);
    i = i + 1;
  };
  ts::return_shared(fight);
  sc.end();
}

/// Seat the pinned three-species roster at `progress` and return the levels the door actually seated.
fun graded_levels(sc: &mut Scenario, spawn_id: u64, progress: u64, creator: address): vector<u64> {
  let committed = vector[tid(CHICKLET), tid(DRAUGR), tid(@0xE1)];
  sc.next_tx(OWNER);
  {
    let (mut registry, mut latch) = tsregs_for(sc, tid(WORLD), tid(creator));
    let ver = sc.take_shared<Version>();
    let clock = mk_clock(sc, 1000);
    let mut build = fight::open_group_for_testing(tid(WORLD), spawn_id, 0, progress, committed, combatant(creator, 100), &ver);
    let specs = graded_roster();
    let mut i = 0;
    while (i < specs.length()) { fight::add_member(&mut build, committed[i], &specs[i]); i = i + 1; };
    fight::create_members(build, &mut registry, &mut latch, &ver, &clock, sc.ctx());
    clock::destroy_for_testing(clock);
    ts::return_shared(latch);
    ts::return_shared(registry);
    ts::return_shared(ver);
  };
  sc.next_tx(OWNER);
  let fight = sc.take_shared<Fight>();
  let mut lv = vector<u64>[];
  let mut i = 0;
  while (i < fight::mob_count(&fight)) { lv.push_back(mob::level(fight::mobs(&fight).borrow(i))); i = i + 1; };
  ts::return_shared(fight);
  lv
}

#[test]
/// THE GRADED DRAW THROUGH THE DOOR — the levels a real `create_members` seats are the ones the pure kernel
/// fixture and the CLIENT mirror (`spawn_compose.js::derive_group_members_graded`) pin off group seed 0. The
/// board's spawn-cell draw sits between two members' level draws, so this is where a stream that only looks
/// aligned in isolation comes apart: the mirror would paint a pack the chain never seated.
fun the_door_seats_the_levels_the_client_mirror_predicts() {
  let mut sc = ts::begin(OWNER);
  stand_up(&mut sc);
  assert_eq!(graded_levels(&mut sc, 20, 0, CHAR), vector<u64>[10, 30, 100]); // spawn_compose.test.js `graded_at(0)`
  assert_eq!(graded_levels(&mut sc, 21, 1000, @0xC9), vector<u64>[20, 30, 178]); // ... `graded_at(1000)`
  sc.end();
}
