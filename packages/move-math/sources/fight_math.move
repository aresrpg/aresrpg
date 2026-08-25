// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// The 1.29 combat VALUE layer — pure, integer-only, deterministic. Ported from the shipped
/// formulas, adapted to our stat surface and the 2026-08-09 rulings (dodge = wisdom, tackle =
/// agility). THE TURN-SEED CONTRACT: every random-looking pick of a player turn (damage roll,
/// crit, dodge, tackle) derives from the PUBLIC per-turn seed by domain-tagged slots — the
/// client previews the whole turn before committing. Mob actions draw the crank entropy
/// instead (never previewable). This module computes; it never stores.
module aresrpg_math::fight_math;

use aresrpg_math::{prng, spell_effect::Effect};

public fun sat_sub(a: u64, b: u64): u64 { if (a > b) a - b else 0 }

public fun max_1(value: u64): u64 { if (value == 0) 1 else value }
use std::string::String;

const CRIT_SCALE: u64 = 10000; // fixed-point scale (basis points)
const DOMAIN_CRIT: u64 = 0; // crit stream domain tag
const DOMAIN_TACKLE: u64 = 0x7AC1E; // tackle stream tag
const DOMAIN_EFFECT: u64 = 0xEFEC7; // per-effect chance/secondary stream tag

const DODGE_MIN: u64 = 10; // per-point removal chance clamp floor (10%)
const DODGE_MAX: u64 = 90; // ceiling (90%)

// ╔════════════════ [ §5h — the master damage amplification ] ════════════════ ]

/// The element's scaling characteristic: earth→strength · fire→intelligence · water→chance ·
/// air→agility (4 elements only — no neutral in this game).
public fun primary_stat(element: &String, strength: u64, intelligence: u64, chance: u64, agility: u64): u64 {
  if (*element == b"earth".to_string()) strength
  else if (*element == b"fire".to_string()) intelligence
  else if (*element == b"water".to_string()) chance
  else if (*element == b"air".to_string()) agility
  else 0
}

/// Caster-side amplification: `base × (100 + primary)/100 + raw_damage`.
public fun amplify_damage(base: u64, primary: u64, raw_damage: u64): u64 {
  base * (100 + primary) / 100 + raw_damage
}

/// Resistances are PERCENT game-wide, capped at 50 (owner law 2026-08-10) — immunity
/// never exists; half the damage always lands.
const RESIST_CAP_PCT: u64 = 50;

public fun apply_resistance(damage: u64, resistance_pct: u64): u64 {
  let res = if (resistance_pct > RESIST_CAP_PCT) RESIST_CAP_PCT else resistance_pct;
  damage * (100 - res) / 100
}

/// Punishment base — scaled by the caster's MISSING life: `base × (2·max − hp)/max`
/// (identity at full hp, double at zero, linear between).
public fun punishment_base(base: u64, hp: u64, max_hp: u64): u64 {
  if (max_hp == 0) return base;
  let health = if (hp > max_hp) max_hp else hp;
  base * (2 * max_hp - health) / max_hp
}

/// Heal: `base × (100 + intelligence)/100`.
public fun heal_amount(base: u64, intelligence: u64): u64 {
  base * (100 + intelligence) / 100
}

// ╔════════════════ [ The turn-seed slot streams (client-previewable) ] ══════ ]

/// One stable raw crit draw for a spell during this turn. The canonical spell name separates
/// equal-rate spells; target and cast slot are deliberately absent so aiming and repeated casts
/// cannot reroll it. `crit_at` reduces this draw against the live quotation.
public fun spell_crit_roll(turn_seed: u64, spell_name: &String): u64 {
  let bytes = spell_name.as_bytes();
  let mut roll = prng::mix(turn_seed, DOMAIN_CRIT);
  let mut i = 0;
  while (i < bytes.length()) {
    roll = prng::mix(roll, bytes[i] as u64);
    i = i + 1;
  };
  roll
}

/// The prng STATE a cast's per-effect draws (chance rolls, damage picks — PER TARGET, the
/// 1.29 law — and extra picks) thread from. The ONE damage-roll home: no separate slot
/// stream exists (audit 2026-08-10: a dead `slot_damage_roll` claimed otherwise).
public fun effect_seed(turn_seed: u64, slot: u64): u64 {
  prng::mix(prng::mix(turn_seed, slot), DOMAIN_EFFECT)
}

/// Target-side resistance off a CENTERED value: above center resists (percent, capped at
/// the 50% law), below center is a WEAKNESS — the damage amplifies by the deficit.
public fun apply_centered_resistance(damage: u64, centered: u64, center: u64): u64 {
  if (centered >= center) {
    apply_resistance(damage, centered - center)
  } else {
    damage * (100 + (center - centered)) / 100
  }
}

public fun resist(damage: u64, centered: u64, center: u64): u64 {
  apply_centered_resistance(damage, centered, center)
}

public fun resolved_damage(base: u64, primary: u64, raw_damage: u64, centered: u64, center: u64): u64 {
  resist(amplify_damage(base, primary, raw_damage), centered, center)
}

/// Map a roll fraction onto an authored `[min, max]` (inclusive). `max <= min` ⇒ `min`.
public fun roll_in_range(min: u64, max: u64, roll: u64): u64 {
  if (max <= min) return min;
  min + roll * (max - min + 1) / CRIT_SCALE
}

public fun roll_effect_value(effect: &Effect, state: &mut u64): u64 {
  let min = effect.value() as u64;
  let max = effect.value_max() as u64;
  if (max <= min) return min;
  roll_in_range(min, max, prng::draw(state) % CRIT_SCALE)
}

public fun band_scaled(base: u64, min_level: u64, max_level: u64, level: u64): u64 {
  if (max_level == min_level) return base;
  let span = max_level - min_level;
  base * (6 * span + 10 * (level - min_level)) / (10 * span)
}

/// Scale a SHIFT-centered resistance around neutral. Positive resistance follows the mob's
/// 60%→160% power curve. A weakness reverses that magnitude curve (160%→60%), so a stronger
/// mob always has a less severe negative resistance. Negative deviations saturate at encoded
/// zero because snapshots use unsigned integers.
public fun centered_band_scaled(value: u64, center: u64, min_level: u64, max_level: u64, level: u64): u64 {
  if (value >= center) center + band_scaled(value - center, min_level, max_level, level)
  else {
    let scaled = if (max_level == min_level) center - value else {
      let span = max_level - min_level;
      (center - value) * (16 * span - 10 * (level - min_level)) / (10 * span)
    };
    if (scaled >= center) 0 else center - scaled
  }
}

/// An authored mob drop chance is its band midpoint: 80% at minimum level and 120% at
/// maximum level. A resolved chance remains basis points and never exceeds guaranteed.
public fun mob_loot_chance_scaled(base_bp: u64, min_level: u64, max_level: u64, level: u64): u64 {
  if (max_level == min_level) return base_bp;
  let span = max_level - min_level;
  let scaled = base_bp * (8 * span + 4 * (level - min_level)) / (10 * span);
  if (scaled > CRIT_SCALE) CRIT_SCALE else scaled
}

/// Mob AP/MP keep their authored minimum and reach 130% at band maximum. Pools are discrete,
/// so round to the nearest point instead of silently truncating common 6 AP / 3 MP bands.
public fun mob_pool_scaled(base: u64, min_level: u64, max_level: u64, level: u64): u64 {
  if (max_level == min_level) return base;
  let span = max_level - min_level;
  let denominator = 10 * span;
  let numerator = base * (10 * span + 3 * (level - min_level));
  (numerator + denominator / 2) / denominator
}

public fun apply_centered_shift(base: u64, centered: u64, center: u64): u64 {
  let combined = base + centered;
  if (combined > center) combined - center else 0
}

public fun weave_teams(teams: vector<u8>): vector<u64> {
  let mut side_a = vector[];
  let mut side_b = vector[];
  let mut index = 0;
  while (index < teams.length()) {
    if (teams[index] == 0) side_a.push_back(index) else side_b.push_back(index);
    index = index + 1;
  };
  let side_a_count = side_a.length();
  let side_b_count = side_b.length();
  let mut order = vector[];
  let mut a = 0;
  let mut b = 0;
  while (a < side_a_count || b < side_b_count) {
    let take_a = if (a >= side_a_count) false
    else if (b >= side_b_count) true
    else (side_a_count - a) * side_b_count >= (side_b_count - b) * side_a_count;
    if (take_a) {
      order.push_back(side_a[a]);
      a = a + 1;
    } else {
      order.push_back(side_b[b]);
      b = b + 1;
    };
  };
  order
}

/// The QUOTATION law (owner 2026-08-10 — never percent): a cast crits 1 time in X. The DENOMINATOR
/// is the Dofus 1.29 curve (Araknemu `BaseCriticalityStrategy`, verbatim): the Cri stat (`critical`)
/// subtracts LINEARLY, then AGILITY divides by a log curve (heavy diminishing returns), capped so
/// agility never raises X, floored at 2 (the 1-in-2 cap). 0 base = never crits.
public fun crit_at(crit_roll: u64, crit_1_in: u64, cri: u64, agility: u64): bool {
  if (crit_1_in == 0) return false;
  crit_roll % crit_denominator(crit_1_in, cri, agility) == 0
}

/// X = max(2, min( (base − Cri) × 2.9901 / ln(agility + 12), base − Cri )). All integer: `2.9901`
/// is `29901/10000` and `ln` is the fixed-point `ln_e6` — the sim twin MUST mirror this integer
/// `ln`, never `Math.log`, or client crit prediction desyncs.
public fun crit_denominator(crit_1_in: u64, cri: u64, agility: u64): u64 {
  if (crit_1_in <= 2) return crit_1_in; // Araknemu base<=2 short-circuit (1 → always, 2 → 1/2)
  let base = if (crit_1_in > cri) crit_1_in - cri else 0; // Cri subtracts linearly
  if (base < 2) return 2;
  let scaled = base * 29901 * 1_000_000 / (10_000 * ln_e6(agility + 12)); // base × 2.9901 / ln
  let capped = if (scaled < base) scaled else base; // agility only ever LOWERS X
  if (capped < 2) 2 else capped
}

/// Natural log of `x` (x ≥ 1) as an integer scaled by 1e6: `ln(x) = log2(x) × ln 2`.
public fun ln_e6(x: u64): u64 { log2_e6(x) * 693_147 / 1_000_000 }

/// `log2(x) × 1e6` — floor via bit shifts, then the mantissa fraction by iterated squaring.
fun log2_e6(x: u64): u64 {
  let scale = 1_000_000;
  let mut n = x;
  let mut int_part = 0;
  while (n >= 2) { n = n / 2; int_part = int_part + 1; };
  let mut result = int_part * scale;
  let mut y = x * scale / pow2(int_part); // mantissa in [scale, 2·scale)
  let mut weight = scale / 2;
  while (weight > 0) {
    y = y * y / scale;
    if (y >= 2 * scale) { y = y / 2; result = result + weight; };
    weight = weight / 2;
  };
  result
}

fun pow2(e: u64): u64 { let mut r = 1; let mut i = 0; while (i < e) { r = r * 2; i = i + 1; }; r }

/// The prng STATE a player move's tackle roll draws from — folded with the runner's live MP
/// ONLY (audit 2026-08-10: the cast slot was attacker-controlled — a free spell re-rolled
/// the contest). MP strictly decreases on every step and every toll, so each re-attempt
/// costs movement. No free identical re-roll, no cast-driven re-roll.
public fun tackle_seed(turn_seed: u64, mp: u64): u64 {
  prng::mix(prng::mix(turn_seed, mp), DOMAIN_TACKLE)
}

// ╔════════════════ [ Tackle — the escape contest (agility, both sides) ] ════ ]

/// One agility → contest bucket: `agility/10 + 2` (both sides share the curve).
public fun tackle_bucket(agility: u64): u64 { agility / 10 + 2 }

/// Combine every adjacent locker into ONE exact product fraction `(num, den)`: escape iff
/// `roll < num` for a roll in `[0, den)`. No lockers ⇒ (1, 1) — the caller skips the contest.
public fun tackle_contest(runner_agility: u64, locker_agilities: &vector<u64>): (u64, u64) {
  let dodge = tackle_bucket(runner_agility);
  let n = locker_agilities.length();
  let mut num = 1;
  let mut den = 1;
  let mut i = 0;
  while (i < n) {
    let den_i = 2 * tackle_bucket(locker_agilities[i]);
    num = num * (if (dodge < den_i) dodge else den_i);
    den = den * den_i;
    i = i + 1;
  };
  (num, den)
}

/// A failed escape's pool costs: `ceil(pool × (den − num)/den)` each — the failed FRACTION of
/// both pools. A toll, never a wall: the walk rides whatever survives.
public fun tackle_losses(ap: u64, mp: u64, num: u64, den: u64): (u64, u64) {
  let lost = den - num;
  ((ap * lost + den - 1) / den, (mp * lost + den - 1) / den)
}

// ╔════════════════ [ Push collision (§B, level-scaled, fixed coef) ] ════════ ]

/// Collision damage when a push is BLOCKED: `max(12·level/50, 1) × cells_blocked`, damages the
/// pushed target only. Unblocked push ⇒ 0.
public fun push_collision_damage(caster_level: u64, cells_blocked: u64): u64 {
  if (cells_blocked == 0) return 0;
  let per_cell = { let raw = 12 * caster_level / 50; if (raw < 1) 1 else raw };
  per_cell * cells_blocked
}

// ╔════════════════ [ AP/MP removal dodge (per-point; wisdom vs wisdom) ] ════ ]

/// Remove up to `value` points, one at a time. Each point:
/// `chance = clamp(50 × max(caster_wisdom/10,1)/max(target_wisdom/10,1) × (current−removed)/max, 10, 90)`
/// roll < chance ⇒ remove 1, else the removal STOPS. Fewer remaining points ⇒ harder to steal
/// the next. `dodge = false` (the guaranteed class) removes without any draw.
public fun remove_points(
  rng: u64,
  value: u64,
  dodge: bool,
  caster_wisdom: u64,
  target_wisdom: u64,
  current: u64,
  max: u64,
): (u64, u64) {
  if (!dodge) return (rng, if (value < current) value else current);
  if (max == 0) return (rng, 0);

  let wisdom = { let w = caster_wisdom / 10; if (w < 1) 1 else w };
  let resistance = { let r = target_wisdom / 10; if (r < 1) 1 else r };
  let resist_rate = 50 * wisdom / resistance;

  let mut state = rng;
  let mut removed = 0;
  while (removed < value && removed < current) {
    let raw = resist_rate * (current - removed) / max;
    let chance = if (raw < DODGE_MIN) DODGE_MIN else if (raw > DODGE_MAX) DODGE_MAX else raw;
    let roll = prng::draw(&mut state) % 100;
    if (roll < chance) { removed = removed + 1 } else break
  };
  (state, removed)
}

// ╔════════════════ [ XP — Dofus Retro group balance and proportional split ] ═ ]

// Exact Retro coefficients through Ares's six-seat party cap, stored in tenths.
const RETRO_GROUP_XP_TENTHS: vector<u64> = vector[10, 11, 15, 23, 31, 36];

public fun retro_group_coefficient_tenths(eligible_players: u64): u64 {
  if (eligible_players == 0) return 0;
  let coefficients = RETRO_GROUP_XP_TENTHS;
  let last = coefficients.length() - 1;
  coefficients[if (eligible_players - 1 < last) eligible_players - 1 else last]
}

/// Dofus Retro: total mob base XP × eligible-party coefficient, group-level balance, the
/// player's level share, then Ares's established Wisdom scale (+1% per 6 Wisdom).
public fun xp_for_player(
  base_xp: u64,
  wisdom: u64,
  player_level: u64,
  player_total_level: u64,
  mob_total_level: u64,
  highest_mob_level: u64,
  eligible_players: u64,
): u64 {
  if (
    base_xp == 0 || player_level == 0 || player_total_level == 0 ||
    mob_total_level == 0 || highest_mob_level == 0 || eligible_players == 0
  ) return 0;

  let mut group_xp = base_xp * retro_group_coefficient_tenths(eligible_players) / 10;
  if (mob_total_level > player_total_level + 10) {
    group_xp = group_xp * (player_total_level + 10) / mob_total_level;
  };
  if (player_total_level > mob_total_level + 5) {
    group_xp = group_xp * mob_total_level / player_total_level;
  };
  // Retro's anti-power-leveling gate: the party cannot dwarf the highest monster by >2.5×.
  if (player_total_level * 2 > highest_mob_level * 5) {
    group_xp = group_xp * (highest_mob_level * 5) / (player_total_level * 2);
  };

  group_xp * player_level / player_total_level * (600 + wisdom) / 600
}
