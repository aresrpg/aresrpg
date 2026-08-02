// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// MOB EFFECTS — proof that points/alter effects LAND on mobs for real (the old
/// `apply_to_mob` "skipped (flagged)" no-op is gone). Drives the exact dispatch two ways: player→mob effects
/// through `cast::apply_effect_for_testing` (a hand-built `Effect`, no SpellTemplate/band ceremony), and mob→ally
/// synergy through the real `cast::resolve_mob_cast` (kit spells need no minting). Covers: per-mob mutable block
/// isolation, permanent + timed alters (with expiry re-derivation), resist-shred raising player→mob damage by the
/// EXACT formula, timed shred reducing a mob's OUTGOING damage then wearing off, AP/MP drains persisting through
/// `begin_turn` to constrain the next act, clamp-at-zero over-drain, steal (both halves), ally-mob buff/feed, and
/// the agility-contested dodge.
#[test_only]
module aresrpg_fight::mob_effects_tests;

use aresrpg_fight::{cast, fight::{Self, Fight}, mob::{Self, MobSpec}, participant, turns, version::Version};
use aresrpg_fight::fight_scaffold::{combatant, create_fight, mk_clock, stand_up, tsregs_for};
use aresrpg_foundation::{spell::{Self, Stats}, spell_board, spell_effect::{Self, Effect, SpellLevel}, spell_formula};
use sui::{clock, test_scenario::{Self as ts, Scenario}};

const OWNER: address = @0xA;
const CHAR: address = @0xC0;
const WORLD: address = @0x704D;
const PLAYER_CELL: u64 = 200;
const MOB0: u64 = 100;
const MOB1: u64 = 101;

// ── builders ──────────────────────────────────────────────────────────────────
fun z(): Stats { spell::new_stats(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0) }
// new_stats(strength, int, chance, agility, raw, crit, range, fire_res, water_res, earth_res, air_res)
fun with_earth_res(r: u64): Stats { spell::new_stats(0, 0, 0, 0, 0, 0, 0, 0, 0, r, 0) }
fun with_agility(a: u64): Stats { spell::new_stats(0, 0, 0, a, 0, 0, 0, 0, 0, 0, 0) } // arg4 = agility
fun with_strength(s: u64): Stats { spell::new_stats(s, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0) }
fun wisdom_caster(w: u64): Stats { let mut s = z(); spell::set_ext_gear(&mut s, w, 0, 0, 0); s }

fun single(effect: Effect): SpellLevel {
  spell_effect::new_spell_level(1, 4, 0, 40, false, false, false, false, 255, 255, 0, 0, false, vector[], vector[], vector[effect], vector[])
}
fun spec(stats: Stats, ap: u64, mp: u64, hp: u64, kit: vector<SpellLevel>): MobSpec {
  mob::new_mob_spec(1, 1, hp, ap, mp, stats, kit, 100, vector[])
}
fun earth_dmg(base: u64): Effect { spell_effect::damage(spell::el_earth(), base) }
/// alter_resist by element, signed, timed (dispellable off). `amount` is the AUTHORED magnitude; the row stores
/// it CENTERED at 32768 like every signed value on chain (#904) — the sign lives in the value, not the flag.
fun resist_alter(element: u8, amount: u64, negative: bool, turns: u8): Effect {
  let flags = if (negative) spell_effect::flag_negative() else 0;
  let filter = if (negative) spell_effect::tf_not_team() else spell_effect::tf_not_enemy();
  let value = participant::centered_value(amount, negative);
  spell_effect::new_effect(spell_effect::k_alter_resist(), element, value, spell_effect::shape_point(), 0, filter, 100, turns, 0, flags, spell_effect::phase_on_enter())
}
fun steal_ap(n: u64): Effect {
  spell_effect::new_effect(spell_effect::k_steal_points(), 255, n, spell_effect::shape_point(), 0, spell_effect::tf_not_team(), 100, 0, spell_effect::point_ap(), 0, spell_effect::phase_on_enter())
}

fun mk_fight(sc: &mut Scenario, s: MobSpec, group: u16) {
  sc.next_tx(OWNER);
  let (mut registry, mut latch) = tsregs_for(sc, object::id_from_address(WORLD), object::id_from_address(CHAR));
  let ver = sc.take_shared<Version>();
  let clock = mk_clock(sc, 1000);
  fight::create_for_testing(&mut registry, &mut latch, object::id_from_address(WORLD), 1, 12345, 100, 200, 0, true, option::none(), &s, group, combatant(CHAR, 100), &ver, &clock, sc.ctx());
  clock::destroy_for_testing(clock);
  ts::return_shared(latch);
  ts::return_shared(registry);
  ts::return_shared(ver);
}

/// stand up + one-mob fight, positioned: player at PLAYER_CELL, mob 0 at MOB0. Returns the shared Fight.
fun one_mob(sc: &mut Scenario, s: MobSpec): Fight {
  stand_up(sc);
  mk_fight(sc, s, 1);
  sc.next_tx(OWNER);
  let mut fight = sc.take_shared<Fight>();
  participant::set_cell(fight::participants_mut(&mut fight).borrow_mut(0), PLAYER_CELL);
  mob::set_cell(fight::mobs_mut(&mut fight).borrow_mut(0), MOB0);
  fight
}

fun mob_earth_res(f: &Fight, midx: u64): u64 { spell::stat_earth_resistance(mob::stats(fight::mobs(f).borrow(midx))) }

// ══════════════════ [ alters on mobs — permanent · timed · expiry · isolation ] ══════════════════

#[test]
/// A PERMANENT (turns==0) resist shred lands on the mob's BASE block and persists (no row); a TIMED shred folds
/// on top and RE-DERIVES; expiry (the mob's turn-end) restores the base — no leaked gain, no stale block.
fun mob_permanent_and_timed_alters_and_expiry() {
  let mut sc = ts::begin(OWNER);
  let mut fight = one_mob(&mut sc, spec(with_earth_res(50), 6, 6, 1000, vector[]));
  let ps = z();
  let mut rng = 1u64;
  // PERMANENT shred −20 → base 50→30, no row.
  cast::apply_effect_for_testing(&mut fight, 0, 0, PLAYER_CELL, &ps, 1, MOB0, &resist_alter(spell::el_earth(), 20, true, 0), &mut rng);
  assert!(mob_earth_res(&fight, 0) == 30, 0);
  // TIMED shred −10 (2 turns) → live 30→20 (base still 30).
  cast::apply_effect_for_testing(&mut fight, 0, 0, PLAYER_CELL, &ps, 1, MOB0, &resist_alter(spell::el_earth(), 10, true, 2), &mut rng);
  assert!(mob_earth_res(&fight, 0) == 20, 1);
  // #2000 — the authored 2 covers the mob's next TWO turn-starts; the third finds it spent and re-derives back
  // to the PERMANENT base 30.
  cast::tick_turn_expiry(&mut fight, true, 0);
  assert!(mob_earth_res(&fight, 0) == 20, 2); // two turns left
  cast::tick_turn_expiry(&mut fight, true, 0);
  assert!(mob_earth_res(&fight, 0) == 20, 3); // its last covered turn
  cast::tick_turn_expiry(&mut fight, true, 0);
  assert!(mob_earth_res(&fight, 0) == 30, 4); // expired → back to permanent base (not the debuffed 20, not the pristine 50)
  ts::return_shared(fight);
  sc.end();
}

#[test]
/// A shred on ONE mob never touches its clone (per-mob block, not the shared kit).
fun mob_alter_is_per_instance() {
  let mut sc = ts::begin(OWNER);
  stand_up(&mut sc);
  mk_fight(&mut sc, spec(with_earth_res(40), 6, 6, 1000, vector[]), 2);
  sc.next_tx(OWNER);
  let mut fight = sc.take_shared<Fight>();
  mob::set_cell(fight::mobs_mut(&mut fight).borrow_mut(0), MOB0);
  mob::set_cell(fight::mobs_mut(&mut fight).borrow_mut(1), MOB1);
  let ps = z();
  let mut rng = 1u64;
  cast::apply_effect_for_testing(&mut fight, 0, 0, PLAYER_CELL, &ps, 1, MOB0, &resist_alter(spell::el_earth(), 40, true, 3), &mut rng);
  assert!(mob_earth_res(&fight, 0) == 0, 0);  // shredded
  assert!(mob_earth_res(&fight, 1) == 40, 1); // the clone is untouched
  ts::return_shared(fight);
  sc.end();
}

// ══════════════════ [ resist shred raises player→mob damage by the EXACT formula ] ══════════════════

#[test]
fun resist_shred_raises_mob_damage_taken() {
  let mut sc = ts::begin(OWNER);
  let mut fight = one_mob(&mut sc, spec(with_earth_res(40), 6, 6, 1000, vector[]));
  let ps = z(); // plain caster: amplify = base
  let mut rng = 1u64;
  // baseline: 100 earth vs 40% resist → 60. hp 1000→940.
  cast::apply_effect_for_testing(&mut fight, 0, 0, PLAYER_CELL, &ps, 1, MOB0, &earth_dmg(100), &mut rng);
  assert!(mob::hp(fight::mobs(&fight).borrow(0)) == 940, 0);
  // shred earth resist to 0 (timed).
  cast::apply_effect_for_testing(&mut fight, 0, 0, PLAYER_CELL, &ps, 1, MOB0, &resist_alter(spell::el_earth(), 40, true, 3), &mut rng);
  // now 100 earth vs 0% resist → 100. hp 940→840 (the shred raised the hit 60→100, exactly).
  cast::apply_effect_for_testing(&mut fight, 0, 0, PLAYER_CELL, &ps, 1, MOB0, &earth_dmg(100), &mut rng);
  assert!(mob::hp(fight::mobs(&fight).borrow(0)) == 840, 1);
  // the exact expected on the shredded block.
  assert!(spell_formula::final_damage(100, spell::el_earth(), &ps, mob::stats(fight::mobs(&fight).borrow(0))) == 100, 2);
  ts::return_shared(fight);
  sc.end();
}

// ══════════════════ [ timed shred reduces a mob's OUTGOING damage, then wears off ] ══════════════════

#[test]
fun timed_strength_shred_softens_mob_outgoing_then_expires() {
  let mut sc = ts::begin(OWNER);
  // mob str 100, earth-damage kit (spell 0), high hp player survives.
  let mut fight = one_mob(&mut sc, spec(with_strength(100), 6, 6, 500, vector[single(earth_dmg(100))]));
  let mut rng = 5u64;
  // mob casts earth dmg: amplify 100*(100+100)/100 = 200, player plain resist 0 → 200. hp 100→ dead? player hp 100.
  // Use a resilient player: heal it up first is overkill — instead read the HIT via hp delta with a big pool.
  participant::set_hp_for_testing(fight::participants_mut(&mut fight).borrow_mut(0), 1000);
  cast::resolve_mob_cast(&mut fight, 0, 0, PLAYER_CELL, &mut rng); // 200 dmg → 1000→800
  assert!(participant::hp(fight::participants(&fight).borrow(0)) == 800, 0);
  // shred the mob's strength by 50 (timed) via a player debuff → mob live str 100→50.
  let ps = z();
  cast::apply_effect_for_testing(&mut fight, 0, 0, PLAYER_CELL, &ps, 1, MOB0, &spell_effect::alter_stat(spell_effect::stat_strength(), participant::centered_value(50, true), true, false, 2), &mut rng);
  cast::resolve_mob_cast(&mut fight, 0, 0, PLAYER_CELL, &mut rng); // now 100*(100+50)/100 = 150 → 800→650
  assert!(participant::hp(fight::participants(&fight).borrow(0)) == 650, 1);
  // expire the shred (#2000: an authored 2 covers two further turn-starts, so the THIRD clears it) → str back to 100.
  cast::tick_turn_expiry(&mut fight, true, 0);
  cast::tick_turn_expiry(&mut fight, true, 0);
  cast::tick_turn_expiry(&mut fight, true, 0);
  cast::resolve_mob_cast(&mut fight, 0, 0, PLAYER_CELL, &mut rng); // 200 again → 650→450
  assert!(participant::hp(fight::participants(&fight).borrow(0)) == 450, 2);
  ts::return_shared(fight);
  sc.end();
}

// ══════════════════ [ AP/MP drains persist through begin_turn (constrain the next act) + clamp ] ══════════════════

#[test]
fun ap_drain_persists_through_begin_turn_and_clamps() {
  let mut sc = ts::begin(OWNER);
  let mut fight = one_mob(&mut sc, spec(z(), 6, 6, 1000, vector[]));
  let ps = wisdom_caster(50);
  let mut rng = 1u64;
  // GUARANTEED drain 4 AP (dodge flag off): removed 4, mob ap 6→2 immediately + a debt row.
  cast::apply_effect_for_testing(&mut fight, 0, 0, PLAYER_CELL, &ps, 1, MOB0, &spell_effect::remove_points(spell_effect::point_ap(), 4, false), &mut rng);
  assert!(mob::ap(fight::mobs(&fight).borrow(0)) == 2, 0);
  // THE MOB'S NEXT TURN, in the real order (#2000 turns.move:resolve_mob_turn): expiry → point_adjust → refill.
  // The authored 1 still has this turn coming, so the debt is read and the refill is base − debt (2), not 6.
  cast::tick_turn_expiry(&mut fight, true, 0);
  let (ap_debt, mp_debt, ap_cr, mp_cr) = cast::point_adjust(&fight, true, 0);
  assert!(ap_debt == 4 && mp_debt == 0 && ap_cr == 0 && mp_cr == 0, 1);
  mob::begin_turn(fight::mobs_mut(&mut fight).borrow_mut(0), 6, 6, ap_debt, mp_debt, ap_cr, mp_cr);
  assert!(mob::ap(fight::mobs(&fight).borrow(0)) == 2, 2);
  // the FOLLOWING turn opens on a spent row → it expires there and that refill is full.
  cast::tick_turn_expiry(&mut fight, true, 0);
  let (ap_debt2, _mp2, _ac2, _mc2) = cast::point_adjust(&fight, true, 0);
  assert!(ap_debt2 == 0, 3);
  mob::begin_turn(fight::mobs_mut(&mut fight).borrow_mut(0), 6, 6, ap_debt2, 0, 0, 0);
  assert!(mob::ap(fight::mobs(&fight).borrow(0)) == 6, 4);
  // OVER-DRAIN: request 100 vs base 6 → removed capped at the base, pool floored at 0, debt 6, refill floors at 0 (no wrap).
  cast::apply_effect_for_testing(&mut fight, 0, 0, PLAYER_CELL, &ps, 1, MOB0, &spell_effect::remove_points(spell_effect::point_ap(), 100, false), &mut rng);
  assert!(mob::ap(fight::mobs(&fight).borrow(0)) == 0, 5);
  let (ap_debt3, _m3, _ac3, _mc3) = cast::point_adjust(&fight, true, 0);
  assert!(ap_debt3 == 6, 6);
  mob::begin_turn(fight::mobs_mut(&mut fight).borrow_mut(0), 6, 6, ap_debt3, 0, 0, 0);
  assert!(mob::ap(fight::mobs(&fight).borrow(0)) == 0, 7); // 6 − 6 = 0, floored (never underflows)
  ts::return_shared(fight);
  sc.end();
}

#[test]
/// MOB_DEBUFF_HAT P1 #1 (spent-pool drain — the scenario the fresh-pool suite masked): the mob already SPENT
/// most of its AP (residual 1/6, exactly the mid-turn-cycle state every real drain lands in). The contest runs
/// against the REFILL BASE, so the full 4 lands as debt and the next begin_turn refills to base − 4 — under the
/// old residual-capped read, removed was 1 and the "drained" boss refilled to 5.
fun spent_pool_drain_lands_full_debt() {
  let mut sc = ts::begin(OWNER);
  let mut fight = one_mob(&mut sc, spec(z(), 6, 6, 1000, vector[]));
  mob::spend_ap(fight::mobs_mut(&mut fight).borrow_mut(0), 5); // residual 1/6 — the pool a drain really meets
  let ps = wisdom_caster(50);
  let mut rng = 1u64;
  cast::apply_effect_for_testing(&mut fight, 0, 0, PLAYER_CELL, &ps, 1, MOB0, &spell_effect::remove_points(spell_effect::point_ap(), 4, false), &mut rng);
  assert!(mob::ap(fight::mobs(&fight).borrow(0)) == 0, 0); // immediate half floors at the residual (1 → 0)
  let (ap_debt, mp_debt, ap_cr, mp_cr) = cast::point_adjust(&fight, true, 0);
  assert!(ap_debt == 4, 1); // the FULL contested count — not the residual-capped 1
  mob::begin_turn(fight::mobs_mut(&mut fight).borrow_mut(0), 6, 6, ap_debt, mp_debt, ap_cr, mp_cr);
  assert!(mob::ap(fight::mobs(&fight).borrow(0)) == 2, 2); // refill = base 6 − debt 4, NOT full
  ts::return_shared(fight);
  sc.end();
}

#[test]
/// MOB_DEBUFF_HAT P1 #2 (feed-then-act): the ally's give lands BETWEEN the boss's turns; the boss's own
/// begin_turn KEEPS the credit (refill = base − debt + credit) — the MP at act time is the proof. The credit
/// expires at the boss's turn-end (exactly one boosted turn), and net_refill's fold order keeps a fed remainder
/// even when debt exceeds base.
fun ally_feed_survives_begin_turn() {
  let mut sc = ts::begin(OWNER);
  let kit = vector[single(spell_effect::give_points(spell_effect::point_mp(), 2))];
  stand_up(&mut sc);
  mk_fight(&mut sc, spec(z(), 6, 6, 1000, kit), 2);
  sc.next_tx(OWNER);
  let mut fight = sc.take_shared<Fight>();
  mob::set_cell(fight::mobs_mut(&mut fight).borrow_mut(0), MOB0); // the support ally (acting)
  mob::set_cell(fight::mobs_mut(&mut fight).borrow_mut(1), MOB1); // the boss
  let mut rng = 9u64;
  cast::resolve_mob_cast(&mut fight, 0, 0, MOB1, &mut rng); // ally feeds boss +2 MP
  assert!(mob::mp(fight::mobs(&fight).borrow(1)) == 8, 0); // immediate half
  // the boss's OWN turn, in the real order (#2000): expiry → point_adjust → begin_turn folds the credit —
  // MP at act time is 8, not the pre-fix wiped 6.
  cast::tick_turn_expiry(&mut fight, true, 1);
  let (ad, md, ac, mc) = cast::point_adjust(&fight, true, 1);
  assert!(mc == 2, 1);
  mob::begin_turn(fight::mobs_mut(&mut fight).borrow_mut(1), 6, 6, ad, md, ac, mc);
  assert!(mob::mp(fight::mobs(&fight).borrow(1)) == 8, 2); // the boss ACTS with the fed MP (moves farther)
  // the boss's NEXT turn opens on a spent credit row → it expires there and that refill is back to base.
  cast::tick_turn_expiry(&mut fight, true, 1);
  let (ad2, md2, ac2, mc2) = cast::point_adjust(&fight, true, 1);
  assert!(mc2 == 0, 3);
  mob::begin_turn(fight::mobs_mut(&mut fight).borrow_mut(1), 6, 6, ad2, md2, ac2, mc2);
  assert!(mob::mp(fight::mobs(&fight).borrow(1)) == 6, 4);
  ts::return_shared(fight);
  sc.end();
}

// ══════════════════ [ steal points from a mob — remove + feed the caster, atomically ] ══════════════════

#[test]
fun player_steals_ap_from_mob() {
  let mut sc = ts::begin(OWNER);
  let mut fight = one_mob(&mut sc, spec(z(), 6, 6, 1000, vector[]));
  participant::begin_turn(fight::participants_mut(&mut fight).borrow_mut(0), 0, 0, 0, 0); // player ap → base 6
  let ps = wisdom_caster(50);
  let mut rng = 1u64;
  cast::apply_effect_for_testing(&mut fight, 0, 0, PLAYER_CELL, &ps, 1, MOB0, &steal_ap(3), &mut rng);
  assert!(mob::ap(fight::mobs(&fight).borrow(0)) == 3, 0); // mob lost 3
  assert!(participant::ap(fight::participants(&fight).borrow(0)) == 9, 1); // player gained the 3 removed
  ts::return_shared(fight);
  sc.end();
}

// ══════════════════ [ ally-mob synergy — a support mob BUFFS resist / FEEDS MP to the boss ] ══════════════════

#[test]
fun ally_mob_buffs_resist_and_feeds_points() {
  let mut sc = ts::begin(OWNER);
  // 2-mob group: mob 0 is the support (kit: [resist-buff, give-MP]); mob 1 is the "boss".
  let kit = vector[single(resist_alter(spell::el_earth(), 30, false, 3)), single(spell_effect::give_points(spell_effect::point_mp(), 2))];
  stand_up(&mut sc);
  mk_fight(&mut sc, spec(z(), 6, 6, 1000, kit), 2);
  sc.next_tx(OWNER);
  let mut fight = sc.take_shared<Fight>();
  mob::set_cell(fight::mobs_mut(&mut fight).borrow_mut(0), MOB0);
  mob::set_cell(fight::mobs_mut(&mut fight).borrow_mut(1), MOB1);
  let mut rng = 9u64;
  // support mob 0 casts the resist BUFF at ally mob 1 → mob 1 earth res 0→30 (mob 0 untouched).
  cast::resolve_mob_cast(&mut fight, 0, 0, MOB1, &mut rng);
  assert!(mob_earth_res(&fight, 1) == 30, 0);
  assert!(mob_earth_res(&fight, 0) == 0, 1);
  // support mob 0 FEEDS 2 MP to ally mob 1 (his allies add MP to him) → mob 1 mp 6→8.
  cast::resolve_mob_cast(&mut fight, 0, 1, MOB1, &mut rng);
  assert!(mob::mp(fight::mobs(&fight).borrow(1)) == 8, 2);
  ts::return_shared(fight);
  sc.end();
}

// ══════════════════ [ P2 — start-glyph point effects survive the refill (real turn machine) ] ══════════════════

#[test]
/// MOB_DEBUFF_HAT P2 (turns:213): the player turn now refills BEFORE the start-tick (the mob order), so a
/// start-glyph's +AP lands on the REFILLED pool and survives into the turn. Driven through the REAL turn machine
/// (place → auto-start → resolve_from), not a hand-rolled order — under the old tick-then-refill this asserts 6.
fun player_start_glyph_points_survive_refill() {
  let mut sc = ts::begin(OWNER);
  stand_up(&mut sc);
  create_fight(&mut sc, 50, 1, 0, 1000, true, option::none()); // scaffold: seats CHAR (base_ap 6) + 1 bag mob
  sc.next_tx(OWNER);
  let mut fight = sc.take_shared<Fight>();
  let seat_cell = participant::cell(fight::participants(&fight).borrow(0));
  // a start-phase glyph on the seat's own start cell, payload = +2 AP (point zone covers exactly that cell).
  spell_board::place_glyph(fight::fx_mut(&mut fight), seat_cell, 0, spell_effect::shape_point(), 0, 3, false, vector[spell_effect::give_points(spell_effect::point_ap(), 2)]);
  // place + ready the only seat → auto-start → resolve_from lands the player turn: begin_turn THEN the glyph tick.
  let ver = sc.take_shared<Version>();
  let clock = mk_clock(&mut sc, 2000);
  turns::place_for_testing(&mut fight, object::id_from_address(CHAR), seat_cell, &ver, &clock, OWNER);
  clock::destroy_for_testing(clock);
  ts::return_shared(ver);
  assert!(participant::ap(fight::participants(&fight).borrow(0)) == 8, 0); // refill 6 + glyph 2 — SURVIVED
  ts::return_shared(fight);
  sc.end();
}

// ══════════════════ [ AP/MP-removal DODGE is agility-contested + deterministic ] ══════════════════

#[test]
/// A high-agility mob dodges more of a removal than a low-agility one (same seed, same caster) — and the roll is
/// deterministic (same seed ⇒ same removed). Proves `dodge_term` reads agility. One fight, three mobs (0 + 2 agi
/// 0, mob 1 agi 300) so every fresh `rng` starts from the same seed against an independent mob fid.
fun drain_dodge_is_agility_contested_and_deterministic() {
  let mut sc = ts::begin(OWNER);
  stand_up(&mut sc);
  mk_fight(&mut sc, spec(z(), 6, 6, 1000, vector[]), 3);
  sc.next_tx(OWNER);
  let mut fight = sc.take_shared<Fight>();
  mob::set_cell(fight::mobs_mut(&mut fight).borrow_mut(0), MOB0);
  mob::set_cell(fight::mobs_mut(&mut fight).borrow_mut(1), MOB1);
  mob::set_cell(fight::mobs_mut(&mut fight).borrow_mut(2), 102);
  mob::set_stats_for_testing(fight::mobs_mut(&mut fight).borrow_mut(1), with_agility(300)); // the evasive boss
  let ps = wisdom_caster(200);
  let drain = spell_effect::remove_points(spell_effect::point_ap(), 6, true); // dodgeable

  let mut r_lo = 424242u64;
  cast::apply_effect_for_testing(&mut fight, 0, 0, PLAYER_CELL, &ps, 1, MOB0, &drain, &mut r_lo);
  let removed_lo = 6 - mob::ap(fight::mobs(&fight).borrow(0));
  let mut r_hi = 424242u64;
  cast::apply_effect_for_testing(&mut fight, 0, 0, PLAYER_CELL, &ps, 1, MOB1, &drain, &mut r_hi);
  let removed_hi = 6 - mob::ap(fight::mobs(&fight).borrow(1));
  let mut r_rep = 424242u64;
  cast::apply_effect_for_testing(&mut fight, 0, 0, PLAYER_CELL, &ps, 1, 102, &drain, &mut r_rep);
  let removed_rep = 6 - mob::ap(fight::mobs(&fight).borrow(2));

  assert!(removed_hi < removed_lo, 0);   // agility dodged part of the removal
  assert!(removed_rep == removed_lo, 1); // same seed ⇒ same outcome (client-previewable)
  ts::return_shared(fight);
  sc.end();
}
