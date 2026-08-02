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

use aresrpg_fight::{cast, fight::{Self, Fight}, mob::{Self, MobSpec}, participant, retro_effects, version::Version};
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

/// A TIMED strength alter on the caster — the buff that lives as a BOARD ROW rather than on the base block.
/// This is the one that makes the dead-caster fixture load-bearing: the row is what the death fold drops.
fun timed_strength_buff(amount: u64, turns: u8): Effect {
  spell_effect::alter_stat(
    spell_effect::stat_strength(),
    participant::centered_value(amount, false),
    false,
    false,
    turns,
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

/// Raise the caster's strength by `amount` for `turns` — a timed row on the effect board, not the base block.
fun buff_caster_strength_timed(fight: &mut Fight, amount: u64, turns: u8) {
  let ps = z();
  let mut rng = 1u64;
  cast::apply_effect_for_testing(
    fight, 0, 0, PLAYER_CELL, &ps, 1, PLAYER_CELL, &timed_strength_buff(amount, turns), &mut rng,
  );
}

fun caster_strength(f: &Fight): u64 {
  spell::stat_strength(participant::stats(fight::participants(f).borrow(0)))
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

  // Turn 1 (ageing → tick → end): 2 → 1, then the tick fires at the caster's CURRENT 50 strength. The row has
  // a turn still to come, so the end-turn collection leaves it standing.
  cast::tick_turn_expiry(&mut fight, true, 0);
  assert!(tick_mob_turn_start(&mut fight) == 30, 0);
  cast::tick_turn_end(&mut fight, true, 0);
  assert!(spell_board::status_count(fight::fx(&fight)) == 1, 1);

  // Between the turns the caster doubles its strength — the poison is a live line, not a frozen number.
  buff_caster_strength(&mut fight, 50);

  // Turn 2: ageing takes 1 → 0 and KEEPS the row (D42: the turn its counter lands on 0 is its LAST covered
  // one), so the authored 2 still bites twice — this last tick priced off the caster's new 100 strength.
  // Its turn END is then where the spent row is collected (#2033), never a round later.
  cast::tick_turn_expiry(&mut fight, true, 0);
  assert!(tick_mob_turn_start(&mut fight) == 40, 2);
  cast::tick_turn_end(&mut fight, true, 0);
  assert!(spell_board::status_count(fight::fx(&fight)) == 0, 3);

  // Turn 3: nothing left to age and nothing to bite — the authored count is exactly what D42 promises.
  cast::tick_turn_expiry(&mut fight, true, 0);
  assert!(tick_mob_turn_start(&mut fight) == 0, 4);

  ts::return_shared(fight);
  sc.end();
}

// ══════════════════ [ the DEAD caster — RULED (a), the general rule with no special case ] ══════════════════

#[test]
/// D41 rider, RULED (a) 2026-08-02: a poison whose caster DIES keeps scaling off that caster's DEATH-MOMENT
/// stats — the general rule applied with no special case, which is the faithful port (the reference's own source
/// carries no dead-caster branch, so its general rule ran there too).
///
/// The buff is a TIMED row on purpose: that is what makes the fixture load-bearing. `spell_board::clear_fighter`
/// drops the corpse's rows WITHOUT running their reverts, so the derived stat block is left standing at the value
/// it held when the fighter died — buff included — and nothing afterwards re-derives it (the corpse takes no turn,
/// and every cast sink enumerates LIVING targets only). The no-revert purge IS the freeze mechanism.
///
/// STABILITY is the other half of the pin: two further bearer turns after the death read the SAME 30. A design
/// that reverted at the purge, or re-derived the corpse later, would decay to the unbuffed 20; one that dropped
/// the source would read 0.
fun dead_casters_poison_keeps_its_death_moment_stats() {
  let mut sc = ts::begin(OWNER);
  let mut fight = one_mob(&mut sc, spec(z(), 1000));
  buff_caster_strength_timed(&mut fight, 50, 6);
  assert!(caster_strength(&fight) == 50, 0);

  spell_board::apply_dot(
    fight::fx_mut(&mut fight), MOB_FID, PLAYER_FID, spell_effect::apply_dot(spell::el_earth(), 20, 8),
  );
  cast::tick_turn_expiry(&mut fight, true, 0);
  assert!(tick_mob_turn_start(&mut fight) == 30, 1); // alive caster: 20 × (100 + 50)/100

  // THE CASTER DIES — through the real damage door, so the real death fold runs.
  assert!(retro_effects::force_death(&mut fight, false, 0), 2);
  assert!(!participant::is_alive(fight::participants(&fight).borrow(0)), 3);
  // the purge took the timed row and left NO revert behind it: the block is frozen at its death-moment value
  assert!(spell_board::fighter_status_rows_of(fight::fx(&fight), PLAYER_FID, spell_effect::k_alter_stat()).is_empty(), 4);
  assert!(caster_strength(&fight) == 50, 5);

  // …and the poison outlives its caster at exactly that scaling, turn after turn.
  cast::tick_turn_expiry(&mut fight, true, 0);
  assert!(tick_mob_turn_start(&mut fight) == 30, 6);
  cast::tick_turn_expiry(&mut fight, true, 0);
  assert!(tick_mob_turn_start(&mut fight) == 30, 7); // STABLE — not the unbuffed 20, not 0

  ts::return_shared(fight);
  sc.end();
}

#[test]
/// The corner rider (a)≡(b) rests on: NO row keyed on the corpse survives its death fold, whoever SOURCED it, so
/// no later expiry can shift a corpse's stats. `spell_board::clear_fighter` filters on the BEARER alone
/// (`s.fighter != fighter_id`), so a third party's row on the corpse goes with the corpse's own — and rows the
/// corpse SOURCED on OTHERS survive by design, reverting their own bearers and never touching the corpse.
fun the_death_fold_purges_every_row_the_corpse_bears_whoever_sourced_it() {
  let mut sc = ts::begin(OWNER);
  let mut fight = one_mob(&mut sc, spec(z(), 1000));
  // a row the caster bears but the MOB sourced (a third party), alongside one it sourced itself
  spell_board::add_status(fight::fx_mut(&mut fight), PLAYER_FID, MOB_FID, timed_strength_buff(50, 6));
  spell_board::add_status(fight::fx_mut(&mut fight), PLAYER_FID, PLAYER_FID, timed_strength_buff(10, 6));
  // …and one the caster SOURCED on the mob, which must OUTLIVE it
  spell_board::add_status(fight::fx_mut(&mut fight), MOB_FID, PLAYER_FID, timed_strength_buff(10, 6));
  assert!(spell_board::status_count(fight::fx(&fight)) == 3, 0);

  assert!(retro_effects::force_death(&mut fight, false, 0), 1);

  // every row the corpse BORE is gone — third-party-sourced included, so none can expire later
  assert!(spell_board::fighter_status_rows_of(fight::fx(&fight), PLAYER_FID, spell_effect::k_alter_stat()).is_empty(), 2);
  // the row it SOURCED on the mob survives, exactly as a poison outliving its caster does
  assert!(spell_board::fighter_status_rows_of(fight::fx(&fight), MOB_FID, spell_effect::k_alter_stat()).length() == 1, 3);
  assert!(spell_board::status_count(fight::fx(&fight)) == 1, 4);

  ts::return_shared(fight);
  sc.end();
}

// ══════════════════ [ #2017 — the OVERLAP: a glyph payload and a DoT in ONE tick batch ] ══════════════════

#[test]
/// #2017 — THE BATCH IS ONE VECTOR. A fighter standing in a start-phase glyph WHILE poisoned takes both lines
/// from a single `spell_board::tick_start_rows` batch: the glyph's payload effects FIRST (in `cell_entries`
/// order), then its own DoT rows. `cast::apply_board_batch_from` indexes that whole vector with `e`, which is
/// BOTH the damage roll's slot and the per-effect source lookup — so the two lines resolve different casters
/// off the same index space, and which line gets which is decided by that ordering alone.
///
/// The overlap is what makes the ordinal load-bearing rather than cosmetic: with D41 resolving a source per
/// effect, an ordinal that counted DoT rows alone would hand the DoT the GLYPH's (sourceless) slot. Here the
/// glyph line stays flat at its authored 20 (anonymous — a board cell owns it) and the DoT line amplifies off
/// its 50-strength caster to 30, in one turn-start, off one batch: 50 HP in total.
fun glyph_and_dot_share_one_batch_and_keep_their_own_sources() {
  let mut sc = ts::begin(OWNER);
  let mut fight = one_mob(&mut sc, spec(z(), 1000));
  buff_caster_strength(&mut fight, 50);

  // the mob stands in a start-phase glyph AND carries the player's poison
  spell_board::place_glyph(
    fight::fx_mut(&mut fight), MOB0, 0, spell_effect::shape_point(), 0, 3, false,
    vector[spell_effect::damage(spell::el_earth(), 20)],
  );
  spell_board::apply_dot(
    fight::fx_mut(&mut fight), MOB_FID, PLAYER_FID, spell_effect::apply_dot(spell::el_earth(), 20, 4),
  );

  // glyph line 20 (sourceless, flat) + DoT line 30 (20 × 150/100, off its live caster) — one batch, one turn.
  assert!(tick_mob_turn_start(&mut fight) == 50, 0);

  // and the glyph alone is still flat with the DoT gone: the 20 above was never the caster-scaled 30.
  spell_board::clear_fighter_status_kind(fight::fx_mut(&mut fight), MOB_FID, spell_effect::k_apply_dot());
  assert!(tick_mob_turn_start(&mut fight) == 20, 1);

  ts::return_shared(fight);
  sc.end();
}

// ══════════════════ [ #2033 — coverage STOPS at the final covered turn's END ] ══════════════════

/// A flat ARMOR row (kind 24 — `spell_board::mitigate_damage` subtracts its value from every incoming line).
/// Passive by nature: it is read by whoever is ACTING, which is what makes its removal TIMING observable from
/// outside the bearer's own turn.
fun armor_row(value: u64, turns: u8): Effect {
  spell_effect::new_effect(
    spell_effect::k_reduce_damage(), spell::el_none(), value, spell_effect::shape_point(), 0,
    spell_effect::tf_not_enemy(), 100, turns, 0, 0, spell_effect::phase_on_enter(),
  )
}

#[test]
/// #2033 — THE ENEMY WINDOW. An authored 1 covers the bearer's next turn and NOTHING after it. The bug this
/// pins: a spent row (counter 0) used to survive from the end of its last covered turn until the bearer's NEXT
/// turn start, so it kept mitigating through the whole enemy round in between — a round of armor the reference
/// never grants (araknemu removes at the bearer's end-turn decrement; ours tombstone-collected a round late).
///
/// The probe is a hit landing in exactly that window, which is where a PASSIVE row is read at all: the bearer's
/// covered turn has ended, its next has not begun.
fun a_spent_armor_row_does_not_mitigate_through_the_enemy_window() {
  let mut sc = ts::begin(OWNER);
  let mut fight = one_mob(&mut sc, spec(z(), 1000));
  spell_board::add_status(fight::fx_mut(&mut fight), MOB_FID, MOB_FID, armor_row(15, 1));

  // The bearer's covered turn: ageing spends the counter (1 -> 0) and the row is still armor for that turn…
  cast::tick_turn_expiry(&mut fight, true, 0);
  let before_covered = mob_hp(&fight);
  retro_effects::hit(&mut fight, true, 0, false, 0, false, 40, 0);
  assert!(before_covered - mob_hp(&fight) == 25, 0); // 40 − 15, mitigated on its own covered turn

  // …and its coverage ENDS with that turn.
  cast::tick_turn_end(&mut fight, true, 0);
  assert!(spell_board::fighter_status_rows_of(fight::fx(&fight), MOB_FID, spell_effect::k_reduce_damage()).is_empty(), 1);

  // THE WINDOW: an enemy acts after the bearer's turn ended and before its next begins. Full damage.
  let before_window = mob_hp(&fight);
  retro_effects::hit(&mut fight, true, 0, false, 0, false, 40, 0);
  assert!(before_window - mob_hp(&fight) == 40, 2); // the whole 40 — no lingering armor

  ts::return_shared(fight);
  sc.end();
}

#[test]
/// The other half of the same law: a row with turns still to come is NOT collected by an end-turn, so a 2-turn
/// armor keeps mitigating across the enemy round between its covered turns. Collection is "spent", never "any".
fun an_unspent_armor_row_survives_the_enemy_window() {
  let mut sc = ts::begin(OWNER);
  let mut fight = one_mob(&mut sc, spec(z(), 1000));
  spell_board::add_status(fight::fx_mut(&mut fight), MOB_FID, MOB_FID, armor_row(15, 2));

  cast::tick_turn_expiry(&mut fight, true, 0); // 2 -> 1, one covered turn still to come
  cast::tick_turn_end(&mut fight, true, 0); // not spent -> not collected
  assert!(spell_board::fighter_status_rows_of(fight::fx(&fight), MOB_FID, spell_effect::k_reduce_damage()).length() == 1, 0);

  let before = mob_hp(&fight);
  retro_effects::hit(&mut fight, true, 0, false, 0, false, 40, 0);
  assert!(before - mob_hp(&fight) == 25, 1); // still armored between its own turns

  ts::return_shared(fight);
  sc.end();
}
