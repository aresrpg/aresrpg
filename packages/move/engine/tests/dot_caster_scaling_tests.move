// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// DOT CASTER SCALING (#1999 / D41) — a damage-over-time tick is a damage LINE with a real caster behind it.
///
/// `cast::apply_board_batch_from` used to hand `spell_formula::final_damage` an all-zero caster block for every
/// board tick, so a poison hit for its flat authored base no matter who cast it — flat DoTs that undercut every
/// stat-invested archetype. The board row has carried its source fid since it was first written
/// (`spell_board::apply_dot`), so the fix is a field read, not new state: `spell_board::tick_start_rows` hands
/// the batch's per-effect sources to the sink, which resolves the caster's CURRENT stat block per tick.
///
/// THE DISCRIMINATOR is `buffed_mid_dot_raises_the_next_tick`: a cast-time snapshot and a per-tick read agree on
/// every tick until the caster's stats MOVE between two of them, so only a scenario that buffs mid-poison can
/// tell the two designs apart. The flat-DoT status quo fails it too (all ticks equal).
///
/// The sourceless half is pinned alongside: a glyph payload belongs to a board cell, not to a fighter, and still
/// amplifies off nothing (spell_board's NO_SOURCE sentinel).
#[test_only]
module aresrpg_fight::dot_caster_scaling_tests;

use aresrpg_fight::{cast, fight::{Self, Fight}, mob::{Self, MobSpec}, participant, version::Version};
use aresrpg_fight::fight_scaffold::{combatant, mk_clock, stand_up, tsregs_for};
use aresrpg_foundation::{spell::{Self, Stats}, spell_board, spell_effect::{Self, Effect, SpellLevel}};
use sui::{clock, test_scenario::{Self as ts, Scenario}};

const OWNER: address = @0xA;
const CHAR: address = @0xC0;
const WORLD: address = @0x704D;
const PLAYER_CELL: u64 = 200;
const MOB0: u64 = 100;
const MOB_FID: u64 = 1_000;
const PLAYER_FID: u64 = 0;

// ── builders (mob_effects_tests conventions — copy > abstract) ─────────────────
fun z(): Stats { spell::new_stats(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0) }
// new_stats(strength, int, chance, agility, raw, crit, range, fire_res, water_res, earth_res, air_res)
fun with_earth_res(r: u64): Stats { spell::new_stats(0, 0, 0, 0, 0, 0, 0, 0, 0, r, 0) }

fun spec(stats: Stats, hp: u64): MobSpec {
  mob::new_mob_spec(1, 1, hp, 6, 6, stats, vector<SpellLevel>[], 100, vector[])
}

/// A PERMANENT (turns==0) strength alter on the caster — the honest mid-fight buff: it lands on the base block
/// and `refresh_player_stats` re-derives, exactly as a real buff spell does.
fun strength_alter(amount: u64): Effect {
  spell_effect::alter_stat(
    spell_effect::stat_strength(),
    participant::centered_value(amount, false),
    false,
    false,
    0,
  )
}

fun mk_fight(sc: &mut Scenario, s: MobSpec) {
  sc.next_tx(OWNER);
  let (mut registry, mut latch) = tsregs_for(sc, object::id_from_address(WORLD), object::id_from_address(CHAR));
  let ver = sc.take_shared<Version>();
  let clock = mk_clock(sc, 1000);
  fight::create_for_testing(
    &mut registry, &mut latch, object::id_from_address(WORLD), 1, 12345, 100, 200, 0, true,
    option::none(), &s, 1, combatant(CHAR, 100), &ver, &clock, sc.ctx(),
  );
  clock::destroy_for_testing(clock);
  ts::return_shared(latch);
  ts::return_shared(registry);
  ts::return_shared(ver);
}

/// stand up + one-mob fight, positioned: player at PLAYER_CELL, mob 0 at MOB0.
fun one_mob(sc: &mut Scenario, s: MobSpec): Fight {
  stand_up(sc);
  mk_fight(sc, s);
  sc.next_tx(OWNER);
  let mut fight = sc.take_shared<Fight>();
  participant::set_cell(fight::participants_mut(&mut fight).borrow_mut(0), PLAYER_CELL);
  mob::set_cell(fight::mobs_mut(&mut fight).borrow_mut(0), MOB0);
  fight
}

fun mob_hp(f: &Fight): u64 { mob::hp(fight::mobs(f).borrow(0)) }

/// Raise the caster's strength by `amount` (permanent alter through the ordinary cast sink).
fun buff_caster_strength(fight: &mut Fight, amount: u64) {
  let ps = z();
  let mut rng = 1u64;
  cast::apply_effect_for_testing(
    fight, 0, 0, PLAYER_CELL, &ps, 1, PLAYER_CELL, &strength_alter(amount), &mut rng,
  );
}

/// ONE tick of the mob's turn-start board work; returns the HP it lost to it.
fun tick_mob_turn_start(fight: &mut Fight): u64 {
  let before = mob_hp(fight);
  cast::tick_turn_start(fight, true, 0);
  before - mob_hp(fight)
}

// ══════════════════ [ the caster's stats ARE the DoT's scaling ] ══════════════════

#[test]
/// A DoT sourced by a 50-strength player amplifies off that 50: base 20 × (100 + 50)/100 = 30 per tick, and the
/// victim's 0 earth resistance leaves it there. Under the flat-DoT status quo every tick read 20.
fun dot_tick_amplifies_off_its_casters_stats() {
  let mut sc = ts::begin(OWNER);
  let mut fight = one_mob(&mut sc, spec(z(), 1000));
  buff_caster_strength(&mut fight, 50);
  assert!(spell::stat_strength(participant::stats(fight::participants(&fight).borrow(0))) == 50, 0);

  spell_board::apply_dot(
    fight::fx_mut(&mut fight), MOB_FID, PLAYER_FID, spell_effect::apply_dot(spell::el_earth(), 20, 5),
  );
  assert!(tick_mob_turn_start(&mut fight) == 30, 1); // 20 × 150/100, not the flat 20

  ts::return_shared(fight);
  sc.end();
}

#[test]
/// THE DISCRIMINATOR (#1999 clause 1). Same poison, same victim, same authored base — the caster buffs BETWEEN
/// two ticks and the second tick moves. A cast-time snapshot would repeat the first tick forever; the flat DoT
/// would repeat the authored base forever. Only a per-application read of the caster's CURRENT stats produces
/// 30 then 40.
fun buffed_mid_dot_raises_the_next_tick() {
  let mut sc = ts::begin(OWNER);
  let mut fight = one_mob(&mut sc, spec(z(), 1000));
  buff_caster_strength(&mut fight, 50);

  spell_board::apply_dot(
    fight::fx_mut(&mut fight), MOB_FID, PLAYER_FID, spell_effect::apply_dot(spell::el_earth(), 20, 5),
  );
  let first = tick_mob_turn_start(&mut fight);
  assert!(first == 30, 0); // 20 × (100 + 50)/100

  buff_caster_strength(&mut fight, 50); // the caster is now 100 strength, mid-poison
  let second = tick_mob_turn_start(&mut fight);
  assert!(second == 40, 1); // 20 × (100 + 100)/100 — the SAME row, a stronger caster
  assert!(second > first, 2);

  ts::return_shared(fight);
  sc.end();
}

#[test]
/// The target half is untouched (#1873): mitigation still applies per tick, after the caster's amplification.
/// 20 × 150/100 = 30, then 30% earth resistance → 21.
fun caster_amplification_precedes_target_mitigation() {
  let mut sc = ts::begin(OWNER);
  let mut fight = one_mob(&mut sc, spec(with_earth_res(30), 1000));
  buff_caster_strength(&mut fight, 50);

  spell_board::apply_dot(
    fight::fx_mut(&mut fight), MOB_FID, PLAYER_FID, spell_effect::apply_dot(spell::el_earth(), 20, 5),
  );
  assert!(tick_mob_turn_start(&mut fight) == 21, 0);

  ts::return_shared(fight);
  sc.end();
}

#[test]
/// The SOURCELESS half of the law, unchanged: a glyph payload belongs to a board cell and amplifies off nothing,
/// however strong the fighter standing in it is. Same 50-strength player, same base, no source ⇒ a flat 20.
fun a_glyph_payload_still_amplifies_off_nothing() {
  let mut sc = ts::begin(OWNER);
  let mut fight = one_mob(&mut sc, spec(z(), 1000));
  buff_caster_strength(&mut fight, 50);

  spell_board::place_glyph(
    fight::fx_mut(&mut fight), MOB0, 0, spell_effect::shape_point(), 0, 3, false,
    vector[spell_effect::damage(spell::el_earth(), 20)],
  );
  assert!(tick_mob_turn_start(&mut fight) == 20, 0);

  ts::return_shared(fight);
  sc.end();
}

// ══════════════════ [ D41 × D42 — the cross term ] ══════════════════

#[test]
/// THE CROSS TERM (#1999 × #2000). A DoT's LAST tick under the turn-START decrement cadence: the aging that
/// finds the row spent runs BEFORE the tick batch is collected, so an authored N still bites exactly N times —
/// and the last of those bites reads the caster's stats AT THAT MOMENT, buff included. The two rulings compose
/// without either eating the other: the timing decides HOW MANY ticks, the scaling decides HOW BIG each is.
fun dot_last_tick_under_turn_start_decrement_reads_the_live_caster() {
  let mut sc = ts::begin(OWNER);
  let mut fight = one_mob(&mut sc, spec(z(), 1000));
  buff_caster_strength(&mut fight, 50);

  spell_board::apply_dot(
    fight::fx_mut(&mut fight), MOB_FID, PLAYER_FID, spell_effect::apply_dot(spell::el_earth(), 20, 2),
  );

  // Turn 1: expiry ages 2 → 1, then the tick fires at the caster's CURRENT 50 strength.
  cast::tick_turn_expiry(&mut fight, true, 0);
  assert!(tick_mob_turn_start(&mut fight) == 30, 0);

  // Between the turns the caster doubles its strength — the poison is a live line, not a frozen number.
  buff_caster_strength(&mut fight, 50);

  // Turn 2: expiry ages 1 → 0 and KEEPS the row (D42: its counter landing on 0 is its last covered turn), so
  // the authored 2 still bites twice — this LAST tick priced off the caster's new 100 strength.
  cast::tick_turn_expiry(&mut fight, true, 0);
  assert!(tick_mob_turn_start(&mut fight) == 40, 1);

  // Turn 3: the aging finds the row spent and drops it BEFORE the batch is collected — no third bite, and the
  // authored count is exactly what D42 promises rather than one tick more.
  cast::tick_turn_expiry(&mut fight, true, 0);
  assert!(spell_board::status_count(fight::fx(&fight)) == 0, 2);
  assert!(tick_mob_turn_start(&mut fight) == 0, 3);

  ts::return_shared(fight);
  sc.end();
}
