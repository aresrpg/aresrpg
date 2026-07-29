// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// EFFECT PROC CHANCE — an authored `chance` under 100 is a DIE ROLL, on every effect, at every target.
///
/// `Effect.chance` has been part of the envelope since the 1.29 model (`spell_effect.move:243`, legality-checked
/// at `:348`) and `cast::effect_proc` has always known how to roll it — but the ORDINARY dispatch never asked:
/// `apply_effect` walked its zone and applied every admitted line unconditionally, so only the two arms that
/// called `effect_proc` by hand (RETURN_SPELL's board row and CRITICAL_FAILURE) were ever gated. Every other
/// kind resolved at an effective 100%.
///
/// @aresrpg/sim has always rolled it — `fight_spells.js` `apply_spell_effect` opens with `effect_triggers` — so
/// a shipped 50/50 line (the Asobi "Cold Deck" shape: two 50%-chance damage lines) predicted one outcome
/// distribution client-side and resolved with a different one on chain. The corpus is not a corner case: 216
/// authored effect rows carry `chance < 100` across 20 spells.
///
/// The @aresrpg/sim twin of this file is `packages/sim/test/effect_chance_proc.test.js`.
#[test_only]
module aresrpg_fight::effect_chance_tests;

use aresrpg_fight::{cast, fight::{Self, Fight}, mob::{Self, MobSpec}, participant, version::Version};
use aresrpg_fight::fight_scaffold::{combatant, create_fight, mk_clock, stand_up, tsregs_for};
use aresrpg_foundation::{spell::{Self, Stats}, spell_effect::{Self, Effect}};
use sui::{clock, test_scenario::{Self as ts, Scenario}};

const OWNER: address = @0xA;
const CHAR: address = @0xC0;
const WORLD: address = @0x704D;
const PLAYER_CELL: u64 = 200;
const MOB0: u64 = 100;
const MOB_HP: u64 = 1000;

fun z(): Stats { spell::new_stats(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0) }

fun spec(hp: u64): MobSpec { mob::new_mob_spec(1, 1, hp, 6, 6, z(), vector[], 100, vector[]) }

/// A fixed 20-damage neutral line at an authored proc `chance`.
fun chanced_damage(chance: u8): Effect {
  spell_effect::new_effect(
    spell_effect::k_damage(), spell::el_earth(), 20, spell_effect::shape_point(), 0,
    spell_effect::tf_not_team(), chance, 0, 0, 0, spell_effect::phase_on_enter(),
  )
}

fun mk_fight(sc: &mut Scenario, s: MobSpec) {
  sc.next_tx(OWNER);
  let (mut registry, mut latch) = tsregs_for(sc, object::id_from_address(WORLD), object::id_from_address(CHAR));
  let ver = sc.take_shared<Version>();
  let clock = mk_clock(sc, 1000);
  fight::create_for_testing(&mut registry, &mut latch, object::id_from_address(WORLD), 1, 12345, 100, 200, 0, true, option::none(), &s, 1, combatant(CHAR, 100), &ver, &clock, sc.ctx());
  clock::destroy_for_testing(clock);
  ts::return_shared(latch);
  ts::return_shared(registry);
  ts::return_shared(ver);
}

fun one_mob(sc: &mut Scenario, s: MobSpec): Fight {
  stand_up(sc);
  mk_fight(sc, s);
  sc.next_tx(OWNER);
  let mut fight = sc.take_shared<Fight>();
  participant::set_cell(fight::participants_mut(&mut fight).borrow_mut(0), PLAYER_CELL);
  mob::set_cell(fight::mobs_mut(&mut fight).borrow_mut(0), MOB0);
  fight
}

fun mob_hp(f: &Fight): u64 { mob::hp(fight::mobs(f).borrow(0)) }

/// Fire ONE chanced line at the mob from a fresh fight seeded with `rng`, and report whether it landed.
fun landed(sc: &mut Scenario, chance: u8, rng_seed: u64): bool {
  let mut fight = one_mob(sc, spec(MOB_HP));
  let ps = z();
  let mut rng = rng_seed;
  cast::apply_effect_for_testing(&mut fight, 0, 0, PLAYER_CELL, &ps, 1, MOB0, &chanced_damage(chance), &mut rng);
  let hit = mob_hp(&fight) < MOB_HP;
  ts::return_shared(fight);
  hit
}

// ══════════════════ [ the two deterministic ends ] ══════════════════

#[test]
/// chance == 0 is the hard floor: the line NEVER resolves, whatever the rng holds
/// (`effect_proc`'s `if (effect.chance() == 0) return false`). Before the ordinary path consulted the roll at
/// all, a 0%-chance damage line dealt full damage on chain.
fun zero_chance_line_never_lands() {
  let mut sc = ts::begin(OWNER);
  assert!(!landed(&mut sc, 0, 1), 0);
  assert!(!landed(&mut sc, 0, 7777), 1);
  assert!(!landed(&mut sc, 0, 123456789), 2);
  sc.end();
}

#[test]
/// chance == 100 is the other end and draws NOTHING (`if (effect.chance() >= 100) return true`) — the rng thread
/// a certain line leaves behind is byte-identical to the one before the roll existed.
fun full_chance_line_always_lands_without_drawing() {
  let mut sc = ts::begin(OWNER);
  assert!(landed(&mut sc, 100, 1), 0);
  assert!(landed(&mut sc, 100, 7777), 1);
  let mut fight = one_mob(&mut sc, spec(MOB_HP));
  let ps = z();
  let mut rng = 42u64;
  cast::apply_effect_for_testing(&mut fight, 0, 0, PLAYER_CELL, &ps, 1, MOB0, &chanced_damage(100), &mut rng);
  assert!(rng == 42, 2); // a certain line consumes no entropy
  ts::return_shared(fight);
  sc.end();
}

// ══════════════════ [ the middle: a real die ] ══════════════════

#[test]
/// A 50%-chance line fired 60 times off ONE threaded rng must land SOMETIMES and miss SOMETIMES — the property
/// the whole row is about. Before the fix this counted 60 landings out of 60 (the sim's own count over the same
/// shape is ~half), which is what made a two-line 50/50 spell a different weapon on each side of the twin.
fun half_chance_line_is_a_real_die() {
  let mut sc = ts::begin(OWNER);
  let pool = 100000;
  let mut fight = one_mob(&mut sc, spec(pool));
  let ps = z();
  let mut rng = 2654435761u64;
  let mut fired = 0;
  while (fired < 60) {
    cast::apply_effect_for_testing(&mut fight, 0, 0, PLAYER_CELL, &ps, 1, MOB0, &chanced_damage(50), &mut rng);
    fired = fired + 1;
  };
  let hits = (pool - mob_hp(&fight)) / 20;
  assert!(hits > 0, 0);
  assert!(hits < 60, 1);
  ts::return_shared(fight);
  sc.end();
}

#[test]
/// The MOB sink rolls the same die (`apply_to_player`'s twin): a mob's 0%-chance line never touches the seat.
fun zero_chance_line_from_a_mob_never_lands() {
  let mut sc = ts::begin(OWNER);
  let mut fight = one_mob(&mut sc, spec(MOB_HP));
  let ps = z();
  let mut rng = 9u64;
  let before = participant::hp(fight::participants(&fight).borrow(0));
  cast::apply_effect_for_testing(&mut fight, 1, 0, MOB0, &ps, 1, PLAYER_CELL, &chanced_damage(0), &mut rng);
  assert!(participant::hp(fight::participants(&fight).borrow(0)) == before, 0);
  ts::return_shared(fight);
  sc.end();
}
