// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// RED-FIRST mob-side identity/ordinal contract for the additive action envelope. Mob kits retain no
/// SpellTemplate object, so a receipt identifies an ability by the snapshotted group template, kit ordinal, and
/// exact SpellLevel/effect descriptors. A Fight-UID turn clock gives repeated mob actions monotonic turn keys.
#[test_only]
module aresrpg_fight::mob_action_envelope_tests;

use aresrpg_fight::{
  cast,
  fight::{Self, Fight},
  fight_events,
  fight_scaffold::{combatant, mk_clock, plain_stats, stand_up, tsreg},
  mob,
  participant,
  version::Version,
};
use aresrpg_foundation::{spell, spell_effect::{Self, Effect, SpellLevel}};
use sui::{clock, event, test_scenario::{Self as ts, Scenario}};

const OWNER: address = @0xA;
const CHAR: address = @0xC0;
const WORLD: address = @0x704D;
const PLAYER_CELL: u64 = 164;
const MOB_CELL: u64 = 165;

fun mob_level(damage: u64): SpellLevel {
  spell_effect::new_spell_level(
    1, 4, 1, 4, false, false, false, false, 255, 255, 0, 0, false,
    vector[], vector[], vector[spell_effect::damage(spell::el_earth(), damage)], vector[],
  )
}

fun fresh_fight(sc: &mut Scenario): Fight {
  stand_up(sc);
  sc.next_tx(OWNER);
  let mut registry = tsreg(sc);
  let version = sc.take_shared<Version>();
  let clock = mk_clock(sc, 1_000);
  let spec = mob::new_mob_spec(
    1, 1, 100, 6, 0, plain_stats(), vector[mob_level(99), mob_level(10)], 100, vector[],
  );
  fight::create_for_testing(
    &mut registry,
    object::id_from_address(WORLD),
    1,
    12_345,
    100,
    200,
    0,
    true,
    option::none(),
    &spec,
    1,
    combatant(CHAR, 100),
    &version,
    &clock,
    sc.ctx(),
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

fun effect_matches(left: &Effect, right: &Effect): bool {
  left.kind() == right.kind()
    && left.element() == right.element()
    && left.value() == right.value()
    && left.area_shape() == right.area_shape()
    && left.area_size() == right.area_size()
    && left.target_filter() == right.target_filter()
    && left.chance() == right.chance()
    && left.turns() == right.turns()
    && left.stat() == right.stat()
    && left.flags() == right.flags()
    && left.phase() == right.phase()
}

fun begin_mob_turn(fight: &mut Fight) {
  mob::begin_turn(fight::mobs_mut(fight).borrow_mut(0), 6, 0, 0, 0, 0, 0);
  cast::note_mob_turn(fight, 0);
}

#[test]
fun mob_actions_carry_immutable_ability_identity_and_monotonic_turns() {
  let mut sc = ts::begin(OWNER);
  let mut fight = fresh_fight(&mut sc);
  let fight_id = fight::id(&fight);
  let group_template = fight::group_template(&fight);
  let mut rng = 91;

  begin_mob_turn(&mut fight);
  cast::resolve_mob_cast(&mut fight, 0, 1, PLAYER_CELL, &mut rng);
  begin_mob_turn(&mut fight);
  cast::resolve_mob_cast(&mut fight, 0, 1, PLAYER_CELL, &mut rng);

  assert!(participant::hp(fight::participants(&fight).borrow(0)) == 80, 0);
  assert!(event::events_by_type<fight_events::Cast>().length() == 2, 1);
  let starts = event::events_by_type<fight_events::ActionStarted>();
  let markers = event::events_by_type<fight_events::ActionEffect>();
  let resolved = event::events_by_type<fight_events::ActionResolved>();
  assert!(starts.length() == 2 && markers.length() == 2 && resolved.length() == 2, 2);

  let expected_effect = spell_effect::damage(spell::el_earth(), 10);
  let mut i = 0;
  while (i < 2) {
    let envelope = resolved.borrow(i);
    let (fid, is_mob, idx, target, kind, turn, action, ap, critical, fumbled, returned) =
      fight_events::action_resolved_core_for_testing(envelope);
    assert!(fid == fight_id && is_mob && idx == 0 && target == PLAYER_CELL, 3);
    assert!(kind == fight_events::action_kind_spell() && turn == i + 1 && action == 0, 4);
    assert!(ap == 4 && !critical && !fumbled && !returned, 5);

    let (template, spell_ordinal, level) =
      fight_events::action_resolved_mob_spell_for_testing(envelope);
    assert!(template.is_some() && *template.borrow() == group_template, 6);
    assert!(spell_ordinal.is_some() && *spell_ordinal.borrow() == 1, 7);
    assert!(level.is_some() && level.borrow().sl_ap_cost() == 4, 8);
    let (_ords, descriptors) = fight_events::action_effects_of_for_testing(&markers, envelope);
    assert!(descriptors.length() == 1 && effect_matches(descriptors.borrow(0), &expected_effect), 9);
    let (player_spell, learned_level) = fight_events::action_resolved_spell_for_testing(envelope);
    assert!(player_spell.is_none() && learned_level == 0, 14);
    let (weapon_element, weapon_damage, weapon_crit_damage, weapon_crit_rate, weapon_ap, weapon_reach) =
      fight_events::action_resolved_weapon_for_testing(envelope);
    assert!(weapon_element == 0 && weapon_damage == 0 && weapon_crit_damage == 0, 15);
    assert!(weapon_crit_rate == 0 && weapon_ap == 0 && weapon_reach == 0, 16);
    let (crit_roll, crit_bound, fumble_roll, fumble_bound, rolls, bounds) =
      fight_events::action_resolved_random_for_testing(envelope);
    assert!(crit_roll == 0 && crit_bound == 0 && fumble_roll == 0 && fumble_bound == 0, 17);
    assert!(rolls.is_empty() && bounds.is_empty(), 18);
    let (domains, ordinals) = fight_events::action_resolved_random_labels_for_testing(envelope);
    assert!(domains.is_empty() && ordinals.is_empty(), 19);

    let (sf, sm, si, st, sa, sk, aimed, started_ap, count) =
      fight_events::action_started_for_testing(starts.borrow(i));
    assert!(sf == fid && sm == is_mob && si == idx && st == turn && sa == action, 10);
    assert!(sk == kind && aimed == target && started_ap == ap && count == 1, 11);
    let (ef, em, ei, et, ea, ordinal, descriptor) =
      fight_events::action_effect_for_testing(markers.borrow(i));
    assert!(ef == fid && em == is_mob && ei == idx && et == turn && ea == action, 12);
    assert!(ordinal == 0 && effect_matches(&descriptor, &expected_effect), 13);
    i = i + 1;
  };

  ts::return_shared(fight);
  sc.end();
}
