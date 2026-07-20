// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// RED-FIRST: mob spell cooldown / per-turn enforcement in `resolve_mob_cast` — the chain gaining the enforcement
/// @aresrpg/sim already models uniformly (`check_cast_limits`). At HEAD the mob path recorded nothing and gated
/// nothing, so a cooldown-violating mob cast succeeded on-chain while the client refused it (the divergence).
/// The refusal surface is `mob_can_cast` (the non-aborting mob-plan gate — a crank-driven cast must skip, never
/// abort the turn); the record lands in `resolve_mob_cast`. Clock = the mob's own turn (`action_envelope::mob_turn`,
/// == the sim's per-round `turn_number`).
#[test_only]
module aresrpg_fight::mob_cooldown_tests;

use aresrpg_fight::{
  cast,
  fight::{Self, Fight},
  fight_scaffold::{combatant, mk_clock, plain_stats, stand_up, tsreg},
  mob,
  participant,
  version::Version,
};
use aresrpg_foundation::{spell, spell_effect::{Self, SpellLevel}};
use sui::{clock, test_scenario::{Self as ts, Scenario}};

const OWNER: address = @0xA;
const CHAR: address = @0xC0;
const WORLD: address = @0x704D;
const PLAYER_CELL: u64 = 164;
const MOB_CELL: u64 = 165;

// A kit spell: 4 AP, range 1, deals 10 earth damage, cooldown `cd`, per-turn `per_turn`, per-target unlimited.
fun kit_level(cd: u8, per_turn: u8): SpellLevel {
  spell_effect::new_spell_level(
    1, 4, 1, 4, false, false, false, false, per_turn, 255, cd, 0, false,
    vector[], vector[], vector[spell_effect::damage(spell::el_earth(), 10)], vector[],
  )
}

fun fresh_fight(sc: &mut Scenario, cd: u8, per_turn: u8): Fight {
  stand_up(sc);
  sc.next_tx(OWNER);
  let mut registry = tsreg(sc);
  let version = sc.take_shared<Version>();
  let clock = mk_clock(sc, 1_000);
  let spec = mob::new_mob_spec(
    1, 1, 100, 6, 0, plain_stats(), vector[kit_level(cd, per_turn)], 100, vector[],
  );
  fight::create_for_testing(
    &mut registry, object::id_from_address(WORLD), 1, 12_345, 100, 200, 0, true, option::none(),
    &spec, 1, combatant(CHAR, 100), &version, &clock, sc.ctx(),
  );
  clock::destroy_for_testing(clock);
  ts::return_shared(registry);
  ts::return_shared(version);
  sc.next_tx(OWNER);
  let mut fight = sc.take_shared<Fight>();
  participant::set_cell(fight::participants_mut(&mut fight).borrow_mut(0), PLAYER_CELL);
  mob::set_cell(fight::mobs_mut(&mut fight).borrow_mut(0), MOB_CELL);
  fight
}

// Advance the mob one turn: refill AP + bump its turn clock, exactly as `resolve_mob_turn` does. 8 AP funds TWO
// 4-AP casts, so the per-turn-cap test is isolated from AP exhaustion (only the cap can stop the second cast).
fun begin_mob_turn(fight: &mut Fight) {
  mob::begin_turn(fight::mobs_mut(fight).borrow_mut(0), 8, 0, 0, 0, 0, 0);
  cast::note_mob_turn(fight, 0);
}

fun player_hp(fight: &Fight): u64 {
  participant::hp(fight::participants(fight).borrow(0))
}

#[test]
fun mob_cooldown_refuses_recast_inside_window_then_allows_after() {
  let mut sc = ts::begin(OWNER);
  let mut fight = fresh_fight(&mut sc, 2, 255); // cooldown 2 turns, per-turn unlimited
  let mut rng = 91;

  // Turn 1 — first-ever cast passes; lands 10 damage; records last_turn = 1.
  begin_mob_turn(&mut fight);
  assert!(cast::mob_can_cast(&fight, 0, 0, PLAYER_CELL), 0);
  cast::resolve_mob_cast(&mut fight, 0, 0, PLAYER_CELL, &mut rng);
  assert!(player_hp(&fight) == 90, 1);

  // Turn 2 — 2 − 1 = 1, NOT > 2 → still on cooldown → the gate REFUSES (RED at HEAD: it returned true).
  begin_mob_turn(&mut fight);
  assert!(!cast::mob_can_cast(&fight, 0, 0, PLAYER_CELL), 2);

  // Turn 3 — 3 − 1 = 2, NOT > 2 → still refused.
  begin_mob_turn(&mut fight);
  assert!(!cast::mob_can_cast(&fight, 0, 0, PLAYER_CELL), 3);

  // Turn 4 — 4 − 1 = 3 > 2 → the cooldown has elapsed → a lawful-cadence cast lands again.
  begin_mob_turn(&mut fight);
  assert!(cast::mob_can_cast(&fight, 0, 0, PLAYER_CELL), 4);
  cast::resolve_mob_cast(&mut fight, 0, 0, PLAYER_CELL, &mut rng);
  assert!(player_hp(&fight) == 80, 5); // only the two lawful casts landed

  ts::return_shared(fight);
  sc.end();
}

#[test]
fun mob_per_turn_cap_refuses_second_cast_same_turn() {
  let mut sc = ts::begin(OWNER);
  let mut fight = fresh_fight(&mut sc, 0, 1); // no cooldown, at most ONE cast per turn (mob has 8 AP for 2× 4-AP casts)
  let mut rng = 7;

  begin_mob_turn(&mut fight);
  assert!(cast::mob_can_cast(&fight, 0, 0, PLAYER_CELL), 0);
  cast::resolve_mob_cast(&mut fight, 0, 0, PLAYER_CELL, &mut rng); // records casts_this_turn = 1 at turn 1
  // Same turn, per_turn = 1 already reached → the gate refuses the second cast (RED at HEAD).
  assert!(!cast::mob_can_cast(&fight, 0, 0, PLAYER_CELL), 1);
  assert!(player_hp(&fight) == 90, 2);

  // Next turn — the per-turn counter resets lazily → castable again.
  begin_mob_turn(&mut fight);
  assert!(cast::mob_can_cast(&fight, 0, 0, PLAYER_CELL), 3);

  ts::return_shared(fight);
  sc.end();
}
