// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// #1809 — SPLASH MEMBERSHIP INTERSECTS `target_filter`. A mob zone cast whose resolved cells cover the CASTER's
/// own cell must never land on the caster (nor on its mob allies) when the effect is authored enemies-only
/// (`tf_not_team`). The chain twin of `packages/sim/test/aoe_target_filter_splash.test.js`; both readers drive the
/// SAME fixture row (`packages/sim/test/fixtures/aoe_splash_target_filter.json`).
#[test_only]
module aresrpg_fight::aoe_target_filter_tests;

use aresrpg_fight::{cast, fight::{Self, Fight}, mob::{Self, MobSpec}, participant, version::Version};
use aresrpg_fight::fight_scaffold::{combatant, mk_clock, stand_up, tsregs_for};
use aresrpg_foundation::{combat_grid, spell::{Self, Stats}, spell_effect::{Self, Effect, SpellLevel}};
use sui::{clock, test_scenario::{Self as ts, Scenario}};

const OWNER: address = @0xA;
const CHAR: address = @0xC0;
const WORLD: address = @0x704D;
// (6,5) player, (5,5) caster mob, (4,5) ally mob — cell = y*20 + x. The cast aims at the PLAYER's cell and its
// radius-2 circle swallows all three bodies, so the only thing standing between the caster and its own damage
// is the target filter.
const PLAYER_CELL: u64 = 106;
const CASTER_MOB_CELL: u64 = 105;
const ALLY_MOB_CELL: u64 = 104;

fun z(): Stats { spell::new_stats(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0) }

/// A single enemies-only damage line over a radius-2 circle — the shape of the reported Devastating Slam row
/// (`{area_shape:1, area_size:2, target_filter:1, kind:0}`), fixed value so the assertion needs no roll math.
fun zone_damage(value: u64): Effect {
  spell_effect::new_effect(
    spell_effect::k_damage(), spell::el_fire(), value, spell_effect::shape_circle(), 2,
    spell_effect::tf_not_team(), 100, 0, 0, 0, spell_effect::phase_on_enter(),
  )
}

fun single(effect: Effect): SpellLevel {
  spell_effect::new_spell_level(1, 0, 0, 40, false, false, false, false, 255, 255, 0, 0, false, vector[], vector[], vector[effect], vector[])
}

fun spec(hp: u64, kit: vector<SpellLevel>): MobSpec {
  mob::new_mob_spec(1, 1, hp, 6, 6, z(), kit, 100, vector[])
}

fun two_mobs(sc: &mut Scenario, s: MobSpec): Fight {
  stand_up(sc);
  sc.next_tx(OWNER);
  let (mut registry, mut latch) = tsregs_for(sc, object::id_from_address(WORLD), object::id_from_address(CHAR));
  let ver = sc.take_shared<Version>();
  let clock = mk_clock(sc, 1000);
  fight::create_for_testing(&mut registry, &mut latch, object::id_from_address(WORLD), 1, 12345, 100, 200, 0, true, option::none(), &s, 2, combatant(CHAR, 1000), &ver, &clock, sc.ctx());
  clock::destroy_for_testing(clock);
  ts::return_shared(latch);
  ts::return_shared(registry);
  ts::return_shared(ver);
  sc.next_tx(OWNER);
  let mut fight = sc.take_shared<Fight>();
  participant::set_cell(fight::participants_mut(&mut fight).borrow_mut(0), PLAYER_CELL);
  mob::set_cell(fight::mobs_mut(&mut fight).borrow_mut(0), CASTER_MOB_CELL);
  mob::set_cell(fight::mobs_mut(&mut fight).borrow_mut(1), ALLY_MOB_CELL);
  fight
}

#[test]
/// The fixture's `zone_cells` row, chain side — the geometry really does swallow the caster and its ally, so the
/// filter is the only thing under test in the drive below.
fun the_zone_really_covers_the_caster_and_its_ally() {
  let zone = combat_grid::zone_cells(spell_effect::shape_circle(), 2, PLAYER_CELL, CASTER_MOB_CELL);
  assert!(zone == vector[66, 85, 86, 87, 104, 105, 106, 107, 108, 125, 126, 127, 146], 0);
  let caster = CASTER_MOB_CELL;
  let ally = ALLY_MOB_CELL;
  assert!(zone.contains(&caster) && zone.contains(&ally), 1);
}

#[test]
/// The caster mob and its ally stand INSIDE their own zone; only the player bleeds.
fun enemies_only_zone_never_splashes_the_caster_or_its_allies() {
  let mut sc = ts::begin(OWNER);
  let mut fight = two_mobs(&mut sc, spec(500, vector[single(zone_damage(36))]));
  let player_hp = participant::hp(fight::participants(&fight).borrow(0));
  let caster_hp = mob::hp(fight::mobs(&fight).borrow(0));
  let ally_hp = mob::hp(fight::mobs(&fight).borrow(1));
  let mut rng = 1u64;
  cast::resolve_mob_cast(&mut fight, 0, 0, PLAYER_CELL, &mut rng);
  assert!(participant::hp(fight::participants(&fight).borrow(0)) < player_hp, 0); // the enemy took the zone
  assert!(mob::hp(fight::mobs(&fight).borrow(0)) == caster_hp, 1); // the caster did NOT
  assert!(mob::hp(fight::mobs(&fight).borrow(1)) == ally_hp, 2); // nor its ally
  ts::return_shared(fight);
  sc.end();
}
