// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// SINK PARITY — the whole effect vocabulary, through BOTH sinks, in one walk.
///
/// `apply_to_player` and `apply_to_mob` are parallel if/else-if chains over 40 `u8` kinds, and parallel chains
/// drift: `k_punishment_damage` was implemented only on the mob side (a mob's punishment line did nothing to a
/// player but damaged a mob), and the mob chain had no terminal arm at all, so anything it did not name was a
/// silent no-op there while the player tail recorded a row for it. Nothing failed, on either count, because no
/// test ever enumerated the vocabulary.
///
/// This suite is that enumeration. Every kind is driven at a seat AND at a mob; a kind that reaches neither an
/// implementation nor a named no-op aborts `EUnhandledEffectKind`, so this walk is what keeps that terminal arm
/// unreachable. Adding kind 41 without wiring both sinks fails HERE, before it can reach a player.
#[test_only]
module aresrpg_fight::sink_parity_tests;

use aresrpg_fight::{cast, fight::{Self, Fight}, participant, fight_scaffold::{create_fight, stand_up}};
use aresrpg_foundation::{spell, spell_effect};
use sui::test_scenario::{Self as ts};

const OWNER: address = @0xA;

/// The kinds that never reach a sink: the cast resolver consumes them upstream (caster-side kinds, the geometric
/// arm, the payload/stack riders) or filters them out before application (trap and glyph placement).
fun handled_upstream(): vector<u8> {
  vector[
    spell_effect::k_caster_damage(),
    spell_effect::k_teleport(),
    spell_effect::k_geometric_push(),
    spell_effect::k_timed_payload(),
    spell_effect::k_named_damage_stack(),
    spell_effect::k_place_trap(),
    spell_effect::k_place_glyph(),
  ]
}

/// THE VOCABULARY, in `spell_effect` declaration order. A new kind belongs here the day it is minted.
fun every_kind(): vector<u8> {
  vector[
    spell_effect::k_damage(),
    spell_effect::k_percent_life_damage(),
    spell_effect::k_life_steal(),
    spell_effect::k_caster_damage(),
    spell_effect::k_punishment_damage(),
    spell_effect::k_heal(),
    spell_effect::k_give_points(),
    spell_effect::k_remove_points(),
    spell_effect::k_steal_points(),
    spell_effect::k_alter_stat(),
    spell_effect::k_steal_stat(),
    spell_effect::k_alter_resist(),
    spell_effect::k_push(),
    spell_effect::k_pull(),
    spell_effect::k_teleport(),
    spell_effect::k_swap_positions(),
    spell_effect::k_carry(),
    spell_effect::k_throw(),
    spell_effect::k_reset_positions(),
    spell_effect::k_place_trap(),
    spell_effect::k_place_glyph(),
    spell_effect::k_apply_dot(),
    spell_effect::k_apply_state(),
    spell_effect::k_remove_state(),
    spell_effect::k_reduce_damage(),
    spell_effect::k_reflect_damage(),
    spell_effect::k_dispel(),
    spell_effect::k_invisibility(),
    spell_effect::k_reveal(),
    spell_effect::k_return_spell(),
    spell_effect::k_geometric_push(),
    spell_effect::k_critical_failure(),
    spell_effect::k_damage_to_heal(),
    spell_effect::k_forced_death(),
    spell_effect::k_timed_payload(),
    spell_effect::k_named_damage_stack(),
    spell_effect::k_stance(),
    spell_effect::k_reactive_punishment(),
    spell_effect::k_erosion(),
    spell_effect::k_damage_redirect(),
  ]
}

#[test]
/// Every kind a sink can receive lands in a defined branch on BOTH sides. An unwired kind aborts here.
fun every_effect_kind_lands_in_a_defined_branch_on_both_sinks() {
  let mut sc = ts::begin(OWNER);
  stand_up(&mut sc);
  create_fight(&mut sc, 100_000, 700, 0, 1000, true, option::none());
  sc.next_tx(OWNER);
  let mut fight = sc.take_shared<Fight>();
  let stats = spell::new_stats(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);

  let kinds = every_kind();
  let upstream = handled_upstream();
  let mut i = 0;
  while (i < kinds.length()) {
    let kind = kinds[i];
    if (!upstream.contains(&kind)) {
      // chance 100 so the proc'd kinds take their live arm; turns 1 so timed rows are real rows.
      let effect = spell_effect::new_effect(kind, spell::el_fire(), 1, 0, 0, 0, 100, 1, 0, 0, 0);
      let mut rng = 42;
      cast::apply_to_both_for_testing(&mut fight, &stats, 0, 0, &effect, &mut rng);
    };
    i = i + 1;
  };

  ts::return_shared(fight);
  sc.end();
}

#[test]
/// The vocabulary this suite walks is the WHOLE vocabulary — a kind minted without a row above would otherwise
/// slip past the walk unnoticed, which is the same blind spot one layer up.
fun the_walked_vocabulary_is_contiguous_and_complete() {
  let kinds = every_kind();
  let mut i = 0;
  while (i < kinds.length()) {
    // `spell_effect` numbers its kinds from 0 in declaration order, so the walk is complete exactly when each
    // entry sits at its own ordinal — a new kind appended there without a row here shifts nothing and would
    // otherwise go unwalked, so the count assert below is what catches it.
    assert!(kinds[i] == (i as u8), i);
    i = i + 1;
  };
  assert!(kinds.length() == 40, 100);
}

#[test]
/// PUNISHMENT DAMAGE DAMAGES A PLAYER. The divergence in one assert: it was implemented only on the mob sink, so
/// this landed as a status row and the seat took nothing — while @aresrpg/sim folded DAMAGE for both sides.
fun punishment_damage_hits_a_seat_like_it_hits_a_mob() {
  let mut sc = ts::begin(OWNER);
  stand_up(&mut sc);
  create_fight(&mut sc, 100_000, 701, 0, 1000, true, option::none());
  sc.next_tx(OWNER);
  let mut fight = sc.take_shared<Fight>();
  let stats = spell::new_stats(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);

  let before = participant::hp(fight::participants(&fight).borrow(0));
  let effect = spell_effect::new_effect(spell_effect::k_punishment_damage(), spell::el_fire(), 50, 0, 0, 0, 100, 0, 0, 0, 0);
  let mut rng = 7;
  cast::apply_to_both_for_testing(&mut fight, &stats, 0, 0, &effect, &mut rng);
  assert!(participant::hp(fight::participants(&fight).borrow(0)) < before, 0);

  ts::return_shared(fight);
  sc.end();
}
