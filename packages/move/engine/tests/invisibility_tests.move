// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// Move-side executable twins of `packages/sim/test/vectors/statuses_golden.json`.
#[test_only]
module aresrpg_fight::invisibility_tests;

use aresrpg_fight::{
  cast,
  fight::{Self, Fight},
  fight_scaffold::{combatant, create_fight, mk_clock, mob_stats, stand_up, tsreg},
  mob,
  participant,
  statuses,
  turns,
  version::Version,
};
use aresrpg_foundation::{spell, spell_board, spell_effect::{Self, Effect, SpellLevel}};
use aresrpg_spells::spell_template::SpellTemplate;
use sui::{clock, test_scenario::{Self as ts, Scenario}};

const OWNER: address = @0xA;
const OWNER2: address = @0xB;
const CHAR2: address = @0xC2;
const WORLD: address = @0x704D;
const CAST_EILLEGAL: u64 = 102;
const MOB_FID: u64 = 1_000;

fun invisibility(turns: u8, filter: u8): Effect {
  spell_effect::new_effect(
    spell_effect::k_invisibility(),
    spell::el_none(),
    0,
    spell_effect::shape_point(),
    0,
    filter,
    100,
    turns,
    0,
    0,
    spell_effect::phase_on_enter(),
  )
}

fun area_damage(base: u64): Effect {
  spell_effect::new_effect(
    spell_effect::k_damage(),
    spell::el_earth(),
    base,
    spell_effect::shape_circle(),
    1,
    spell_effect::tf_not_team(),
    100,
    0,
    0,
    0,
    spell_effect::phase_on_enter(),
  )
}

fun level(effect: Effect, min_char_level: u16): SpellLevel {
  spell_effect::new_spell_level(
    min_char_level,
    1,
    1,
    4,
    false,
    false,
    false,
    false,
    255,
    255,
    0,
    0,
    false,
    vector[],
    vector[],
    vector[effect],
    vector[],
  )
}

fun mint_spell(sc: &mut Scenario, effect: Effect) {
  sc.next_tx(OWNER);
  aresrpg_spells::version::test_init(sc.ctx());
  aresrpg_spells::admin::test_init(sc.ctx());
  aresrpg_spells::spell_template::test_init(sc.ctx());
  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<aresrpg_spells::admin::AdminCap>();
  let version = sc.take_shared<aresrpg_spells::version::Version>();
  let mut registry = sc.take_shared<aresrpg_spells::spell_template::SpellRegistry>();
  let levels = vector[
    level(effect, 1),
    level(effect, 1),
    level(effect, 1),
    level(effect, 1),
    level(effect, 1),
    level(effect, 101),
  ];
  aresrpg_spells::spell_template::mint_spell(
    &cap,
    &mut registry,
    b"senshi".to_string(),
    1,
    b"U6 status vector".to_string(),
    levels,
    0,
    0,
    &version,
    sc.ctx(),
  );
  ts::return_shared(registry);
  ts::return_shared(version);
  sc.return_to_sender(cap);
}

fun setup_spell_fight(sc: &mut Scenario, effect: Effect): (Fight, SpellTemplate) {
  stand_up(sc);
  create_fight(sc, 100, 1, 0, 1000, true, option::none());
  mint_spell(sc, effect);
  sc.next_tx(OWNER);
  (sc.take_shared<Fight>(), sc.take_shared<SpellTemplate>())
}

fun prepare_adjacent(fight: &mut Fight) {
  participant::set_cell(fight::participants_mut(fight).borrow_mut(0), 164);
  mob::set_cell(fight::mobs_mut(fight).borrow_mut(0), 165);
  participant::begin_turn(fight::participants_mut(fight).borrow_mut(0), 0, 0, 0, 0);
}

fun finish_spell(sc: Scenario, fight: Fight, spell: SpellTemplate) {
  ts::return_shared(fight);
  ts::return_shared(spell);
  sc.end();
}

#[test]
/// Vector: reveal_strips_invisibility_only.
fun reveal_strips_invisibility_only() {
  let mut sc = ts::begin(OWNER);
  stand_up(&mut sc);
  create_fight(&mut sc, 100, 1, 0, 1000, true, option::none());
  sc.next_tx(OWNER);
  let mut fight = sc.take_shared<Fight>();
  let inv = invisibility(3, spell_effect::tf_not_enemy());
  let mp_rider = spell_effect::credit_row(spell_effect::point_mp(), 2, 3);
  let ap_rider = spell_effect::credit_row(spell_effect::point_ap(), 1, 2);
  spell_board::add_status(fight::fx_mut(&mut fight), 0, 0, inv);
  spell_board::add_status(fight::fx_mut(&mut fight), 0, 0, mp_rider);
  spell_board::add_status(fight::fx_mut(&mut fight), 0, 0, ap_rider);

  statuses::reveal(&mut fight, false, 0);

  assert!(!statuses::is_invisible(&fight, false, 0));
  let first_rider = spell_board::fighter_status_of(fight::fx(&fight), 0, spell_effect::k_give_points());
  assert!(first_rider.is_some());
  assert!(spell_effect::stat(&first_rider.destroy_some()) == spell_effect::point_mp());
  assert!(spell_board::status_count(fight::fx(&fight)) == 2);
  ts::return_shared(fight);
  sc.end();
}

#[test, expected_failure(abort_code = CAST_EILLEGAL, location = aresrpg_fight::cast)]
/// Vector: direct_point_enemy_rejected_write_free (Move abort rolls every AP/history write back).
fun direct_point_enemy_rejected_write_free() {
  let mut sc = ts::begin(OWNER);
  let (mut fight, spell) = setup_spell_fight(&mut sc, spell_effect::damage(spell::el_earth(), 20));
  prepare_adjacent(&mut fight);
  spell_board::add_status(fight::fx_mut(&mut fight), MOB_FID, 0, invisibility(3, spell_effect::tf_none()));
  cast::resolve_player_cast(&mut fight, 0, &spell, 165);
  abort 0
}

#[test]
/// Vectors: aoe_cell_hits_invisible; invisible_victim_stays_invisible.
fun aoe_cell_hits_invisible_without_revealing_victim() {
  let mut sc = ts::begin(OWNER);
  let (mut fight, spell) = setup_spell_fight(&mut sc, area_damage(20));
  participant::set_cell(fight::participants_mut(&mut fight).borrow_mut(0), 164);
  mob::set_cell(fight::mobs_mut(&mut fight).borrow_mut(0), 166);
  participant::begin_turn(fight::participants_mut(&mut fight).borrow_mut(0), 0, 0, 0, 0);
  spell_board::add_status(fight::fx_mut(&mut fight), MOB_FID, 0, invisibility(3, spell_effect::tf_none()));

  cast::resolve_player_cast(&mut fight, 0, &spell, 165);

  assert!(mob::hp(fight::mobs(&fight).borrow(0)) == 80);
  assert!(statuses::is_invisible(&fight, true, 0));
  finish_spell(sc, fight, spell);
}

#[test]
/// Vector: direct_positive_damage_reveals_damager_only.
fun direct_positive_damage_reveals_damager_only() {
  let mut sc = ts::begin(OWNER);
  let (mut fight, spell) = setup_spell_fight(&mut sc, spell_effect::damage(spell::el_earth(), 20));
  prepare_adjacent(&mut fight);
  spell_board::add_status(fight::fx_mut(&mut fight), 0, 0, invisibility(3, spell_effect::tf_none()));
  spell_board::add_status(
    fight::fx_mut(&mut fight),
    0,
    0,
    spell_effect::credit_row(spell_effect::point_mp(), 2, 3),
  );

  cast::resolve_player_cast(&mut fight, 0, &spell, 165);

  assert!(!statuses::is_invisible(&fight, false, 0));
  assert!(spell_board::fighter_status_of(fight::fx(&fight), 0, spell_effect::k_give_points()).is_some());
  assert!(mob::hp(fight::mobs(&fight).borrow(0)) == 80);
  finish_spell(sc, fight, spell);
}

#[test]
/// Vector: zero_damage_keeps_invisibility.
fun zero_damage_keeps_invisibility() {
  let mut sc = ts::begin(OWNER);
  let (mut fight, spell) = setup_spell_fight(&mut sc, spell_effect::damage(spell::el_earth(), 0));
  prepare_adjacent(&mut fight);
  spell_board::add_status(fight::fx_mut(&mut fight), 0, 0, invisibility(3, spell_effect::tf_none()));

  cast::resolve_player_cast(&mut fight, 0, &spell, 165);

  assert!(statuses::is_invisible(&fight, false, 0));
  finish_spell(sc, fight, spell);
}

#[test]
/// Vector: trap_damage_keeps_owner_invisible.
fun trap_damage_keeps_owner_invisible() {
  let mut sc = ts::begin(OWNER);
  stand_up(&mut sc);
  create_fight(&mut sc, 100, 1, 0, 1000, true, option::none());
  sc.next_tx(OWNER);
  let mut fight = sc.take_shared<Fight>();
  mob::set_cell(fight::mobs_mut(&mut fight).borrow_mut(0), 166);
  spell_board::add_status(fight::fx_mut(&mut fight), 0, 0, invisibility(3, spell_effect::tf_none()));
  spell_board::place_trap(
    fight::fx_mut(&mut fight),
    166,
    0,
    spell_effect::shape_point(),
    0,
    vector[spell_effect::damage(spell::el_earth(), 7)],
  );

  cast::trigger_on_enter(&mut fight, true, 0);

  assert!(mob::hp(fight::mobs(&fight).borrow(0)) == 93);
  assert!(statuses::is_invisible(&fight, false, 0));
  ts::return_shared(fight);
  sc.end();
}

#[test]
/// Vector: direct_push_collision_reveals.
fun direct_push_collision_reveals() {
  let mut sc = ts::begin(OWNER);
  let (mut fight, spell) = setup_spell_fight(&mut sc, spell_effect::push(2));
  fight::join_with_cap_for_testing(&mut fight, combatant(CHAR2, 100), OWNER2, 0);
  participant::set_cell(fight::participants_mut(&mut fight).borrow_mut(0), 102);
  participant::set_level_for_testing(fight::participants_mut(&mut fight).borrow_mut(0), 50);
  participant::set_cell(fight::participants_mut(&mut fight).borrow_mut(1), 104);
  participant::begin_turn(fight::participants_mut(&mut fight).borrow_mut(0), 0, 0, 0, 0);
  mob::set_cell(fight::mobs_mut(&mut fight).borrow_mut(0), 103);
  spell_board::add_status(fight::fx_mut(&mut fight), 0, 0, invisibility(3, spell_effect::tf_none()));

  cast::resolve_player_cast(&mut fight, 0, &spell, 103);

  assert!(mob::cell(fight::mobs(&fight).borrow(0)) == 103);
  assert!(mob::hp(fight::mobs(&fight).borrow(0)) < 100);
  assert!(!statuses::is_invisible(&fight, false, 0));
  finish_spell(sc, fight, spell);
}

#[test]
/// Vectors: mob_skips_invisible_target; all_targets_invisible_mob_idles_and_ticks.
fun mob_target_input_excludes_hidden_and_all_hidden_idles_with_expiry() {
  let mut sc = ts::begin(OWNER);
  stand_up(&mut sc);
  create_fight(&mut sc, 100, 1, 0, 1000, true, option::none());
  sc.next_tx(OWNER);
  let mut fight = sc.take_shared<Fight>();
  fight::join_with_cap_for_testing(&mut fight, combatant(CHAR2, 100), OWNER2, 0);
  participant::set_cell(fight::participants_mut(&mut fight).borrow_mut(0), 100);
  participant::set_cell(fight::participants_mut(&mut fight).borrow_mut(1), 200);
  spell_board::add_status(fight::fx_mut(&mut fight), 0, 0, invisibility(3, spell_effect::tf_none()));
  let visible = turns::visible_player_cells_for_testing(&fight);
  assert!(visible.length() == 1 && *visible.borrow(0) == 200);
  spell_board::add_status(fight::fx_mut(&mut fight), 1, 0, invisibility(3, spell_effect::tf_none()));
  spell_board::add_status(
    fight::fx_mut(&mut fight),
    MOB_FID,
    MOB_FID,
    spell_effect::new_effect(
      spell_effect::k_apply_state(),
      spell::el_none(),
      7,
      spell_effect::shape_point(),
      0,
      spell_effect::tf_none(),
      100,
      1,
      0,
      0,
      spell_effect::phase_on_enter(),
    ),
  );
  let before = mob::cell(fight::mobs(&fight).borrow(0));
  let mut rng = 7;

  turns::resolve_mob_turn_for_testing(&mut fight, 0, &mut rng);

  assert!(mob::cell(fight::mobs(&fight).borrow(0)) == before);
  assert!(spell_board::fighter_status_of(fight::fx(&fight), MOB_FID, spell_effect::k_apply_state()).is_none());
  ts::return_shared(fight);
  sc.end();
}

fun mob_level(effect: Effect): SpellLevel {
  spell_effect::new_spell_level(
    1, 1, 0, 4, false, false, false, false, 255, 255, 0, 0, false, vector[], vector[], vector[effect], vector[],
  )
}

#[test]
/// Vector: mob_direct_damage_reveals.
fun mob_invisibility_applies_then_direct_damage_reveals() {
  let mut sc = ts::begin(OWNER);
  stand_up(&mut sc);
  sc.next_tx(OWNER);
  let mut registry = tsreg(&sc);
  let version = sc.take_shared<Version>();
  let clock = mk_clock(&mut sc, 1000);
  let kit = vector[
    mob_level(invisibility(3, spell_effect::tf_not_enemy())),
    mob_level(spell_effect::damage(spell::el_earth(), 20)),
  ];
  let spec = mob::new_mob_spec(1, 1, 100, 6, 3, mob_stats(), kit, 100, vector[]);
  fight::create_for_testing(
    &mut registry,
    object::id_from_address(WORLD),
    1,
    12345,
    100,
    200,
    0,
    true,
    option::none(),
    &spec,
    1,
    combatant(@0xC0, 100),
    &version,
    &clock,
    sc.ctx(),
  );
  clock::destroy_for_testing(clock);
  ts::return_shared(registry);
  ts::return_shared(version);
  sc.next_tx(OWNER);
  let mut fight = sc.take_shared<Fight>();
  participant::set_cell(fight::participants_mut(&mut fight).borrow_mut(0), 164);
  mob::set_cell(fight::mobs_mut(&mut fight).borrow_mut(0), 165);
  let mut rng = 7;

  cast::resolve_mob_cast(&mut fight, 0, 0, 165, &mut rng);
  assert!(statuses::is_invisible(&fight, true, 0));
  cast::resolve_mob_cast(&mut fight, 0, 1, 164, &mut rng);

  assert!(participant::hp(fight::participants(&fight).borrow(0)) == 80);
  assert!(!statuses::is_invisible(&fight, true, 0));
  ts::return_shared(fight);
  sc.end();
}
