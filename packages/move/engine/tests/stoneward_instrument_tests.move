// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// #1660 INSTRUMENT — apply the published level-1 Stoneward effect through cast's real effect sink, then land
/// the same fixed earth hit used by the no-ward control. A zero reduction is a stop verdict, never a pass.
#[test_only]
module aresrpg_fight::stoneward_instrument_tests;

use aresrpg_fight::{
  cast,
  fight::{Self, Fight},
  fight_scaffold::{create_fight, plain_stats, stand_up},
  mob,
  participant,
  retro_effects,
};
use aresrpg_foundation::{spell, spell_board, spell_effect};
use sui::test_scenario::{Self as ts};

const OWNER: address = @0xA;
const PLAYER_CELL: u64 = 82;
const MOB_CELL: u64 = 84;
const HIT: u64 = 30;
const ABSORB: u64 = 10;

fun stoneward(): spell_effect::Effect {
  spell_effect::new_effect(
    spell_effect::k_reduce_damage(),
    spell::el_earth(),
    ABSORB,
    spell_effect::shape_point(),
    0,
    spell_effect::tf_not_enemy(),
    100,
    4,
    0,
    0,
    spell_effect::phase_on_enter(),
  )
}

#[test]
fun casting_stoneward_reduces_the_same_earth_hit_the_control_takes_in_full() {
  let mut sc = ts::begin(OWNER);
  stand_up(&mut sc);
  create_fight(&mut sc, 100, 1, 0, 1000, true, option::none());

  sc.next_tx(OWNER);
  let mut fight = sc.take_shared<Fight>();
  participant::set_cell(fight::participants_mut(&mut fight).borrow_mut(0), PLAYER_CELL);
  mob::set_cell(fight::mobs_mut(&mut fight).borrow_mut(0), MOB_CELL);

  let full = participant::hp(fight::participants(&fight).borrow(0));
  let control_damage = retro_effects::hit_elemental(
    &mut fight, false, 0, true, 0, true, HIT, spell::el_earth(), 0,
  );
  assert!(control_damage == HIT, 0);
  participant::set_hp_for_testing(fight::participants_mut(&mut fight).borrow_mut(0), full);

  let stats = plain_stats();
  let mut rng = 7;
  cast::apply_effect_for_testing(
    &mut fight, 0, 0, PLAYER_CELL, &stats, 1, PLAYER_CELL, &stoneward(), &mut rng,
  );
  assert!(
    spell_board::fighter_status_rows_of(
      fight::fx(&fight), 0, spell_effect::k_reduce_damage(),
    ).length() == 1,
    1,
  );

  let warded_damage = retro_effects::hit_elemental(
    &mut fight, false, 0, true, 0, true, HIT, spell::el_earth(), 0,
  );
  assert!(warded_damage == HIT - ABSORB, 2);
  assert!(control_damage - warded_damage > 0, 3);

  ts::return_shared(fight);
  sc.end();
}
