// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// VITALITY / MAX_HP ALTERS (#1628) — an ordinary `k_alter_stat` line naming stat 5 (Vitality) or 10 (MAX_HP)
/// must move the fighter's HP CAPACITY. Those two ids deliberately have no `Stats` field (`spell::add_stat`
/// skips 5 and 10), so the alter arm's `apply_alter` + `refresh_*_stats` pair — which only ever writes the
/// `Stats` block — folded a +60 vitality buff into nothing at all: the row landed on the board, the live block
/// re-derived identically, and max HP never moved.
///
/// The capacity home already existed for the REACTIVE-PUNISHMENT mint (`retro_effects::trigger_punishment`
/// bumps `add_max_hp` for exactly these two ids) and so did the expiry inverse
/// (`retro_effects::revert_expired_max_hp`, called from `cast::tick_turn_end` and `cast::dispel_target`) — the
/// ORDINARY cast arm was the only mint that never paid into it, which also left the revert asymmetric: an
/// expiring vitality row subtracted capacity that its own application never added.
///
/// The @aresrpg/sim twin of this file is `packages/sim/test/vitality_max_hp.test.js`.
#[test_only]
module aresrpg_fight::alter_max_hp_tests;

use aresrpg_fight::{cast, fight::{Self, Fight}, mob::{Self, MobSpec}, participant, version::Version};
use aresrpg_fight::fight_scaffold::{combatant, create_fight, mk_clock, stand_up, tsregs_for};
use aresrpg_foundation::{spell::{Self, Stats}, spell_effect::{Self, Effect}};
use sui::{clock, test_scenario::{Self as ts, Scenario}};

const OWNER: address = @0xA;
const CHAR: address = @0xC0;
const WORLD: address = @0x704D;
const PLAYER_CELL: u64 = 200;
const MOB0: u64 = 100;

fun z(): Stats { spell::new_stats(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0) }

fun spec(hp: u64): MobSpec { mob::new_mob_spec(1, 1, hp, 6, 6, z(), vector[], 100, vector[]) }

/// A signed vitality/max-hp alter. `amount` is the AUTHORED magnitude; the row stores it CENTERED at 32768 like
/// every signed value on chain (#904). `filter` is passed explicitly so the same builder can buff the caster
/// (TF_NOT_ENEMY) or land on an enemy mob (TF_NOT_TEAM).
fun vitality_alter(stat_id: u8, amount: u64, negative: bool, turns: u8, filter: u8): Effect {
  let flags = if (negative) spell_effect::flag_negative() else 0;
  let value = participant::centered_value(amount, negative);
  spell_effect::new_effect(
    spell_effect::k_alter_stat(), 255, value, spell_effect::shape_point(), 0, filter, 100, turns, stat_id,
    flags, spell_effect::phase_on_enter(),
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

fun player_max_hp(f: &Fight): u64 { participant::max_hp(fight::participants(f).borrow(0)) }
fun player_hp(f: &Fight): u64 { participant::hp(fight::participants(f).borrow(0)) }
fun mob_max_hp(f: &Fight): u64 { mob::max_hp(fight::mobs(f).borrow(0)) }

// ══════════════════ [ the buff lands ] ══════════════════

#[test]
/// A TIMED +60 vitality self-buff raises the seat's max HP for its life and gives it back at expiry. Current HP
/// does NOT ride the delta up (`participant::add_max_hp_bonus` — capacity only, the declared house rule) and is
/// clamped back down when the row leaves.
fun timed_vitality_buff_raises_then_restores_player_max_hp() {
  let mut sc = ts::begin(OWNER);
  let mut fight = one_mob(&mut sc, spec(1000));
  let ps = z();
  let mut rng = 1u64;
  assert!(player_max_hp(&fight) == 100, 0);

  cast::apply_effect_for_testing(
    &mut fight, 0, 0, PLAYER_CELL, &ps, 1, PLAYER_CELL,
    &vitality_alter(spell_effect::stat_vitality(), 60, false, 2, spell_effect::tf_not_enemy()), &mut rng,
  );
  assert!(player_max_hp(&fight) == 160, 1);
  assert!(player_hp(&fight) == 100, 2); // capacity only — no free heal

  cast::tick_turn_end(&mut fight, false, 0);
  assert!(player_max_hp(&fight) == 160, 3); // one turn still on the row
  cast::tick_turn_end(&mut fight, false, 0);
  assert!(player_max_hp(&fight) == 100, 4); // expired → exactly the gain given back, nothing leaked
  ts::return_shared(fight);
  sc.end();
}

#[test]
/// Stat id 10 (MAX_HP) is the same capacity fact under its own id — the arm must not key off vitality alone.
fun timed_max_hp_buff_raises_player_max_hp() {
  let mut sc = ts::begin(OWNER);
  let mut fight = one_mob(&mut sc, spec(1000));
  let ps = z();
  let mut rng = 1u64;
  cast::apply_effect_for_testing(
    &mut fight, 0, 0, PLAYER_CELL, &ps, 1, PLAYER_CELL,
    &vitality_alter(spell_effect::stat_max_hp(), 25, false, 1, spell_effect::tf_not_enemy()), &mut rng,
  );
  assert!(player_max_hp(&fight) == 125, 0);
  cast::tick_turn_end(&mut fight, false, 0);
  assert!(player_max_hp(&fight) == 100, 1);
  ts::return_shared(fight);
  sc.end();
}

#[test]
/// A PERMANENT (turns==0) vitality buff has no row and no revert: the capacity is simply the fighter's now.
fun permanent_vitality_buff_raises_player_max_hp_forever() {
  let mut sc = ts::begin(OWNER);
  let mut fight = one_mob(&mut sc, spec(1000));
  let ps = z();
  let mut rng = 1u64;
  cast::apply_effect_for_testing(
    &mut fight, 0, 0, PLAYER_CELL, &ps, 1, PLAYER_CELL,
    &vitality_alter(spell_effect::stat_vitality(), 40, false, 0, spell_effect::tf_not_enemy()), &mut rng,
  );
  assert!(player_max_hp(&fight) == 140, 0);
  cast::tick_turn_end(&mut fight, false, 0);
  cast::tick_turn_end(&mut fight, false, 0);
  assert!(player_max_hp(&fight) == 140, 1);
  ts::return_shared(fight);
  sc.end();
}

#[test]
/// The DEBUFF half: a negative vitality line shaves capacity (and drags current HP down with it, the
/// `remove_max_hp_bonus` clamp), and expiry hands the capacity back.
fun timed_vitality_debuff_lowers_then_restores_player_max_hp() {
  let mut sc = ts::begin(OWNER);
  let mut fight = one_mob(&mut sc, spec(1000));
  let ps = z();
  let mut rng = 1u64;
  cast::apply_effect_for_testing(
    &mut fight, 0, 0, PLAYER_CELL, &ps, 1, PLAYER_CELL,
    &vitality_alter(spell_effect::stat_vitality(), 30, true, 1, spell_effect::tf_none()), &mut rng,
  );
  assert!(player_max_hp(&fight) == 70, 0);
  assert!(player_hp(&fight) == 70, 1); // current HP cannot exceed the new capacity
  cast::tick_turn_end(&mut fight, false, 0);
  assert!(player_max_hp(&fight) == 100, 2);
  assert!(player_hp(&fight) == 70, 3); // the clamp is not a heal on the way back
  ts::return_shared(fight);
  sc.end();
}

#[test]
/// The MOB sink is the same law (`apply_to_mob`'s alter arm): a vitality buff on an enemy mob moves its
/// capacity, and expiry at the mob's own turn-end gives it back.
fun timed_vitality_buff_raises_then_restores_mob_max_hp() {
  let mut sc = ts::begin(OWNER);
  let mut fight = one_mob(&mut sc, spec(500));
  let ps = z();
  let mut rng = 1u64;
  assert!(mob_max_hp(&fight) == 500, 0);
  cast::apply_effect_for_testing(
    &mut fight, 0, 0, PLAYER_CELL, &ps, 1, MOB0,
    &vitality_alter(spell_effect::stat_vitality(), 60, false, 1, spell_effect::tf_not_team()), &mut rng,
  );
  assert!(mob_max_hp(&fight) == 560, 1);
  cast::tick_turn_end(&mut fight, true, 0);
  assert!(mob_max_hp(&fight) == 500, 2);
  ts::return_shared(fight);
  sc.end();
}
