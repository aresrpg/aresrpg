// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// WAVE 12 RETRO EFFECT GOLDENS — executable Move twins of:
/// - `packages/sim/test/vectors/missing_effect_stats_golden.json`
/// - `packages/sim/test/vectors/missing_effect_statuses_golden.json`
/// - `packages/sim/test/vectors/missing_effect_reactions_golden.json`
///
/// These tests exercise fight-local state through the engine's package seams and explicitly prove that each
/// stateful family starts empty on a second Fight UID. Combat-currency transfer is intentionally absent: the
/// This requires a declared adaptation instead of an invented resource. BRAND LAW: reference spell and
/// effect names stay in corpus data; executable runtime contracts use generic/internal vocabulary only.
#[test_only]
module aresrpg_fight::retro_effects_golden_tests;

use aresrpg_fight::{
  cast,
  fight::{Self, Fight},
  fight_events,
  fight_registry,
  fight_scaffold::{create_fight_as, stand_up, tsreg},
  mob,
  participant,
  retro_effects as retro,
};
use aresrpg_foundation::{spell, spell_board, spell_effect::{Self, Effect, SpellLevel}};
use aresrpg_spells::spell_template::SpellTemplate;
use sui::{event, test_scenario::{Self as ts, Scenario}};

const OWNER: address = @0xA;
const CHAR_A: address = @0xC1;
const CHAR_B: address = @0xC2;
const WORLD: address = @0x704D;
const MOB_FID: u64 = 1_000;

fun fight_id(sc: &Scenario, spawn_id: u64): ID {
  let registry = tsreg(sc);
  let address = fight_registry::fight_address(&registry, object::id_from_address(WORLD), spawn_id);
  ts::return_shared(registry);
  object::id_from_address(address)
}

fun create_fresh(sc: &mut Scenario, spawn_id: u64, character: address): Fight {
  create_fight_as(sc, 100, spawn_id, 0, 1000, true, option::none(), character);
  sc.next_tx(OWNER);
  let id = fight_id(sc, spawn_id);
  ts::take_shared_by_id<Fight>(sc, id)
}

fun effect_of(
  kind: u8,
  value: u64,
  chance: u8,
  turns: u8,
  stat: u8,
  area_size: u64,
  flags: u8,
): Effect {
  spell_effect::new_effect(
    kind,
    spell::el_none(),
    value,
    spell_effect::shape_point(),
    area_size,
    spell_effect::tf_none(),
    chance,
    turns,
    stat,
    flags,
    spell_effect::phase_on_enter(),
  )
}

fun add_row(fight: &mut Fight, fighter: u64, source: u64, effect: Effect) {
  spell_board::add_status(fight::fx_mut(fight), fighter, source, effect);
}

fun fumble_spell_level(min_char_level: u16): SpellLevel {
  spell_effect::new_spell_level(
    min_char_level,
    2,
    1,
    4,
    false,
    false,
    true,
    false,
    255,
    255,
    0,
    0,
    false,
    vector[],
    vector[],
    vector[spell_effect::damage(spell::el_earth(), 20)],
    vector[],
  )
}

fun mint_fumble_spell(sc: &mut Scenario) {
  sc.next_tx(OWNER);
  aresrpg_spells::version::test_init(sc.ctx());
  aresrpg_spells::admin::test_init(sc.ctx());
  aresrpg_spells::spell_template::test_init(sc.ctx());
  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<aresrpg_spells::admin::AdminCap>();
  let version = sc.take_shared<aresrpg_spells::version::Version>();
  let mut registry = sc.take_shared<aresrpg_spells::spell_template::SpellRegistry>();
  let levels = vector[
    fumble_spell_level(1),
    fumble_spell_level(1),
    fumble_spell_level(1),
    fumble_spell_level(1),
    fumble_spell_level(1),
    fumble_spell_level(101),
  ];
  aresrpg_spells::spell_template::mint_spell(
    &cap,
    &mut registry,
    b"senshi".to_string(),
    1,
    b"Wave 12 failure vector".to_string(),
    levels,
    20,
    0,
    &version,
    sc.ctx(),
  );
  ts::return_shared(registry);
  ts::return_shared(version);
  sc.return_to_sender(cap);
}

fun stack_spell_level(min_char_level: u16): SpellLevel {
  spell_effect::new_spell_level(
    min_char_level,
    1,
    1,
    4,
    false,
    false,
    true,
    false,
    255,
    255,
    0,
    0,
    false,
    vector[],
    vector[],
    vector[
      spell_effect::damage(spell::el_earth(), 10),
      effect_of(spell_effect::k_named_damage_stack(), 5, 100, 2, 0, 0, 0),
    ],
    vector[],
  )
}

fun mint_stack_spell(sc: &mut Scenario) {
  sc.next_tx(OWNER);
  aresrpg_spells::version::test_init(sc.ctx());
  aresrpg_spells::admin::test_init(sc.ctx());
  aresrpg_spells::spell_template::test_init(sc.ctx());
  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<aresrpg_spells::admin::AdminCap>();
  let version = sc.take_shared<aresrpg_spells::version::Version>();
  let mut registry = sc.take_shared<aresrpg_spells::spell_template::SpellRegistry>();
  let levels = vector[
    stack_spell_level(1),
    stack_spell_level(1),
    stack_spell_level(1),
    stack_spell_level(1),
    stack_spell_level(1),
    stack_spell_level(101),
  ];
  aresrpg_spells::spell_template::mint_spell(
    &cap,
    &mut registry,
    b"senshi".to_string(),
    1,
    b"Wave 12 stacking vector".to_string(),
    levels,
    10,
    0,
    &version,
    sc.ctx(),
  );
  ts::return_shared(registry);
  ts::return_shared(version);
  sc.return_to_sender(cap);
}

#[test]
/// Stats vector: denominator zero is inert, overlapping rows choose the lowest positive 1-in-N rate, and a
/// fixed roll resolves identically on every read.
fun critical_failure_rows_choose_lowest_live_denominator() {
  let mut sc = ts::begin(OWNER);
  stand_up(&mut sc);
  let mut fight = create_fresh(&mut sc, 1, CHAR_A);

  add_row(&mut fight, 0, MOB_FID, effect_of(spell_effect::k_critical_failure(), 9, 100, 2, 0, 0, 0));
  add_row(&mut fight, 0, MOB_FID, effect_of(spell_effect::k_critical_failure(), 0, 100, 2, 0, 0, 0));
  add_row(&mut fight, 0, MOB_FID, effect_of(spell_effect::k_critical_failure(), 3, 100, 2, 0, 0, 0));

  assert!(retro::failure_denominator(&fight, 0) == 3, 0);
  assert!(retro::roll_fumbles(&fight, 0, 6), 1);
  assert!(!retro::roll_fumbles(&fight, 0, 7), 2);
  let first = retro::player_fumbles(&fight, 0, 123456789, 4);
  assert!(first == retro::player_fumbles(&fight, 0, 123456789, 4), 3);

  ts::return_shared(fight);
  sc.end();
}

#[test]
/// Stats vector end-to-end: a denominator-one fumble is still a committed cast (AP and action slot consumed,
/// Cast + CriticalFailure emitted), while its damage payload is suppressed.
fun critical_failure_commits_ap_and_slot_without_running_payload() {
  let mut sc = ts::begin(OWNER);
  stand_up(&mut sc);
  let fight = create_fresh(&mut sc, 1, CHAR_A);
  ts::return_shared(fight);
  mint_fumble_spell(&mut sc);
  sc.next_tx(OWNER);
  let id = fight_id(&sc, 1);
  let mut fight = ts::take_shared_by_id<Fight>(&sc, id);
  let spell = sc.take_shared<SpellTemplate>();
  participant::set_cell(fight::participants_mut(&mut fight).borrow_mut(0), 164);
  mob::set_cell(fight::mobs_mut(&mut fight).borrow_mut(0), 165);
  participant::begin_turn(fight::participants_mut(&mut fight).borrow_mut(0), 0, 0, 0, 0);
  add_row(&mut fight, 0, MOB_FID, effect_of(spell_effect::k_critical_failure(), 1, 100, 2, 0, 0, 0));

  cast::resolve_player_cast(&mut fight, 0, &spell, 165);
  let player = fight::participants(&fight).borrow(0);
  assert!(participant::ap(player) == 4, 0);
  assert!(participant::casts_this_turn(player) == 1, 1);
  assert!(mob::hp(fight::mobs(&fight).borrow(0)) == 100, 2);
  assert!(event::events_by_type<fight_events::CriticalFailure>().length() == 1, 3);
  assert!(event::events_by_type<fight_events::Cast>().length() == 1, 4);

  ts::return_shared(fight);
  ts::return_shared(spell);
  sc.end();
}

#[test]
/// Reactions vector: effect-79 success heals `incoming * stat`; its miss continues as `incoming * value`.
fun damage_to_heal_branches_once_per_direct_line() {
  let mut sc = ts::begin(OWNER);
  stand_up(&mut sc);
  let mut fight = create_fresh(&mut sc, 1, CHAR_A);
  participant::apply_damage(fight::participants_mut(&mut fight).borrow_mut(0), 40);
  add_row(
    &mut fight,
    0,
    MOB_FID,
    effect_of(spell_effect::k_damage_to_heal(), 2, 50, 2, 3, 0, 0),
  );

  let healed_line = retro::hit(&mut fight, false, 0, true, 0, true, 10, 49);
  assert!(healed_line == 0, 0);
  assert!(participant::hp(fight::participants(&fight).borrow(0)) == 90, 1);

  let damage_line = retro::hit(&mut fight, false, 0, true, 0, true, 10, 50);
  assert!(damage_line == 20, 2);
  assert!(participant::hp(fight::participants(&fight).borrow(0)) == 70, 3);

  ts::return_shared(fight);
  sc.end();
}

#[test]
/// Stats vector: raw142's authored duration zero is scoped to the bearer's current turn. It enters the ordinary
/// alter-row fold immediately, then the synthetic one-turn row expires without touching the permanent base.
fun physical_damage_zero_duration_expires_at_turn_end() {
  let mut sc = ts::begin(OWNER);
  stand_up(&mut sc);
  let mut fight = create_fresh(&mut sc, 1, CHAR_A);
  let cell = participant::cell(fight::participants(&fight).borrow(0));
  let effect = effect_of(
    spell_effect::k_alter_stat(), 20, 100, 0, spell_effect::stat_physical_damage(), 0, 0,
  );
  let caster_stats = *participant::stats(fight::participants(&fight).borrow(0));
  let mut rng = 7;

  cast::apply_effect_for_testing(&mut fight, 0, 0, cell, &caster_stats, 1, cell, &effect, &mut rng);
  assert!(spell::stat_physical_damage(participant::stats(fight::participants(&fight).borrow(0))) == 20, 0);
  assert!(spell_board::fighter_status_rows_of(fight::fx(&fight), 0, spell_effect::k_alter_stat()).length() == 1, 1);

  cast::tick_turn_end(&mut fight, false, 0);
  assert!(spell::stat_physical_damage(participant::stats(fight::participants(&fight).borrow(0))) == 0, 2);
  assert!(spell_board::fighter_status_rows_of(fight::fx(&fight), 0, spell_effect::k_alter_stat()).is_empty(), 3);

  ts::return_shared(fight);
  sc.end();
}

#[test]
/// Statuses vector: full-pool reduction is immunity; without it forced death bypasses mitigation and reactions.
fun forced_death_respects_only_full_immunity() {
  let mut sc = ts::begin(OWNER);
  stand_up(&mut sc);
  let mut fight = create_fresh(&mut sc, 1, CHAR_A);
  add_row(
    &mut fight,
    MOB_FID,
    0,
    effect_of(spell_effect::k_reduce_damage(), 100, 100, 2, 0, 0, 0),
  );

  assert!(!retro::force_death(&mut fight, true, 0), 0);
  assert!(mob::hp(fight::mobs(&fight).borrow(0)) == 100, 1);
  spell_board::clear_fighter_status_kind(fight::fx_mut(&mut fight), MOB_FID, spell_effect::k_reduce_damage());
  assert!(retro::force_death(&mut fight, true, 0), 2);
  assert!(mob::hp(fight::mobs(&fight).borrow(0)) == 0, 3);

  ts::return_shared(fight);
  sc.end();
}

#[test]
/// Statuses vector: raw-787's linked payload with delay one becomes due at the bearer's next turn-start read.
fun timed_payload_delay_one_releases_the_linked_batch_next_turn() {
  let mut sc = ts::begin(OWNER);
  stand_up(&mut sc);
  let mut fight = create_fresh(&mut sc, 1, CHAR_A);
  retro::schedule_payload(
    &mut fight,
    0,
    MOB_FID,
    1,
    vector[spell_effect::damage(spell::el_earth(), 7)],
  );
  assert!(retro::pending_payloads_for_testing(&fight, 0) == 1, 0);
  assert!(cast::tick_turn_start(&mut fight, false, 0), 1);
  assert!(retro::pending_payloads_for_testing(&fight, 0) == 0, 2);
  assert!(participant::hp(fight::participants(&fight).borrow(0)) == 93, 3);

  ts::return_shared(fight);
  sc.end();
}

#[test]
/// Statuses vector + cleanup: same-spell/same-target riders accumulate, expire independently, and an active row
/// on Fight A is absent from fresh Fight B even when every logical key component is reused.
fun named_damage_stack_accumulates_expires_and_does_not_leak_to_fresh_fight() {
  let mut sc = ts::begin(OWNER);
  stand_up(&mut sc);
  let spell_id = object::id_from_address(@0x51);
  let mut fight_a = create_fresh(&mut sc, 1, CHAR_A);

  assert!(retro::named_damage_bonus(&mut fight_a, 0, spell_id, MOB_FID, 10) == 0, 0);
  retro::record_named_stack(&mut fight_a, 0, spell_id, MOB_FID, 10, 4, 2);
  assert!(retro::named_damage_bonus(&mut fight_a, 0, spell_id, MOB_FID, 10) == 4, 1);
  retro::record_named_stack(&mut fight_a, 0, spell_id, MOB_FID, 11, 6, 2);
  assert!(retro::named_damage_bonus(&mut fight_a, 0, spell_id, MOB_FID, 11) == 10, 2);
  assert!(retro::named_damage_bonus(&mut fight_a, 0, spell_id, MOB_FID, 13) == 6, 3);
  assert!(retro::named_damage_bonus(&mut fight_a, 0, spell_id, MOB_FID, 14) == 0, 4);
  assert!(retro::named_rows_for_testing(&fight_a, 0, spell_id, MOB_FID) == 0, 5);

  retro::record_named_stack(&mut fight_a, 0, spell_id, MOB_FID, 20, 7, 5);
  assert!(retro::named_rows_for_testing(&fight_a, 0, spell_id, MOB_FID) == 1, 6);
  ts::return_shared(fight_a);

  let mut fight_b = create_fresh(&mut sc, 2, CHAR_B);
  assert!(retro::named_rows_for_testing(&fight_b, 0, spell_id, MOB_FID) == 0, 7);
  assert!(retro::named_damage_bonus(&mut fight_b, 0, spell_id, MOB_FID, 20) == 0, 8);
  ts::return_shared(fight_b);
  sc.end();
}

#[test]
/// Statuses vector end-to-end: cast one deals the authored 10 and records +5; cast two at the same fighter reads
/// that live key before recording its own rider, so it deals 15.
fun named_damage_stack_amplifies_the_next_matching_real_cast() {
  let mut sc = ts::begin(OWNER);
  stand_up(&mut sc);
  let fight = create_fresh(&mut sc, 1, CHAR_A);
  ts::return_shared(fight);
  mint_stack_spell(&mut sc);
  sc.next_tx(OWNER);
  let id = fight_id(&sc, 1);
  let mut fight = ts::take_shared_by_id<Fight>(&sc, id);
  let spell = sc.take_shared<SpellTemplate>();
  let spell_id = object::id(&spell);
  participant::set_cell(fight::participants_mut(&mut fight).borrow_mut(0), 164);
  mob::set_cell(fight::mobs_mut(&mut fight).borrow_mut(0), 165);
  participant::begin_turn(fight::participants_mut(&mut fight).borrow_mut(0), 0, 0, 0, 0);

  cast::resolve_player_cast(&mut fight, 0, &spell, 165);
  assert!(mob::hp(fight::mobs(&fight).borrow(0)) == 90, 0);
  assert!(retro::named_rows_for_testing(&fight, 0, spell_id, MOB_FID) == 1, 1);
  cast::resolve_player_cast(&mut fight, 0, &spell, 165);
  assert!(mob::hp(fight::mobs(&fight).borrow(0)) == 75, 2);
  assert!(retro::named_rows_for_testing(&fight, 0, spell_id, MOB_FID) == 2, 3);
  assert!(participant::ap(fight::participants(&fight).borrow(0)) == 4, 4);

  ts::return_shared(fight);
  ts::return_shared(spell);
  sc.end();
}

#[test]
/// Statuses vector + cleanup: stance application and expiry each emit a presentation event; an active stance on
/// Fight A does not create a status row on fresh Fight B.
fun stance_emits_apply_and_expiry_and_does_not_leak_to_fresh_fight() {
  let mut sc = ts::begin(OWNER);
  stand_up(&mut sc);
  let stance = effect_of(spell_effect::k_stance(), 7032, 100, 1, 0, 0, 0);
  let mut fight_a = create_fresh(&mut sc, 1, CHAR_A);

  retro::apply_stance(&mut fight_a, false, 0, 0, &stance);
  assert!(spell_board::fighter_status_of(fight::fx(&fight_a), 0, spell_effect::k_stance()).is_some(), 0);
  assert!(event::events_by_type<fight_events::StanceChanged>().length() == 1, 1);

  cast::tick_turn_end(&mut fight_a, false, 0);
  assert!(spell_board::fighter_status_of(fight::fx(&fight_a), 0, spell_effect::k_stance()).is_none(), 2);
  assert!(event::events_by_type<fight_events::StanceChanged>().length() == 2, 3);

  retro::apply_stance(&mut fight_a, false, 0, 0, &stance);
  assert!(spell_board::fighter_status_of(fight::fx(&fight_a), 0, spell_effect::k_stance()).is_some(), 4);
  ts::return_shared(fight_a);

  let fight_b = create_fresh(&mut sc, 2, CHAR_B);
  assert!(spell_board::fighter_status_of(fight::fx(&fight_b), 0, spell_effect::k_stance()).is_none(), 5);
  ts::return_shared(fight_b);
  sc.end();
}

#[test]
/// Reactions vector + cleanup: each hit's punishment gain is capped by `value`, erosion reduces maximum HP by a
/// percentage of actual loss, and neither source row nor generated bonus appears on fresh Fight B.
fun punishment_cap_and_erosion_do_not_leak_to_fresh_fight() {
  let mut sc = ts::begin(OWNER);
  stand_up(&mut sc);
  let mut fight_a = create_fresh(&mut sc, 1, CHAR_A);
  add_row(
    &mut fight_a,
    0,
    MOB_FID,
    effect_of(spell_effect::k_reactive_punishment(), 5, 100, 3, spell_effect::stat_strength(), 2, 0),
  );
  add_row(&mut fight_a, 0, MOB_FID, effect_of(spell_effect::k_erosion(), 20, 100, 3, 0, 0, 0));

  assert!(retro::hit(&mut fight_a, false, 0, true, 0, true, 12, 0) == 12, 0);
  {
    let player = fight::participants(&fight_a).borrow(0);
    assert!(participant::hp(player) == 88 && participant::max_hp(player) == 98, 1);
    assert!(spell::stat_strength(participant::stats(player)) == 5, 2);
  };

  assert!(retro::hit(&mut fight_a, false, 0, true, 0, true, 3, 0) == 3, 3);
  {
    let player = fight::participants(&fight_a).borrow(0);
    assert!(participant::hp(player) == 85 && participant::max_hp(player) == 98, 4);
    assert!(spell::stat_strength(participant::stats(player)) == 8, 5);
  };
  assert!(spell_board::fighter_status_rows_of(fight::fx(&fight_a), 0, spell_effect::k_alter_stat()).length() == 2, 6);
  ts::return_shared(fight_a);

  let fight_b = create_fresh(&mut sc, 2, CHAR_B);
  {
    let player_b = fight::participants(&fight_b).borrow(0);
    assert!(participant::max_hp(player_b) == 100, 7);
    assert!(spell::stat_strength(participant::stats(player_b)) == 0, 8);
  };
  assert!(spell_board::fighter_status_of(fight::fx(&fight_b), 0, spell_effect::k_reactive_punishment()).is_none(), 9);
  assert!(spell_board::fighter_status_of(fight::fx(&fight_b), 0, spell_effect::k_erosion()).is_none(), 10);
  assert!(spell_board::fighter_status_rows_of(fight::fx(&fight_b), 0, spell_effect::k_alter_stat()).is_empty(), 11);
  ts::return_shared(fight_b);
  sc.end();
}

#[test]
/// Reactions vector: a Vitality punishment has no generic Stats field, so the capped gain increases maximum HP
/// directly and its independent generated row removes that exact capacity on expiry.
fun vitality_punishment_changes_max_hp_then_reverts() {
  let mut sc = ts::begin(OWNER);
  stand_up(&mut sc);
  let mut fight = create_fresh(&mut sc, 1, CHAR_A);
  add_row(
    &mut fight,
    0,
    MOB_FID,
    effect_of(
      spell_effect::k_reactive_punishment(), 5, 100, 3, spell_effect::stat_vitality(), 1, 0,
    ),
  );

  assert!(retro::hit(&mut fight, false, 0, true, 0, true, 12, 0) == 12, 0);
  assert!(participant::max_hp(fight::participants(&fight).borrow(0)) == 105, 1);
  assert!(participant::hp(fight::participants(&fight).borrow(0)) == 88, 2);

  cast::tick_turn_end(&mut fight, false, 0);
  assert!(participant::max_hp(fight::participants(&fight).borrow(0)) == 100, 3);
  assert!(spell_board::fighter_status_rows_of(fight::fx(&fight), 0, spell_effect::k_alter_stat()).is_empty(), 4);

  ts::return_shared(fight);
  sc.end();
}

#[test]
/// Reactions vector + cleanup: value zero redirects the full hit to the status source; a positive value reflects
/// that percentage after the victim's real loss. Both are depth-one, and fresh Fight B has neither behavior.
fun redirect_and_reflect_are_nonrecursive_and_do_not_leak_to_fresh_fight() {
  let mut sc = ts::begin(OWNER);
  stand_up(&mut sc);
  let mut fight_a = create_fresh(&mut sc, 1, CHAR_A);
  add_row(&mut fight_a, 0, MOB_FID, effect_of(spell_effect::k_damage_redirect(), 0, 100, 3, 0, 0, 0));

  assert!(retro::hit(&mut fight_a, false, 0, true, 0, true, 20, 0) == 0, 0);
  assert!(participant::hp(fight::participants(&fight_a).borrow(0)) == 100, 1);
  assert!(mob::hp(fight::mobs(&fight_a).borrow(0)) == 80, 2);

  spell_board::clear_fighter_status_kind(fight::fx_mut(&mut fight_a), 0, spell_effect::k_damage_redirect());
  add_row(&mut fight_a, 0, 0, effect_of(spell_effect::k_damage_redirect(), 50, 100, 3, 0, 0, 0));
  assert!(retro::hit(&mut fight_a, false, 0, true, 0, true, 20, 0) == 20, 3);
  assert!(participant::hp(fight::participants(&fight_a).borrow(0)) == 80, 4);
  assert!(mob::hp(fight::mobs(&fight_a).borrow(0)) == 70, 5);
  ts::return_shared(fight_a);

  let mut fight_b = create_fresh(&mut sc, 2, CHAR_B);
  assert!(spell_board::fighter_status_of(fight::fx(&fight_b), 0, spell_effect::k_damage_redirect()).is_none(), 6);
  assert!(retro::hit(&mut fight_b, false, 0, true, 0, true, 10, 0) == 10, 7);
  assert!(participant::hp(fight::participants(&fight_b).borrow(0)) == 90, 8);
  assert!(mob::hp(fight::mobs(&fight_b).borrow(0)) == 100, 9);
  ts::return_shared(fight_b);
  sc.end();
}
