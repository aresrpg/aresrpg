// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// Move-side executable twins of `packages/sim/test/vectors/equipment_stats_golden.json` for fight handoffs.
#[test_only]
module aresrpg_fight::equipment_stats_golden_tests;

use aresrpg_fight::{actions, cast, fight::{Self, Fight}, mob, participant, turns, version::Version};
use aresrpg_fight::fight_scaffold::{create_fight_weapon, mk_clock, stand_up, weapon};
use aresrpg_foundation::{spell, spell_formula};
use sui::{clock, test_scenario::{Self as ts}};

const OWNER: address = @0xA;
const CHAR: address = @0xC0;

#[test]
/// Vector: action_movement_fold_into_turn_refill.
fun action_movement_fold_into_turn_refill() {
  // The game equipment fold hands 7/4 to Combatant; Participant stores those exact scalar maxima and refills them.
  let combatant = participant::new_combatant(
    object::id_from_address(CHAR),
    b"senshi".to_string(),
    1,
    spell::stats_zero(),
    100,
    100,
    7,
    4,
    weapon(),
    sui::vec_map::empty(),
  );
  let mut p = participant::new(combatant, OWNER, 0, 100);
  participant::begin_turn(&mut p, 0, 0, 0, 0);
  assert!(participant::base_ap(&p) == 7 && participant::ap(&p) == 7, 0);
  assert!(participant::base_mp(&p) == 4 && participant::mp(&p) == 4, 1);
}

#[test]
/// Vector: critical_fold_reaches_pvm_weapon.
fun critical_fold_reaches_pvm_weapon() {
  let mut sc = ts::begin(OWNER);
  stand_up(&mut sc);
  create_fight_weapon(
    &mut sc,
    500,
    1,
    1000,
    participant::new_weapon(spell::el_fire(), 50, 90, 3, 3, 40),
  );
  sc.next_tx(OWNER);
  let mut fight = sc.take_shared<Fight>();
  let ver = sc.take_shared<Version>();
  let cell0 = participant::cell(fight::participants(&fight).borrow(0));
  let clock = mk_clock(&mut sc, 1000);
  turns::place_for_testing(&mut fight, object::id_from_address(CHAR), cell0, &ver, &clock, OWNER);
  clock::destroy_for_testing(clock);
  participant::set_cell(fight::participants_mut(&mut fight).borrow_mut(0), 100);
  mob::set_cell(fight::mobs_mut(&mut fight).borrow_mut(0), 101);

  // For this seeded slot, denominator 3 (the old literal-zero fold) misses while folded critical 1 lowers it to
  // 2 and crits. This also proves the floor cannot become zero even when the folded stat exceeds the base rate.
  let mut caster_stats = spell::stats_zero();
  spell::add_stat(&mut caster_stats, 7, 1);
  participant::set_stats_for_testing(fight::participants_mut(&mut fight).borrow_mut(0), caster_stats);
  let roll = spell_formula::slot_crit_roll(fight::turn_seed_for_testing(&fight, 0), 0);
  assert!(roll == 4_673, 0);
  assert!(roll >= 10_000 / 3 && roll < 10_000 / 2, 1);
  assert!(cast::crits_with_stats(fight::turn_seed_for_testing(&fight, 0), 0, 3, &caster_stats), 2);
  let hp_before = mob::hp(fight::mobs(&fight).borrow(0));
  actions::weapon_for_testing(&mut fight, object::id_from_address(CHAR), 101, &ver, 1000, OWNER);
  assert!(hp_before - mob::hp(fight::mobs(&fight).borrow(0)) == 90, 3);

  ts::return_shared(fight);
  ts::return_shared(ver);
  sc.end();
}
