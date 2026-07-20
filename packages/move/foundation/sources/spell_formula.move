/// SPELL FORMULA — the EXACT 1.29 value layer (taxonomy §5h/§A/§B), integer-only + deterministic. This is
/// the load-bearing math the (held) `apply_cast` rewrite calls to turn a fixed `base` + caster/target
/// `spell::Stats` into a final integer. No damage RANGES: `base` is a constant; only the
/// crit BOOLEAN and the AP/MP-dodge roll draw the seeded prng — so a client holding the same on-chain state
/// computes the identical number and only reconciles those booleans.
///
/// Reuses `spell::Stats` + `spell::apply_resistance` (the target-side %resist reducer) + `spell::is_critical`
/// (the crit boolean) so this module never re-implements settled, byte-identical primitives.
module aresrpg_foundation::spell_formula;

use aresrpg_foundation::{prng, spell::{Self, Stats}};

// ╔════════════════ [ §5h — the master 1.29 damage amplification ] ═══════════════ ]

/// Caster's ELEMENT CHARACTERISTIC — the class-scaling identity (taxonomy §5h `Element.java`):
/// Earth & **Neutral** → Strength · Fire → Intelligence · Water → Chance · Air → Agility.
/// ⚠️ DIVERGES from `spell::element_stat_value` on Neutral: that returns 0 for NONE (its "elementless" model),
/// whereas §5h scales Neutral damage with Strength. This module follows §5h (the ticket's law).
public fun primary_stat(caster: &Stats, element: u8): u64 {
  if (element == spell::el_earth() || element == spell::el_none()) spell::stat_strength(caster)
  else if (element == spell::el_fire()) spell::stat_intelligence(caster)
  else if (element == spell::el_water()) spell::stat_chance(caster)
  else if (element == spell::el_air()) spell::stat_agility(caster)
  else 0
}

/// Caster-side amplification (taxonomy §5h `DamageApplier.computeDamage`):
///   `base × (100 + primaryStat + percentDamage)/100 + fixedDamage (+ physicalDamage if earth/neutral)`.
/// `fixedDamage` (effect 112) = `raw_damage`; `percentDamage` (138) + `physicalDamage` (142) now READ their
/// dedicated `spell::Stats` fields (#55 — GAP CLOSED; both default 0, so prior results are byte-identical until
/// a buff/gear sets them). `physicalDamage` adds only on EARTH/NEUTRAL (§5h). `× multiply` (crit/114) is 1 here
/// — crit is the separate higher-fixed effect list, never a multiplier.
public fun amplify_damage(base: u64, element: u8, caster: &Stats): u64 {
  let primary = primary_stat(caster, element);
  let percent = spell::stat_percent_damage(caster);
  let physical = if (element == spell::el_earth() || element == spell::el_none()) spell::stat_physical_damage(caster) else 0;
  base * (100 + primary + percent) / 100 + spell::stat_raw_damage(caster) + physical
}

/// Full damage = §5h amplification then target-side %resist (reusing `spell::apply_resistance`; NONE element now
/// reads `neutral_resistance` — #55 GAP CLOSED). Floored at 0 by the reducer.
public fun final_damage(base: u64, element: u8, caster: &Stats, target: &Stats): u64 {
  let amplified = amplify_damage(base, element, caster);
  spell::apply_resistance(amplified, element, target)
}

/// Heal (taxonomy §5h + D149-W3 reference-corpus fidelity): `base × (100 + intelligence)/100 + healStat` — the flat
/// heal stat (gear "heal" lines / AlterStat(11) buffs) rides ON TOP of the int curve, exactly the server rule.
public fun heal_amount(base: u64, caster: &Stats): u64 {
  base * (100 + spell::stat_intelligence(caster)) / 100 + spell::stat_heal(caster)
}

// ╔════════════════ [ §5h/§D — deterministic crit boolean (the ONLY damage RNG) ] ═ ]

/// Roll the crit boolean — the single random input to the damage path. `crit_rate` is the base 1-in-X chance;
/// `crit_bonus` lowers X (agility feeds crit, project law; exact agi→bonus coefficient is NOT in the taxonomy
/// → passed in by the caller, flagged). On `true` the resolver swaps to the spell's `crit_effects` (a higher
/// FIXED base — no multiplier). Thin wrapper over `spell::is_critical` so the crit rule has one home.
public fun roll_crit(rng: u64, crit_rate: u64, crit_bonus: u64): (u64, bool) {
  spell::is_critical(rng, crit_rate, crit_bonus)
}

// ╔════════════════ [ §7 TURN-SEED SLOTS — the crit determinism contract ] ══════ ]
//
// Crits are a PER-TURN REVEALED SEQUENCE (DECISIONS 2026-07-11 "TURN-SEED CRITS"). At turn start a `turn_seed`
// is derived PURELY from public fight state (no stored field — upgrade-safe); each committed damaging action of
// the turn takes the next SLOT index, and slot `i` carries a fixed crit roll that binds to the INDEX ONLY (never
// the spell/target — kills cross-target fishing; slot-routing is the mechanic). The client mirrors this
// byte-for-byte to preview, before committing, which queued slots crit.
//
// DERIVATION (32-bit-wrapping mulberry32 — `prng::scramble`/`prng::mix`; byte-identical in @aresrpg/sim):
//   turn_seed   = mix(mix(mix(world_seed, spawn_id), turn_deadline_ms), seat)      [see fight::turn_seed]
//   slot_base   = mix(turn_seed, slot)                                              [slot = the action index]
//   crit_roll   = mix(slot_base, DOMAIN_CRIT) % 10000        ∈ [0, 10000)  (basis points)
//
// REVEAL: `turn_deadline_ms` is stamped + emitted in `TurnStarted` at each turn start; `world_seed`/`spawn_id`
// are static Fight fields the client already reads. No new event — the client derives from the same public
// state. `seat`-bound ⇒ each PvP seat gets its own sequence.
//
// APPLIES TO: a PLAYER's weapon strike + cast damage/heal lines. `crit` swaps to the crit base — nothing else
// varies it (the global ±15% damage band must not exist; damage is EXACTLY the authored
// base, always). Mob casts and board ticks carry no crit roll either (fully deterministic).
//
// DAMAGE STREAM — RESERVED, NOT LIVE: `apply_variance(base, factor)` below stays as the generic (base × factor /
// 10000, min-1-floored) application primitive for a LATER authored-range layer (a spells-package schema
// evolution — per-spell [min,max], not a global band). It takes an explicit factor with NO default baked in;
// nothing today computes a non-identity one, so every call path passes `base` straight through untouched.
// `DOMAIN_DMG = 0xD1B54A35` is the reserved decorrelation tag that future layer should reuse (same
// mix(slot_base, DOMAIN_DMG) pattern as DOMAIN_CRIT above) to keep its roll independent of the crit stream — not
// a live const until that layer lands.

const CRIT_SCALE: u64 = 10000; // crit-roll fixed-point scale (basis points); also apply_variance's identity divisor
const DOMAIN_CRIT: u64 = 0; // crit stream domain tag

/// The identity variance factor (×1) — pairs with `apply_variance` below. No current caller in the resolver
/// (every damage path uses `base` directly per the no-global-variance ruling); kept for the reserved authored-band
/// layer and exercised by this module's own tests.
public fun no_variance(): u64 { CRIT_SCALE }

/// Slot `i`'s CRIT ROLL — a spell/target-INDEPENDENT value in [0, 10000) derived purely from (turn_seed, slot).
public fun slot_crit_roll(turn_seed: u64, slot: u64): u64 {
  prng::mix(prng::mix(turn_seed, slot), DOMAIN_CRIT) % CRIT_SCALE
}

// ── AP/MP-REMOVAL DODGE: the esquive contest draws from the SAME public turn-seed
// stream as crit — a NEW domain tag, zero new RNG objects, so a client previews a drain's dodge before commit
// exactly like a crit. `dodge_seed` yields a per-CAST prng STATE (not a bounded roll): the resolver threads it
// through `remove_points`'s per-point loop, so one seed decorrelates every point of every drain in the cast, and
// the client mirrors it byte-for-byte. Mob-cast drains instead thread the crank's live `&Random` (mob actions are
// crank-entropy-driven, never previewable). The exact reference escape ratio is absent from the research corpus
// (only the effect-id enum 160-163) — so the contest reuses THIS module's already-cited Araknemu `remove_points`
// formula, re-keyed by the resolver so the DEFENDER term = agility (+ap/mp_dodge), remover = wisdom.
const DOMAIN_DODGE: u64 = 0xD0D6E; // dodge stream domain tag (≠ DOMAIN_CRIT = 0)
const DOMAIN_FAILURE: u64 = 0xFA117; // Wave 12 cast-failure stream; distinct from crit/dodge

/// The prng STATE a player cast's point-removal dodge threads from — `mix(mix(turn_seed, slot), DOMAIN_DODGE)`.
/// Deterministic + client-previewable (public turn-seed derivation, no stored field). Feed straight into
/// `remove_points` as its `rng`; the @aresrpg/sim mirror derives the identical state.
public fun dodge_seed(turn_seed: u64, slot: u64): u64 {
  prng::mix(prng::mix(turn_seed, slot), DOMAIN_DODGE)
}

/// A critical-failure status stores a 1-in-N denominator. Zero means no failure status.
/// The action-slot derivation is public and spell/target independent, matching the crit stream contract.
public fun critical_failure_roll(turn_seed: u64, slot: u64, denominator: u64): u64 {
  if (denominator == 0) 0 else prng::mix(prng::mix(turn_seed, slot), DOMAIN_FAILURE) % denominator
}

public fun critical_failure_at(turn_seed: u64, slot: u64, denominator: u64): bool {
  denominator > 0 && critical_failure_roll(turn_seed, slot, denominator) == 0
}

/// Does `crit_roll` crit at `crit_rate` (1-in-X; 0 = never; `crit_bonus` lowers X, floored at 2 = the 50% cap —
/// mirrors `spell::is_critical`)? The 1-in-X rate becomes a basis-point threshold: crit iff `roll < 10000/X`.
public fun crit_at(crit_roll: u64, crit_rate: u64, crit_bonus: u64): bool {
  if (crit_rate == 0) return false;
  let effective = if (crit_rate >= crit_bonus + 2) crit_rate - crit_bonus else 2;
  crit_roll < CRIT_SCALE / effective
}

/// Vary an authored `base` (the expected value) by a slot `factor`: `base × factor / 10000`, floored at 1 for
/// any nonzero base (variance never zeroes a real hit). A 0 base stays 0. `factor = 10000` is the identity.
public fun apply_variance(base: u64, factor: u64): u64 {
  if (base == 0) return 0;
  let v = base * factor / CRIT_SCALE;
  if (v < 1) 1 else v
}

// (E3 random_element was removed 2026-07-11 with spell_effect's FLAG_RANDOM_ELEMENT — dead vocabulary, zero
// shipped spells; its removal makes the cast resolver fully rng-free, which is what lets a turn ride ONE PTB.)

// ╔════════════════ [ TACKLE — the ordinary-movement escape contest ] ═════════════ ]
//
// Chain twin of the sim's shipped rule (packages/sim/src/fight_actions.js:63-100 — the in-repo authority: SPEC
// is silent on tackle and the research corpus carries only the dodge/lock stat-family enum —
// the same authority precedent as the esquive contest above). A fighter leaving a LIVING adjacent enemy's
// tackle zone rolls ONE combined contest: dodge = agility/10 + 2; per locker i, den_i = 2·(agility_i/10 + 2),
// num_i = min(den_i, dodge); escape iff roll ∈ [0, Π den_i) < Π num_i (equal agility ⇒ 1/2; dodge ≥ 2·lock ⇒
// certain). A FAILED escape denies the move and costs ceil(pool · failed/den) of BOTH pools.
//
// ROLL SOURCE — player moves are `&Random`-free (single-PTB turn law), so the roll derives from the SAME public
// turn-seed stream as crit/dodge with its own domain tag, folded with the action slot AND the runner's live MP:
// moves never advance the slot, but MP strictly decreases on every failed attempt (mp ≥ 1 to move ⇒ mp_lost ≥ 1),
// so each re-attempt reprices — no free identical re-roll. Mob moves draw the crank rng instead (wave entropy).

const DOMAIN_TACKLE: u64 = 0x7AC1E; // tackle stream domain tag (≠ CRIT 0 / DODGE 0xD0D6E / FAILURE 0xFA117)

/// The prng STATE a player move's tackle roll draws from — `mix(mix(mix(turn_seed, slot), mp), DOMAIN_TACKLE)`.
/// Deterministic + client-previewable exactly like `dodge_seed`; the @aresrpg/sim mirror derives the identical
/// state (turn_seed.js `tackle_seed`). `slot` = casts_this_turn, `mp` = the runner's MP before the contest.
public fun tackle_seed(turn_seed: u64, slot: u64, mp: u64): u64 {
  prng::mix(prng::mix(prng::mix(turn_seed, slot), mp), DOMAIN_TACKLE)
}

/// One agility → contest bucket: `agility/10 + 2` (fight_actions.js:66,69 — both sides share the curve).
public fun tackle_bucket(agility: u64): u64 { agility / 10 + 2 }

/// Combine every adjacent locker into ONE exact product fraction `(num, den)`: escape iff `roll < num` for a
/// roll in `[0, den)`. Empty lockers ⇒ (1, 1) — the caller skips the contest entirely (sim gates the same way).
public fun tackle_contest(runner_agility: u64, locker_agilities: &vector<u64>): (u64, u64) {
  let dodge = tackle_bucket(runner_agility);
  let n = locker_agilities.length();
  let mut num = 1;
  let mut den = 1;
  let mut i = 0;
  while (i < n) {
    let den_i = 2 * tackle_bucket(*locker_agilities.borrow(i));
    num = num * (if (dodge < den_i) dodge else den_i);
    den = den * den_i;
    i = i + 1;
  };
  (num, den)
}

/// A failed escape's pool costs: `ceil(pool · (den − num) / den)` each (fight_actions.js:79-81) — the failed
/// FRACTION of both pools, so a near-certain failure strips nearly everything and a near miss grazes.
public fun tackle_losses(ap: u64, mp: u64, num: u64, den: u64): (u64, u64) {
  let lost = den - num;
  ((ap * lost + den - 1) / den, (mp * lost + den - 1) / den)
}

// ╔════════════════ [ §B — pushback collision damage (level-scaled, fixed coef) ] ═ ]

/// Collision damage when a push (effect 5) is BLOCKED (wall / edge / fighter); `cells_blocked` = the cells the
/// target could NOT travel. Taxonomy §B canonical (level-scaled) form with the dice dropped for the fixed
/// model: `dmg = floor(coef × max(0.1, level/50)) × cells_blocked`, coef = 12, NEUTRAL. `max(0.1, level/50)`
/// is realised in integers as `max(12·level/50, 1)` (the 12×0.1 floor = 1). Unblocked push ⇒ 0.
/// ⚠️ Collision chain: damages the PUSHED TARGET ONLY (PHP/C# emulator variant), not the blocker — flagged.
public fun push_collision_damage(caster_level: u64, cells_blocked: u64): u64 {
  if (cells_blocked == 0) return 0;
  let per_cell = { let raw = 12 * caster_level / 50; if (raw < 1) 1 else raw };
  per_cell * cells_blocked
}

// ╔════════════════ [ §A — AP/MP removal dodge (per-point, seeded) ] ══════════════ ]

const DODGE_MIN: u64 = 10; // clamp floor (10%)
const DODGE_MAX: u64 = 90; // clamp ceiling (90%)
const POINT_RESISTANCE_FACTOR: u64 = 10; // wisdom / 10

/// Remove `value` AP or MP from a target, one point at a time (taxonomy §A, Araknemu variant). Each point:
///   `chance = clamp( 50·max(casterWis/10,1)/max(targetDodge,1) · (current−removed)/max , 10, 90 )`
/// roll(100) < chance ⇒ remove 1, else the removal is dodged and STOPS. Fewer remaining points ⇒ harder to
/// steal the next (the `(current−removed)/max` term). Returns `(new_rng, removed)`. Seeded prng so every
/// client agrees. `dodge=false` (guaranteed class, effects 168/169) skips the roll: removes `min(current,
/// value)` with NO draw.
public fun remove_points(
  rng: u64,
  value: u64,
  dodge: bool,
  caster_wisdom: u64,
  target_dodge: u64,
  current: u64,
  max: u64,
): (u64, u64) {
  let (state, removed, _rolls) = remove_points_with_rolls(
    rng, value, dodge, caster_wisdom, target_dodge, current, max,
  );
  (state, removed)
}

/// Receipt-provenance twin of `remove_points`: same contest and return values, plus every committed raw roll in
/// order. Guaranteed removal and a zero pool draw nothing. Existing callers retain the frozen two-value API.
public fun remove_points_with_rolls(
  rng: u64,
  value: u64,
  dodge: bool,
  caster_wisdom: u64,
  target_dodge: u64,
  current: u64,
  max: u64,
): (u64, u64, vector<u64>) {
  // Guaranteed removal — no RNG.
  if (!dodge) return (rng, if (value < current) value else current, vector[]);
  if (max == 0) return (rng, 0, vector[]);

  let wisdom = { let w = caster_wisdom / POINT_RESISTANCE_FACTOR; if (w < 1) 1 else w };
  let resistance = if (target_dodge < 1) 1 else target_dodge;
  let resist_rate = 50 * wisdom / resistance;

  let mut state = rng;
  let mut removed = 0;
  let mut rolls = vector[];
  while (removed < value && removed < current) {
    let raw = resist_rate * (current - removed) / max;
    let chance = if (raw < DODGE_MIN) DODGE_MIN else if (raw > DODGE_MAX) DODGE_MAX else raw;
    let (next, roll) = prng::rng_int(state, 100);
    state = next;
    rolls.push_back(roll);
    if (roll < chance) { removed = removed + 1 } else { break }; // dodged -> stop
  };
  (state, removed, rolls)
}

// ===========================================================================
// Tests — reference values hand-derived from the §5h/§A/§B formulas.
// ===========================================================================

#[test_only]
fun stats(str: u64, int: u64, chance: u64, agi: u64, raw: u64): Stats {
  spell::new_stats(str, int, chance, agi, raw, 0, 0, 0, 0, 0, 0)
}
#[test_only]
fun target_res(fire: u64, water: u64, earth: u64, air: u64): Stats {
  spell::new_stats(0, 0, 0, 0, 0, 0, 0, fire, water, earth, air)
}

#[test]
fun t_amplify_earth_matches_doc_example() {
  // §5h worked example: 20-base earth, 200 Strength -> 60 (the doc's 66 includes +30 %dmg we don't field).
  let c = stats(200, 0, 0, 0, 0);
  assert!(amplify_damage(20, spell::el_earth(), &c) == 60, 0);
}

#[test]
fun t_amplify_neutral_scales_with_strength() {
  // §5h: Neutral scales with Strength (unlike spell::element_stat_value which is 0 for NONE).
  let c = stats(200, 0, 0, 0, 0);
  assert!(amplify_damage(20, spell::el_none(), &c) == 60, 0);
}

#[test]
fun t_amplify_fire_with_fixed_damage() {
  // base 15, int 55, raw(fixedDamage) 3 -> 15*(155)/100 + 3 = 23 + 3 = 26.
  let c = stats(0, 55, 0, 0, 3);
  assert!(amplify_damage(15, spell::el_fire(), &c) == 26, 0);
}

#[test]
fun t_final_damage_resisted() {
  // 60 earth vs 30% earth resist -> 42.
  let c = stats(200, 0, 0, 0, 0);
  let t = target_res(0, 0, 30, 0);
  assert!(final_damage(20, spell::el_earth(), &c, &t) == 42, 0);
  // fire 26 vs 30% fire resist -> 18.
  let c2 = stats(0, 55, 0, 0, 3);
  let t2 = target_res(30, 0, 0, 0);
  assert!(final_damage(15, spell::el_fire(), &c2, &t2) == 18, 0);
}

#[test]
fun t_heal_scales_intelligence() {
  // base 30, int 55 -> 30*(155)/100 = 46.
  let c = stats(0, 55, 0, 0, 0);
  assert!(heal_amount(30, &c) == 46, 0);
}

#[test]
fun t_push_collision_level_scaled() {
  assert!(push_collision_damage(50, 2) == 24, 0); // 12*50/50=12, x2
  assert!(push_collision_damage(100, 3) == 72, 0); // 24 x3
  assert!(push_collision_damage(1, 1) == 1, 0); // floor of 12*0.1 -> 1
  assert!(push_collision_damage(50, 0) == 0, 0); // unblocked -> 0
}

#[test]
fun t_remove_points_guaranteed() {
  // dodge=false -> min(current, value), no rng movement.
  let (rng, removed) = remove_points(prng::rng_seed(0), 3, false, 0, 0, 2, 6);
  assert!(removed == 2, 0); // capped at current
  assert!(rng == prng::rng_seed(0), 0); // rng untouched
  let (_r, removed2) = remove_points(prng::rng_seed(0), 2, false, 0, 0, 6, 6);
  assert!(removed2 == 2, 0);
}

#[test]
fun t_remove_points_dodged_at_floor() {
  // resist_rate = 50*max(0/10,1)/max(100,1) = 50*1/100 = 0 -> chance clamps to 10.
  // first rng_int(seed0,100) = 38 >= 10 -> dodged immediately -> removed 0.
  let (_rng, removed) = remove_points(prng::rng_seed(0), 3, true, 0, 100, 6, 6);
  assert!(removed == 0, 0);
}

#[test]
fun t_remove_points_hits_at_ceiling() {
  // resist_rate huge -> chance clamps to 90; first roll 38 < 90 -> remove 1 (value=1).
  let (_rng, removed) = remove_points(prng::rng_seed(0), 1, true, 1000, 1, 6, 6);
  assert!(removed == 1, 0);
}

#[test]
fun t_remove_points_exposes_committed_rolls() {
  let seed = prng::rng_seed(0);
  let (next, removed, rolls) = remove_points_with_rolls(seed, 3, true, 0, 100, 6, 6);
  let (expected_next, expected_roll) = prng::rng_int(seed, 100);
  assert!(removed == 0 && rolls == vector[expected_roll], 0);
  assert!(next == expected_next, 1);
  let (same, guaranteed, no_rolls) = remove_points_with_rolls(seed, 2, false, 0, 0, 6, 6);
  assert!(same == seed && guaranteed == 2 && no_rolls.is_empty(), 2);
}

#[test]
fun t_roll_crit_deterministic() {
  // Mirrors spell::is_critical(seed 7, 5, 0) == false with the same advanced state.
  let (rng, crit) = roll_crit(prng::rng_seed(7), 5, 0);
  assert!(crit == false, 0);
  assert!(rng == 1831565820, 0);
}

#[test]
fun t_amplify_reads_percent_and_physical_damage() {
  // #55 GAP CLOSED: percent_damage adds to the (100+primary+percent)/100 term; physical_damage adds on earth/neutral.
  let mut c = stats(200, 0, 0, 0, 0); // strength 200
  spell::add_stat(&mut c, 8, 30); // STAT_PERCENT_DAMAGE = +30%
  spell::add_stat(&mut c, 9, 5); // STAT_RAW_DAMAGE = +5 fixed
  // earth: 20*(100+200+30)/100 + 5(raw) + 0(physical) = 66 + 5 = 71.
  assert!(amplify_damage(20, spell::el_earth(), &c) == 71, 0);
  // add physical_damage 10 → only counts on earth/neutral.
  spell::set_physical_damage_for_testing(&mut c, 10);
  assert!(amplify_damage(20, spell::el_earth(), &c) == 81, 0); // 66+5+10
  assert!(amplify_damage(20, spell::el_fire(), &c) == 5 + 20 * 130 / 100, 0); // fire: no physical, no strength-primary
}

#[test]
fun t_final_damage_neutral_resist_applied() {
  // #55 GAP CLOSED: NONE element now reads neutral_resistance (was unresisted).
  let c = stats(200, 0, 0, 0, 0);
  let mut t = target_res(0, 0, 0, 0);
  spell::add_resist(&mut t, spell::el_none(), 25); // 25% neutral resist
  // neutral amplify = 20*(100+200)/100 = 60; 60 * (100-25)/100 = 45.
  assert!(final_damage(20, spell::el_none(), &c, &t) == 45, 0);
}

// ── turn-seed slot crit + damage variance ──

#[test]
fun t_crit_at_bp_threshold() {
  // 1-in-X → 10000/X threshold; crit iff roll < threshold. rate 0 never crits.
  assert!(crit_at(4999, 2, 0), 0); // 1-in-2 → threshold 5000
  assert!(!crit_at(5000, 2, 0), 1);
  assert!(crit_at(499, 20, 0), 2); // 1-in-20 (5%) → threshold 500
  assert!(!crit_at(500, 20, 0), 3);
  assert!(!crit_at(0, 0, 0), 4); // never
  // 50% cap: crit_bonus can't drive effective below 2 (threshold stays 5000, not 10000).
  assert!(crit_at(4999, 3, 100), 5);
  assert!(!crit_at(5000, 3, 100), 6);
}

#[test]
fun t_apply_variance_band_and_min_floor() {
  assert!(apply_variance(100, 8500) == 85, 0); // −15%
  assert!(apply_variance(100, 11499) == 114, 1); // +~15%
  assert!(apply_variance(100, no_variance()) == 100, 2); // identity
  assert!(apply_variance(0, 8500) == 0, 3); // zero base stays zero
  assert!(apply_variance(1, 8500) == 1, 4); // min-1 floor on a nonzero base (1*0.85 → 0 → 1)
}

#[test]
fun t_slot_crit_roll_deterministic_and_index_bound() {
  let ts = 123456789;
  // deterministic: same (seed, slot) → same roll.
  assert!(slot_crit_roll(ts, 0) == slot_crit_roll(ts, 0), 0);
  // index-bound: different slots → different rolls (reordering actions swaps which slot crits).
  assert!(slot_crit_roll(ts, 0) != slot_crit_roll(ts, 1), 1);
}

// ── tackle contest — golden twins of packages/sim/test/vectors/tackle_golden.json (ids match; every number
//    was generated by the sim's own prng/contest mirror, so a drift on EITHER side breaks its suite) ──

#[test]
fun t_tackle_contest_fractions_match_golden() {
  // equal_zero_agility_is_even: dodge 2 vs den 4 → 2/4 (the even contest).
  let (n0, d0) = tackle_contest(0, &vector[0]);
  assert!(n0 == 2 && d0 == 4, 0);
  // hundred_vs_hundred_is_even: 12/24 — equal agility is ALWAYS a coin flip, any scale.
  let (n1, d1) = tackle_contest(100, &vector[100]);
  assert!(n1 == 12 && d1 == 24, 1);
  // runner_caps_at_certain_escape: dodge 22 ≥ den 14 → min() caps at 14/14 (certain).
  let (n2, d2) = tackle_contest(200, &vector[50]);
  assert!(n2 == 14 && d2 == 14, 2);
  // two_lockers_multiply: dodge 8 vs dens 10·22 → (8·8)/(10·22) = 64/220.
  let (n3, d3) = tackle_contest(60, &vector[30, 90]);
  assert!(n3 == 64 && d3 == 220, 3);
  // four_zero_lockers_pin_runner: 2⁴/4⁴ = 16/256 (6.25% — the full surround).
  let (n4, d4) = tackle_contest(0, &vector[0, 0, 0, 0]);
  assert!(n4 == 16 && d4 == 256, 4);
  // buffed_runner_vs_weak_locker: dodge 6 ≥ den 6 → certain escape at exactly double the lock.
  let (n5, d5) = tackle_contest(45, &vector[10]);
  assert!(n5 == 6 && d5 == 6, 5);
}

#[test]
fun t_tackle_losses_ceil_match_golden() {
  // half_fail_scaffold_pools: 6/3 pools at 2/4 → ceil(3), ceil(1.5)=2.
  let (a0, m0) = tackle_losses(6, 3, 2, 4);
  assert!(a0 == 3 && m0 == 2, 0);
  // exact_half_rounds_up: same fraction at 12/24 — scale-invariant.
  let (a1, m1) = tackle_losses(6, 3, 12, 24);
  assert!(a1 == 3 && m1 == 2, 1);
  // zero_ap_runner: a zero pool loses zero (no ceil phantom).
  let (a2, m2) = tackle_losses(0, 3, 2, 4);
  assert!(a2 == 0 && m2 == 2, 2);
  // one_mp_always_fully_lost_on_fail: ANY failure eats ≥1 MP — the repricing guarantee.
  let (a3, m3) = tackle_losses(6, 1, 15, 16);
  assert!(a3 == 1 && m3 == 1, 3);
  // guaranteed_escape_loses_nothing: num == den ⇒ zero losses (never called, but exact).
  let (a4, m4) = tackle_losses(6, 3, 14, 14);
  assert!(a4 == 0 && m4 == 0, 4);
  // tiny_fraction_still_bites: 1/64 failure share still ceils to 1 of each.
  let (a5, m5) = tackle_losses(10, 5, 63, 64);
  assert!(a5 == 1 && m5 == 1, 5);
}

#[test]
fun t_tackle_seed_derivation_matches_golden() {
  // reference_seed_slot0_mp3 (sim-generated): state + first raw draw are pinned byte-for-byte.
  let st = tackle_seed(123456789, 0, 3);
  assert!(st == 1503868628, 0);
  let (_next, draw) = prng::rng_next(st);
  assert!(draw == 1533844234, 1);
  // slot_changes_the_state / mp_changes_the_state: each discriminator re-prices the roll.
  assert!(tackle_seed(123456789, 1, 3) == 2924001637, 2);
  assert!(tackle_seed(123456789, 0, 2) == 38233962, 3);
  // deterministic: same inputs → same state.
  assert!(tackle_seed(123456789, 0, 3) == st, 4);
}

#[test]
fun t_tackle_escape_rate_over_10k() {
  // Sweep 10k decorrelated seeds on the even contest (num 2 / den 4): escape frequency ≈ 1/2 — proves the
  // roll-vs-fraction wiring, mirroring t_distribution_crit_rate_over_10k's band style.
  let mut escapes = 0;
  let mut i = 0;
  while (i < 10000) {
    let (_s, draw) = prng::rng_next(prng::scramble(i));
    if (draw % 4 < 2) escapes = escapes + 1;
    i = i + 1;
  };
  assert!(escapes >= 4700 && escapes <= 5300, escapes);
}

#[test]
fun t_distribution_crit_rate_over_10k() {
  // Sweep 10k turn seeds at slot 0: crit frequency ≈ 1/20 (5%).
  let mut crits = 0;
  let mut i = 0;
  while (i < 10000) {
    let ts = prng::scramble(i); // decorrelated seeds
    if (crit_at(slot_crit_roll(ts, 0), 20, 0)) crits = crits + 1;
    i = i + 1;
  };
  // 5% of 10k = 500; allow a generous band (chi noise) — proves the rate, not a tight CI.
  assert!(crits >= 380 && crits <= 620, crits);
}
