// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// RED-FIRST contract for the additive remote-action envelope. The deployed `Cast` event is frozen and remains
/// dual-emitted. A committed spell or weapon action additionally emits exactly one terminal `ActionResolved`
/// AFTER its effect events and legacy `Cast`. Its explicit action/effect ordinals make the preceding events one
/// deterministic group; identity and outcome fields let a remote client reconstruct the action without corpus
/// guesses or live Fight reads.
///
/// This file intentionally references the missing clean, unversioned event and test-only readers. Until the
/// production contract exists, failure to resolve `fight_events::ActionResolved` is the expected RED reason.
#[test_only]
module aresrpg_fight::action_envelope_tests;

use aresrpg_fight::{
  cast,
  fight::{Self, Fight},
  fight_events,
  fight_scaffold::{bag_spec, mk_clock, plain_stats, stand_up, tsreg, weapon_crit},
  mob,
  participant,
  version::Version,
};
use aresrpg_foundation::{spell, spell_board, spell_effect::{Self, Effect, SpellLevel}, spell_formula};
use aresrpg_spells::spell_template::SpellTemplate;
use sui::{clock, event, test_scenario::{Self as ts, Scenario}, vec_map};

const OWNER: address = @0xA;
const CHAR: address = @0xC0;
const WORLD: address = @0x704D;
const PLAYER_CELL: u64 = 164;
const MOB_CELL: u64 = 165;
const MOB_FID: u64 = 1_000;
const CRIT_BOUND: u64 = 10_000;

// ActionResolved schema pinned by this suite:
// core     = fight, caster side/index, target, action kind, caster-turn ordinal, pre-action ordinal, AP cost,
//            critical/fumbled/returned outcomes;
// identity = spell Option<ID> + learned level OR the immutable weapon snapshot;
// random   = raw bounded crit/fumble draws plus every additional resolver draw in resolution order;
// effects  = ordered descriptors for resolved effects; position is ordinal and each Effect carries kind.

fun grouped_level(min_level: u16): SpellLevel {
  let payload = spell_effect::new_effect(
    spell_effect::k_timed_payload(), spell::el_none(), 1,
    spell_effect::shape_point(), 0, spell_effect::tf_none(), 100, 1, 2, 0,
    spell_effect::phase_on_enter(),
  );
  let effects = vector[
    payload,
    spell_effect::damage(spell::el_earth(), (min_level as u64) * 10),
    spell_effect::push(1),
  ];
  let critical = vector[
    payload,
    spell_effect::damage(spell::el_earth(), (min_level as u64) * 10 + 5),
    spell_effect::push(2),
  ];
  spell_effect::new_spell_level(
    min_level, 2, 1, 4, false, false, false, false, 255, 255, 0, 2, false,
    vector[], vector[], effects, critical,
  )
}

fun damage_level(min_level: u16): SpellLevel {
  let effects = vector[spell_effect::damage(spell::el_earth(), (min_level as u64) * 5)];
  let critical = vector[spell_effect::damage(spell::el_earth(), (min_level as u64) * 5 + 5)];
  spell_effect::new_spell_level(
    min_level, 2, 1, 4, false, false, false, false, 255, 255, 0, 2, false,
    vector[], vector[], effects, critical,
  )
}

fun mint_spell(sc: &mut Scenario, grouped: bool) {
  sc.next_tx(OWNER);
  aresrpg_spells::version::test_init(sc.ctx());
  aresrpg_spells::admin::test_init(sc.ctx());
  aresrpg_spells::spell_template::test_init(sc.ctx());
  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<aresrpg_spells::admin::AdminCap>();
  let version = sc.take_shared<aresrpg_spells::version::Version>();
  let mut registry = sc.take_shared<aresrpg_spells::spell_template::SpellRegistry>();
  let levels = if (grouped) {
    vector[
      grouped_level(1), grouped_level(2), grouped_level(3),
      grouped_level(4), grouped_level(5), grouped_level(101),
    ]
  } else {
    vector[
      damage_level(1), damage_level(2), damage_level(3),
      damage_level(4), damage_level(5), damage_level(101),
    ]
  };
  aresrpg_spells::spell_template::mint_spell(
    &cap,
    &mut registry,
    b"senshi".to_string(),
    1,
    b"Action envelope vector".to_string(),
    levels,
    40,
    5,
    &version,
    sc.ctx(),
  );
  ts::return_shared(registry);
  ts::return_shared(version);
  sc.return_to_sender(cap);
}

/// Build a seat whose snapshotted learned level for the minted spell is 2. This makes the envelope prove it
/// carries the selected level, rather than a decorative hard-coded default.
fun learned_fight(sc: &mut Scenario, grouped: bool): (Fight, SpellTemplate) {
  stand_up(sc);
  mint_spell(sc, grouped);

  sc.next_tx(OWNER);
  let spell = sc.take_shared<SpellTemplate>();
  let spell_id = object::id(&spell);
  ts::return_shared(spell);

  let mut registry = tsreg(sc);
  let version = sc.take_shared<Version>();
  let clock = mk_clock(sc, 1_000);
  let mut learned = vec_map::empty();
  learned.insert(spell_id, 2);
  let combatant = participant::new_combatant(
    object::id_from_address(CHAR),
    b"senshi".to_string(),
    50,
    plain_stats(),
    100,
    100,
    6,
    3,
    weapon_crit(),
    learned,
  );
  let spec = bag_spec(5_000);
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
    combatant,
    &version,
    &clock,
    sc.ctx(),
  );
  clock::destroy_for_testing(clock);
  ts::return_shared(registry);
  ts::return_shared(version);

  sc.next_tx(OWNER);
  let mut fight = sc.take_shared<Fight>();
  let spell = sc.take_shared<SpellTemplate>();
  participant::set_cell(fight::participants_mut(&mut fight).borrow_mut(0), PLAYER_CELL);
  mob::set_cell(fight::mobs_mut(&mut fight).borrow_mut(0), MOB_CELL);
  fight::attach_weapon_lines(
    &mut fight,
    0,
    vector[
      participant::new_weapon_line(spell::el_fire(), 30, 45),
      participant::new_weapon_line(spell::el_water(), 20, 30),
    ],
  );
  cast::note_seat_turn(&mut fight, 0);
  participant::begin_turn(fight::participants_mut(&mut fight).borrow_mut(0), 0, 0, 0, 0);
  (fight, spell)
}

fun finish(sc: Scenario, fight: Fight, spell: SpellTemplate) {
  ts::return_shared(fight);
  ts::return_shared(spell);
  sc.end();
}

fun failure_row(denominator: u64): Effect {
  spell_effect::new_effect(
    spell_effect::k_critical_failure(), spell::el_none(), denominator,
    spell_effect::shape_point(), 0, spell_effect::tf_only_caster(), 100, 2, 0, 0,
    spell_effect::phase_on_enter(),
  )
}

fun return_row(chance: u8): Effect {
  spell_effect::new_effect(
    spell_effect::k_return_spell(), spell::el_none(), 0,
    spell_effect::shape_point(), 0, spell_effect::tf_not_team(), chance, 2, 0, 0,
    spell_effect::phase_on_enter(),
  )
}

fun assert_core(
  envelope: &fight_events::ActionResolved,
  fight_id: ID,
  target_cell: u64,
  action_kind: u8,
  action_ordinal: u64,
  ap_cost: u64,
  critical: bool,
  fumbled: bool,
  returned: bool,
) {
  let (
    got_fight, caster_is_mob, caster_idx, got_target, got_kind, turn_ordinal, got_action,
    got_ap, got_critical, got_fumbled, got_returned,
  ) = fight_events::action_resolved_core_for_testing(envelope);
  assert!(got_fight == fight_id && !caster_is_mob && caster_idx == 0, 10);
  assert!(got_target == target_cell && got_kind == action_kind, 11);
  assert!(turn_ordinal == 1 && got_action == action_ordinal, 12);
  assert!(got_ap == ap_cost, 13);
  assert!(got_critical == critical && got_fumbled == fumbled && got_returned == returned, 14);
}

fun assert_spell_identity(envelope: &fight_events::ActionResolved, spell_id: ID) {
  let (got_spell, learned_level) = fight_events::action_resolved_spell_for_testing(envelope);
  assert!(got_spell.is_some() && *got_spell.borrow() == spell_id, 20);
  assert!(learned_level == 2, 21);
  let (element, damage, crit_damage, crit_rate, ap_cost, reach) =
    fight_events::action_resolved_weapon_for_testing(envelope);
  assert!(element == 0 && damage == 0 && crit_damage == 0, 22);
  assert!(crit_rate == 0 && ap_cost == 0 && reach == 0, 23);
  let (mob_template, mob_ordinal, _level) =
    fight_events::action_resolved_mob_spell_for_testing(envelope);
  assert!(mob_template.is_none() && mob_ordinal.is_none(), 24);
}

fun assert_weapon_identity(envelope: &fight_events::ActionResolved) {
  let (spell_id, learned_level) = fight_events::action_resolved_spell_for_testing(envelope);
  assert!(spell_id.is_none() && learned_level == 0, 30);
  let (element, damage, crit_damage, crit_rate, ap_cost, reach) =
    fight_events::action_resolved_weapon_for_testing(envelope);
  assert!(element == spell::el_fire(), 31);
  assert!(damage == 50 && crit_damage == 90 && crit_rate == 2, 32);
  assert!(ap_cost == 3 && reach == 40, 33);
  let lines = fight_events::action_resolved_weapon_lines_for_testing(envelope);
  assert!(lines.length() == 2, 34);
  let first = lines.borrow(0);
  let second = lines.borrow(1);
  assert!(participant::wl_element(first) == spell::el_fire(), 35);
  assert!(participant::wl_damage(first) == 30 && participant::wl_crit_damage(first) == 45, 36);
  assert!(participant::wl_element(second) == spell::el_water(), 37);
  assert!(participant::wl_damage(second) == 20 && participant::wl_crit_damage(second) == 30, 38);
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

fun assert_effect_manifest(envelope: &fight_events::ActionResolved, expected: vector<u8>) {
  let (ordinals, kinds) = fight_events::action_resolved_effects_for_testing(envelope);
  let n = expected.length();
  assert!(ordinals.length() == n && kinds.length() == n, 40);
  let mut i = 0;
  while (i < n) {
    assert!(*ordinals.borrow(i) == i, 41);
    assert!(*kinds.borrow(i) == *expected.borrow(i), 42);
    i = i + 1;
  };
}

fun assert_full_effect_manifest(envelope: &fight_events::ActionResolved, expected: vector<Effect>) {
  let effects = fight_events::action_resolved_effect_descriptors_for_testing(envelope);
  assert!(effects.length() == expected.length(), 43);
  let mut i = 0;
  while (i < expected.length()) {
    assert!(effect_matches(effects.borrow(i), expected.borrow(i)), 44);
    i = i + 1;
  };
}

fun assert_spell_level_snapshot(envelope: &fight_events::ActionResolved, expected: &SpellLevel) {
  let snapshot = fight_events::action_resolved_spell_level_for_testing(envelope);
  assert!(snapshot.is_some(), 45);
  let got = snapshot.borrow();
  assert!(got.min_char_level() == expected.min_char_level(), 60);
  assert!(got.sl_ap_cost() == expected.sl_ap_cost(), 46);
  assert!(got.sl_range_min() == expected.sl_range_min() && got.sl_range_max() == expected.sl_range_max(), 47);
  assert!(got.sl_modifiable_range() == expected.sl_modifiable_range(), 48);
  assert!(got.sl_line_launch() == expected.sl_line_launch() && got.sl_line_of_sight() == expected.sl_line_of_sight(), 49);
  assert!(got.sl_free_cell() == expected.sl_free_cell(), 53);
  assert!(got.sl_casts_per_turn() == expected.sl_casts_per_turn(), 54);
  assert!(got.sl_casts_per_target() == expected.sl_casts_per_target(), 55);
  assert!(got.sl_cooldown_turns() == expected.sl_cooldown_turns(), 56);
  assert!(got.sl_crit_rate() == expected.sl_crit_rate(), 57);
  assert!(got.sl_ends_turn_on_fail() == expected.sl_ends_turn_on_fail(), 58);
  assert!(got.sl_required_states() == expected.sl_required_states(), 59);
  assert!(got.sl_forbidden_states() == expected.sl_forbidden_states(), 61);
  let normal = got.sl_effects();
  let expected_normal = expected.sl_effects();
  let critical = got.sl_crit_effects();
  let expected_critical = expected.sl_crit_effects();
  assert!(normal.length() == expected_normal.length(), 62);
  assert!(critical.length() == expected_critical.length(), 63);
  let mut i = 0;
  while (i < normal.length()) {
    assert!(effect_matches(normal.borrow(i), expected_normal.borrow(i)), 64);
    i = i + 1;
  };
  let mut j = 0;
  while (j < critical.length()) {
    assert!(effect_matches(critical.borrow(j), expected_critical.borrow(j)), 65);
    j = j + 1;
  };
}

fun assert_action_key(
  started: &fight_events::ActionStarted,
  resolved: &fight_events::ActionResolved,
  expected_effects: u64,
) {
  let (sf, sm, si, st, sa, sk, target, ap, count) =
    fight_events::action_started_for_testing(started);
  let (rf, rm, ri, _target, rk, rt, ra, _ap, _crit, _fumble, _returned) =
    fight_events::action_resolved_core_for_testing(resolved);
  assert!(sf == rf && sm == rm && si == ri && st == rt && sa == ra, 94);
  assert!(sk == rk && target == _target && ap == _ap && count == expected_effects, 95);
}

fun assert_effect_marker(
  marker: &fight_events::ActionEffect,
  envelope: &fight_events::ActionResolved,
  ordinal: u64,
  expected: &Effect,
) {
  let (fight_id, is_mob, caster_idx, turn, action, effect_ordinal, effect) =
    fight_events::action_effect_for_testing(marker);
  let (rf, rm, ri, _target, _kind, rt, ra, _ap, _crit, _fumble, _returned) =
    fight_events::action_resolved_core_for_testing(envelope);
  assert!(fight_id == rf && is_mob == rm && caster_idx == ri && turn == rt && action == ra, 96);
  assert!(effect_ordinal == ordinal && effect_matches(&effect, expected), 97);
}

fun assert_deterministic_random(
  envelope: &fight_events::ActionResolved,
  expected_crit_roll: u64,
  expected_fumble_roll: u64,
  expected_fumble_bound: u64,
) {
  let (crit_roll, crit_bound, fumble_roll, fumble_bound, rolls, bounds) =
    fight_events::action_resolved_random_for_testing(envelope);
  assert!(crit_roll == expected_crit_roll && crit_bound == CRIT_BOUND, 50);
  assert!(fumble_roll == expected_fumble_roll && fumble_bound == expected_fumble_bound, 51);
  assert!(rolls.is_empty() && bounds.is_empty(), 52);
  let (domains, ordinals) = fight_events::action_resolved_random_labels_for_testing(envelope);
  assert!(domains.is_empty() && ordinals.is_empty(), 53);
}

#[test]
/// One player turn commits a learned-level spell then a weapon strike. Both retain legacy Cast, while the two
/// envelopes carry stable action ordinals 0/1, exact crit draws, mutually exclusive identities, and an explicit
/// effect manifest. The terminal envelope plus Sui event_seq partitions every preceding effect without guessing.
fun spell_and_weapon_actions_are_lossless_and_ordinal_grouped() {
  let mut sc = ts::begin(OWNER);
  let (mut fight, spell) = learned_fight(&mut sc, true);
  let fight_id = fight::id(&fight);
  let spell_id = object::id(&spell);
  let seed = fight::turn_seed_for_testing(&fight, 0);
  let spell_roll = spell_formula::slot_crit_roll(seed, 0);
  let weapon_roll = spell_formula::slot_crit_roll(seed, 1);
  let spell_critical = spell_formula::crit_at(spell_roll, 2, 0);
  let weapon_critical = spell_formula::crit_at(weapon_roll, 2, 0);
  let expected_level = grouped_level(2);
  let selected = *expected_level.effects_for(spell_critical);

  cast::resolve_player_cast(&mut fight, 0, &spell, MOB_CELL);
  let weapon_target = mob::cell(fight::mobs(&fight).borrow(0));
  cast::weapon_strike(&mut fight, 0, weapon_target);

  assert!(event::events_by_type<fight_events::Cast>().length() == 2, 60);
  let envelopes = event::events_by_type<fight_events::ActionResolved>();
  assert!(envelopes.length() == 2, 61);
  let starts = event::events_by_type<fight_events::ActionStarted>();
  let markers = event::events_by_type<fight_events::ActionEffect>();
  assert!(starts.length() == 2 && markers.length() == 4, 62);

  let spell_envelope = envelopes.borrow(0);
  assert_core(
    spell_envelope, fight_id, MOB_CELL, fight_events::action_kind_spell(), 0, 2,
    spell_critical, false, false,
  );
  assert_spell_identity(spell_envelope, spell_id);
  assert_deterministic_random(spell_envelope, spell_roll, 0, 0);
  assert_effect_manifest(
    spell_envelope,
    vector[spell_effect::k_timed_payload(), spell_effect::k_damage(), spell_effect::k_push()],
  );
  assert_full_effect_manifest(spell_envelope, copy selected);
  assert_spell_level_snapshot(spell_envelope, &expected_level);
  assert_action_key(starts.borrow(0), spell_envelope, 3);
  assert_effect_marker(markers.borrow(0), spell_envelope, 0, selected.borrow(0));
  assert_effect_marker(markers.borrow(1), spell_envelope, 1, selected.borrow(1));
  assert_effect_marker(markers.borrow(2), spell_envelope, 2, selected.borrow(2));

  let weapon_envelope = envelopes.borrow(1);
  assert_core(
    weapon_envelope, fight_id, weapon_target, fight_events::action_kind_weapon(), 1, 3,
    weapon_critical, false, false,
  );
  assert_weapon_identity(weapon_envelope);
  assert_deterministic_random(weapon_envelope, weapon_roll, 0, 0);
  assert_effect_manifest(weapon_envelope, vector[spell_effect::k_damage()]);
  let weapon_effect = spell_effect::damage(
    spell::el_none(), if (weapon_critical) 75 else 50,
  );
  assert_full_effect_manifest(weapon_envelope, vector[weapon_effect]);
  assert_action_key(starts.borrow(1), weapon_envelope, 1);
  assert_effect_marker(markers.borrow(3), weapon_envelope, 0, &weapon_effect);
  finish(sc, fight, spell);
}

#[test]
/// A denominator-one failure is a committed action with no resolved payload. The envelope must retain the spell
/// identity/AP/crit provenance, expose fumble roll 0 of bound 1, mark `fumbled`, and carry an empty effect group.
fun fumble_envelope_proves_suppressed_payload_and_raw_draw() {
  let mut sc = ts::begin(OWNER);
  let (mut fight, spell) = learned_fight(&mut sc, false);
  let fight_id = fight::id(&fight);
  let spell_id = object::id(&spell);
  let seed = fight::turn_seed_for_testing(&fight, 0);
  let crit_roll = spell_formula::slot_crit_roll(seed, 0);
  let critical = spell_formula::crit_at(crit_roll, 2, 0);
  let expected_level = damage_level(2);
  spell_board::add_status(fight::fx_mut(&mut fight), 0, MOB_FID, failure_row(1));

  cast::resolve_player_cast(&mut fight, 0, &spell, MOB_CELL);

  assert!(event::events_by_type<fight_events::CriticalFailure>().length() == 1, 70);
  assert!(event::events_by_type<fight_events::Cast>().length() == 1, 71);
  let envelopes = event::events_by_type<fight_events::ActionResolved>();
  assert!(envelopes.length() == 1, 72);
  let starts = event::events_by_type<fight_events::ActionStarted>();
  assert!(starts.length() == 1 && event::events_by_type<fight_events::ActionEffect>().is_empty(), 73);
  let envelope = envelopes.borrow(0);
  assert_core(
    envelope, fight_id, MOB_CELL, fight_events::action_kind_spell(), 0, 2,
    critical, true, false,
  );
  assert_spell_identity(envelope, spell_id);
  assert_deterministic_random(envelope, crit_roll, 0, 1);
  assert_effect_manifest(envelope, vector[]);
  assert_full_effect_manifest(envelope, vector[]);
  assert_spell_level_snapshot(envelope, &expected_level);
  assert_action_key(starts.borrow(0), envelope, 0);
  finish(sc, fight, spell);
}

#[test]
/// A 50%-chance RETURN_SPELL consumes one deterministic draw. Whether it returns or misses, the envelope's raw
/// roll/bound must explain the flag and HP recipient exactly; the resolved damage keeps effect ordinal zero.
fun returned_flag_is_derived_from_recorded_random_provenance() {
  let mut sc = ts::begin(OWNER);
  let (mut fight, spell) = learned_fight(&mut sc, false);
  let fight_id = fight::id(&fight);
  let spell_id = object::id(&spell);
  let seed = fight::turn_seed_for_testing(&fight, 0);
  let crit_roll = spell_formula::slot_crit_roll(seed, 0);
  let critical = spell_formula::crit_at(crit_roll, 2, 0);
  let expected_level = damage_level(2);
  spell_board::add_status(fight::fx_mut(&mut fight), MOB_FID, 0, return_row(50));

  cast::resolve_player_cast(&mut fight, 0, &spell, MOB_CELL);

  assert!(event::events_by_type<fight_events::Cast>().length() == 1, 80);
  let envelopes = event::events_by_type<fight_events::ActionResolved>();
  assert!(envelopes.length() == 1, 81);
  let starts = event::events_by_type<fight_events::ActionStarted>();
  let markers = event::events_by_type<fight_events::ActionEffect>();
  assert!(starts.length() == 1 && markers.length() == 1, 98);
  let envelope = envelopes.borrow(0);
  let (
    got_fight, caster_is_mob, caster_idx, target, kind, turn_ordinal, action_ordinal,
    ap_cost, got_critical, fumbled, returned,
  ) = fight_events::action_resolved_core_for_testing(envelope);
  assert!(got_fight == fight_id && !caster_is_mob && caster_idx == 0, 82);
  assert!(target == MOB_CELL && kind == fight_events::action_kind_spell(), 83);
  assert!(turn_ordinal == 1 && action_ordinal == 0 && ap_cost == 2, 84);
  assert!(got_critical == critical && !fumbled, 85);

  let (got_crit_roll, crit_bound, fumble_roll, fumble_bound, rolls, bounds) =
    fight_events::action_resolved_random_for_testing(envelope);
  assert!(got_crit_roll == crit_roll && crit_bound == CRIT_BOUND, 86);
  assert!(fumble_roll == 0 && fumble_bound == 0, 87);
  assert!(rolls.length() == 1 && bounds.length() == 1, 88);
  let return_roll = *rolls.borrow(0);
  assert!(*bounds.borrow(0) == 100 && returned == (return_roll < 50), 89);
  let (domains, ordinals) = fight_events::action_resolved_random_labels_for_testing(envelope);
  assert!(domains == vector[fight_events::random_domain_return()], 99);
  assert!(ordinals == vector[fight_events::no_effect_ordinal()], 100);
  let selected = *expected_level.effects_for(critical);
  let damage = selected.borrow(0).value();
  if (returned) {
    assert!(participant::hp(fight::participants(&fight).borrow(0)) == 100 - damage, 90);
    assert!(mob::hp(fight::mobs(&fight).borrow(0)) == 5_000, 91);
  } else {
    assert!(participant::hp(fight::participants(&fight).borrow(0)) == 100, 92);
    assert!(mob::hp(fight::mobs(&fight).borrow(0)) == 5_000 - damage, 93);
  };
  assert_spell_identity(envelope, spell_id);
  assert_effect_manifest(envelope, vector[spell_effect::k_damage()]);
  assert_full_effect_manifest(envelope, copy selected);
  assert_spell_level_snapshot(envelope, &expected_level);
  assert_action_key(starts.borrow(0), envelope, 1);
  assert_effect_marker(markers.borrow(0), envelope, 0, selected.borrow(0));
  finish(sc, fight, spell);
}
