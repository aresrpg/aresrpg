// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// #2153 — ONLY_CASTER is a caster-selection mask, not a zone-intersection mask. The chain twin of
/// `packages/sim/test/caster_target_zone_bypass.test.js`; both readers drive the cells and rows recorded in
/// `packages/sim/test/fixtures/caster_target_zone_bypass.json` through their real cast resolver doors.
#[test_only]
module aresrpg_fight::caster_target_zone_bypass_tests;

use aresrpg_fight::{cast, fight::{Self, Fight}, mob::{Self, MobSpec}, participant, version::Version};
use aresrpg_fight::fight_scaffold::{combatant, mk_clock, stand_up, tsregs_for};
use aresrpg_foundation::{combat_grid, spell::{Self, Stats}, spell_board, spell_effect::{Self, Effect, SpellLevel}};
use sui::{clock, test_scenario::{Self as ts, Scenario}};

const OWNER: address = @0xA;
const CHAR: address = @0xC0;
const WORLD: address = @0x704D;
const CASTER_MOB_FID: u64 = 1_000;
// Shared fixture: caster mob (0,5), ally mob (5,5), enemy player (6,5), cell = y*20 + x. The aimed radius-1
// circle contains ally and enemy, but the caster is six cells away and therefore outside it.
const CASTER_MOB_CELL: u64 = 100;
const ALLY_MOB_CELL: u64 = 105;
const PLAYER_CELL: u64 = 106;
const NAMED_STATE: u16 = 788;
const ZONE_DAMAGE: u64 = 20;

fun z(): Stats { spell::new_stats(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0) }

fun only_caster_state(): Effect {
  spell_effect::new_effect(
    spell_effect::k_apply_state(), spell::el_none(), NAMED_STATE as u64, spell_effect::shape_circle(), 1,
    spell_effect::tf_only_caster(), 100, 5, 0, 0, spell_effect::phase_on_enter(),
  )
}

fun not_enemy_zone_damage(): Effect {
  spell_effect::new_effect(
    spell_effect::k_damage(), spell::el_fire(), ZONE_DAMAGE, spell_effect::shape_circle(), 1,
    spell_effect::tf_not_enemy(), 100, 0, 0, 0, spell_effect::phase_on_enter(),
  )
}

fun level(): SpellLevel {
  spell_effect::new_spell_level(
    1, 0, 0, 40, false, false, false, false, 255, 255, 0, 0, false, vector[], vector[],
    vector[only_caster_state(), not_enemy_zone_damage()], vector[],
  )
}

fun spec(): MobSpec { mob::new_mob_spec(1, 1, 500, 6, 6, z(), vector[level()], 100, vector[]) }

fun fight_with_two_mobs(sc: &mut Scenario): Fight {
  stand_up(sc);
  sc.next_tx(OWNER);
  let (mut registry, mut latch) = tsregs_for(sc, object::id_from_address(WORLD), object::id_from_address(CHAR));
  let ver = sc.take_shared<Version>();
  let clock = mk_clock(sc, 1000);
  fight::create_for_testing(
    &mut registry, &mut latch, object::id_from_address(WORLD), 1, 12345, 100, 200, 0, true,
    option::none(), &spec(), 2, combatant(CHAR, 1000), &ver, &clock, sc.ctx(),
  );
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
fun fixture_zone_excludes_caster_but_contains_ally_and_enemy() {
  let zone = combat_grid::zone_cells(spell_effect::shape_circle(), 1, PLAYER_CELL, CASTER_MOB_CELL);
  assert!(zone == vector[86, 105, 106, 107, 126], 0);
  let caster = CASTER_MOB_CELL;
  let ally = ALLY_MOB_CELL;
  let enemy = PLAYER_CELL;
  assert!(!zone.contains(&caster), 1);
  assert!(zone.contains(&ally) && zone.contains(&enemy), 2);
}

#[test]
fun only_caster_bypasses_zone_while_not_enemy_stays_in_zone() {
  let mut sc = ts::begin(OWNER);
  let mut fight = fight_with_two_mobs(&mut sc);
  let caster_hp = mob::hp(fight::mobs(&fight).borrow(0));
  let ally_hp = mob::hp(fight::mobs(&fight).borrow(1));
  let player_hp = participant::hp(fight::participants(&fight).borrow(0));
  let mut rng = 1u64;
  cast::resolve_mob_cast(&mut fight, 0, 0, PLAYER_CELL, &mut rng);

  assert!(spell_board::fighter_has_state(fight::fx(&fight), CASTER_MOB_FID, NAMED_STATE), 0);
  assert!(mob::hp(fight::mobs(&fight).borrow(0)) == caster_hp, 1);
  assert!(mob::hp(fight::mobs(&fight).borrow(1)) == ally_hp - ZONE_DAMAGE, 2);
  assert!(participant::hp(fight::participants(&fight).borrow(0)) == player_hp, 3);
  ts::return_shared(fight);
  sc.end();
}
