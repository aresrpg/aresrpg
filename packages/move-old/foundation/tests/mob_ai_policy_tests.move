// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// POLICY proofs for the §17.21 ATTACK-DOMINANT draw (stochastic + rush behavior).
/// The bug these pin: a mob adjacent to a player could draw `reposition` and WANDER instead of hitting
/// ("came → walked back → came, then didn't attack me"), and the multi-target weighted reposition flip-flopped
/// between targets across turns. The fix: when ANY attack is viable, reposition/idle leave the draw pool (heal
/// stays); with NO attack viable, a SINGLE deterministic advance toward the NEAREST reachable target.
/// Proven here:
///   (a) adjacent-with-castable-attack NEVER repositions and strikes from STANDING (zero MP), across a 64-seed
///       sweep — and when it must approach, it moves EXACTLY to the cast cell (no MP that doesn't serve).
///   (b) an out-of-reach target still advances, and the fallback is monotonic (never ends farther from target).
///   (c) a healer with a wounded ally: heal competes with attack (both drawn), reposition never (behavior pinned).
///   (d) determinism: same state + seed ⇒ same action, on the attack-dominant pool.
#[test_only]
module aresrpg_foundation::mob_ai_policy_tests;

use aresrpg_foundation::{combat_grid, mob_ai, prng, spell_effect::{Self, SpellLevel}, spell};

// Test seeds are run through `prng::scramble` to mirror PRODUCTION entropy: on-chain the rng carrier is seeded
// from a 32-byte `&Random` draw (high-entropy), NOT a small integer. `prng::draw`'s FIRST output is linear in the
// seed (`seed + 0x6d2b79f5` — the scrambler avalanches only on the SECOND draw), so feeding raw sequential seeds
// clusters every draw into one mod-`total` half and a weighted choice looks degenerate. scramble(seed) restores
// the high-entropy input the live path always has, while staying deterministic (same seed ⇒ same action).

// live AI_W_* weights (from aresrpg::mob) — attack_now 120, attack_move 80, heal 120, reposition 40.
#[test_only]
fun w(): mob_ai::AiWeights { mob_ai::new_weights(120, 80, 120, 40) }

// ranged fire: AP 4, range 1..6, LOS req (empty los ⇒ clear). melee fire: range 1..1 (rush-and-strike class).
#[test_only]
fun fire(): SpellLevel {
  spell_effect::new_spell_level(1, 4, 1, 6, false, false, true, false, 255, 255, 0, 0, false, vector[], vector[], vector[spell_effect::damage(spell::el_fire(), 15)], vector[])
}
#[test_only]
fun fire_melee(): SpellLevel {
  spell_effect::new_spell_level(1, 4, 1, 1, false, false, true, false, 255, 255, 0, 0, false, vector[], vector[], vector[spell_effect::damage(spell::el_fire(), 15)], vector[])
}
// #606 ranged fire with a MIN-range of 3 (band [3,5]) — the dead-zone class: a target closer than 3 forces a STEP-OUT.
#[test_only]
fun fire_minrange(): SpellLevel {
  spell_effect::new_spell_level(1, 4, 3, 5, false, false, true, false, 255, 255, 0, 0, false, vector[], vector[], vector[spell_effect::damage(spell::el_fire(), 15)], vector[])
}
// heal: AP 4, range 1..6, LOS req — a support kit (effects_contain_heal ⇒ treated as heal, never as an attack).
#[test_only]
fun heal_spell(): SpellLevel {
  spell_effect::new_spell_level(1, 4, 1, 6, false, false, true, false, 255, 255, 0, 0, false, vector[], vector[], vector[spell_effect::heal(20)], vector[])
}

const EMPTY: vector<u64> = vector[];

// ── (a1) ADJACENT + CASTABLE ⇒ NEVER reposition, STRIKE FROM STANDING (zero MP) — 64-seed sweep ───────────────
// Mob boxed by two adjacent players (both melee-castable in place). Every seed must draw an attack IN PLACE
// (a cast, new_cell == mob cell — zero wasted MP), never a bare reposition. Both targets must occur (live draw).
#[test]
fun adjacent_never_repositions_strikes_from_standing() {
  let mob = combat_grid::encode(5, 5);
  let a = combat_grid::encode(6, 5); // d1
  let b = combat_grid::encode(5, 6); // d1
  let spells = vector[fire_melee()];
  let targets = vector[a, b];
  let mut saw_a = false;
  let mut saw_b = false;
  let ww = w();
  let mut seed = 1;
  while (seed < 65) {
    let mut rng = prng::scramble(seed);
    let (c, sp, tgt) = mob_ai::decide_turn(mob, 6, 6, &spells, &targets, &EMPTY, &EMPTY, &EMPTY, &EMPTY, 0, &ww, &mut rng);
    assert!(sp.is_some(), seed);          // ALWAYS a cast — never a reposition/idle
    assert!(c == mob, 100 + seed);        // strikes from standing — zero movement
    assert!(tgt == a || tgt == b, 200 + seed);
    if (tgt == a) saw_a = true;
    if (tgt == b) saw_b = true;
    seed = seed + 1;
  };
  assert!(saw_a && saw_b, 999); // the draw is genuinely live (not a degenerate single row)
}

// ── (a2) APPROACH-TO-CAST moves EXACTLY to the cast cell (no full-MP wander) — 64-seed sweep ──────────────────
// Melee mob 3 cells from a lone target: the only viable action is attack_move to the CLOSEST band cell (4,5)
// (cost 2), NOT a walk to the MP horizon. Every seed: cast, new_cell == (4,5). Proves the MP-discipline law.
#[test]
fun approach_moves_exactly_to_cast_cell() {
  let mob = combat_grid::encode(2, 5);
  let target = combat_grid::encode(5, 5); // d3, melee ⇒ must step to an adjacent cell
  let cast_cell = combat_grid::encode(4, 5); // closest cell at distance 1, reachable in 2 steps
  let spells = vector[fire_melee()];
  let targets = vector[target];
  let ww = w();
  let mut seed = 1;
  while (seed < 65) {
    let mut rng = prng::scramble(seed);
    let (c, sp, tgt) = mob_ai::decide_turn(mob, 6, 6, &spells, &targets, &EMPTY, &EMPTY, &EMPTY, &EMPTY, 0, &ww, &mut rng);
    assert!(sp.is_some(), seed);       // casts after the minimal approach
    assert!(c == cast_cell, 100 + seed); // EXACTLY the cast cell — not the full-MP horizon
    assert!(tgt == target, 200 + seed);
    seed = seed + 1;
  };
}

// ── (b) OUT OF REACH ⇒ still advances, MONOTONIC (never ends farther) + deterministic — 64-seed sweep ─────────
// Target far beyond rmax+mp: no attack viable ⇒ the sanctioned fallback advances toward it. Every seed: no cast,
// it moves, and manhattan(new_cell,target) <= manhattan(mob,target) (net-distance non-increasing). Same nc each
// seed (single reposition row — no weighted flip-flop).
#[test]
fun out_of_reach_advances_monotonically() {
  let mob = combat_grid::encode(2, 5);
  let target = combat_grid::encode(18, 15); // d = 16 + 10 = 26, far past rmax(1)+mp(6)
  let spells = vector[fire_melee()];
  let targets = vector[target];
  let start_d = combat_grid::manhattan(mob, target);
  let mut first_nc = option::none<u64>();
  let ww = w();
  let mut seed = 1;
  while (seed < 65) {
    let mut rng = prng::scramble(seed);
    let (c, sp, tgt) = mob_ai::decide_turn(mob, 6, 6, &spells, &targets, &EMPTY, &EMPTY, &EMPTY, &EMPTY, 0, &ww, &mut rng);
    assert!(sp.is_none(), seed);        // nothing to cast
    assert!(c != mob, 100 + seed);      // it ADVANCES (never stalls when progress is possible)
    assert!(combat_grid::manhattan(c, target) <= start_d, 200 + seed); // monotonic: never farther
    assert!(combat_grid::manhattan(c, target) < start_d, 300 + seed);  // open board ⇒ strictly closer
    assert!(tgt == target, 400 + seed);
    if (first_nc.is_none()) first_nc = option::some(c) else assert!(c == *first_nc.borrow(), 500 + seed); // deterministic
    seed = seed + 1;
  };
}

// ── (c) HEALER + WOUNDED ALLY: heal competes with attack, reposition NEVER (behavior pinned) — 64-seed sweep ──
// Mob with fire + heal, a wounded ally in heal range AND an enemy in attack range: attack is viable ⇒ pool is
// {attack_now on enemy (120), heal on ally (120)}, reposition EXCLUDED. Every seed casts (target = ally ⇒ heal,
// target = enemy ⇒ attack); both must occur (heal at parity with attack, the sanctioned support lean).
#[test]
fun healer_heals_or_attacks_never_repositions() {
  let mob = combat_grid::encode(5, 5);
  let ally = combat_grid::encode(5, 3);  // d2, wounded
  let enemy = combat_grid::encode(5, 7); // d2, in fire range
  let spells = vector[fire(), heal_spell()];
  let targets = vector[enemy];
  let ally_cells = vector[ally];
  let ally_missing = vector[10]; // wounded ⇒ heal is not nonsense
  let mut saw_heal = false;
  let mut saw_attack = false;
  let ww = w();
  let mut seed = 1;
  while (seed < 65) {
    let mut rng = prng::scramble(seed);
    let (_c, sp, tgt) = mob_ai::decide_turn(mob, 6, 6, &spells, &targets, &ally_cells, &ally_missing, &EMPTY, &EMPTY, 0, &ww, &mut rng);
    assert!(sp.is_some(), seed);                    // heal or attack — NEVER a reposition/idle
    assert!(tgt == ally || tgt == enemy, 100 + seed);
    if (tgt == ally) saw_heal = true;
    if (tgt == enemy) saw_attack = true;
    seed = seed + 1;
  };
  assert!(saw_heal && saw_attack, 999); // heal (120) competes at parity with attack_now (120): both are drawn
}

// A FULL-HP ally is NOT healed (nonsense filtered): with no wounded ally and an in-range enemy, every seed attacks.
#[test]
fun healer_ignores_full_hp_ally() {
  let mob = combat_grid::encode(5, 5);
  let ally = combat_grid::encode(5, 3);
  let enemy = combat_grid::encode(5, 7);
  let spells = vector[fire(), heal_spell()];
  let targets = vector[enemy];
  let ally_cells = vector[ally];
  let ally_missing = vector[0]; // full HP ⇒ heal is nonsense
  let ww = w();
  let mut seed = 1;
  while (seed < 65) {
    let mut rng = prng::scramble(seed);
    let (_c, sp, tgt) = mob_ai::decide_turn(mob, 6, 6, &spells, &targets, &ally_cells, &ally_missing, &EMPTY, &EMPTY, 0, &ww, &mut rng);
    assert!(sp.is_some() && tgt == enemy, seed); // only the enemy is ever targeted
    seed = seed + 1;
  };
}

// ── (d) DETERMINISM on the attack-dominant pool: same state + seed ⇒ identical action ─────────────────────────
#[test]
fun attack_dominant_is_replay_exact() {
  let mob = combat_grid::encode(5, 5);
  let spells = vector[fire()]; // range 1..6 ⇒ both targets castable in place
  let targets = vector[combat_grid::encode(5, 8), combat_grid::encode(8, 5)]; // d3, d3 — a live 2-row pool
  let ww = w();
  let mut seed = 1;
  while (seed < 65) {
    let mut r1 = prng::scramble(seed);
    let mut r2 = prng::scramble(seed);
    let (c1, s1, t1) = mob_ai::decide_turn(mob, 6, 6, &spells, &targets, &EMPTY, &EMPTY, &EMPTY, &EMPTY, 0, &ww, &mut r1);
    let (c2, s2, t2) = mob_ai::decide_turn(mob, 6, 6, &spells, &targets, &EMPTY, &EMPTY, &EMPTY, &EMPTY, 0, &ww, &mut r2);
    assert!(c1 == c2 && t1 == t2 && s1.is_some() == s2.is_some() && s1 == s2, seed);
    seed = seed + 1;
  };
}

// ── (e) RANGE stat extends the band; a range-SHRED row shrinks the mob's reachable set ──────
// A modifiable-range spell (rmax 2) against a target at d4, zero move budget: a live +2 range EXTENDS the band so
// the mob strikes from standing; SHRED it to 0 and the identical target is UNREACHABLE (no cast, idle in place).
#[test]
fun range_stat_extends_band_and_shred_shrinks_it() {
  let mob = combat_grid::encode(5, 5);
  let target = combat_grid::encode(5, 9); // d4 — beyond the base rmax of 2
  // modifiable_range = true (5th flag), LOS off, ap 4, rmax 2.
  let spells = vector[spell_effect::new_spell_level(1, 4, 1, 2, true, false, false, false, 255, 255, 0, 0, false, vector[], vector[], vector[spell_effect::damage(spell::el_fire(), 15)], vector[])];
  let targets = vector[target];
  let ww = w();
  // +2 range (a live range stat) reaches d4 → castable IN PLACE (mp 0 ⇒ it cannot have approached).
  let mut r1 = prng::scramble(1);
  let (c, sp, tgt) = mob_ai::decide_turn(mob, 6, 0, &spells, &targets, &EMPTY, &EMPTY, &EMPTY, &EMPTY, 2, &ww, &mut r1);
  assert!(sp.is_some() && c == mob && tgt == target, 0);
  // SHRED the range stat to 0 (range_bonus 0), same zero move budget → the target falls OUT of the band.
  let mut r2 = prng::scramble(1);
  let (c2, sp2, _t2) = mob_ai::decide_turn(mob, 6, 0, &spells, &targets, &EMPTY, &EMPTY, &EMPTY, &EMPTY, 0, &ww, &mut r2);
  assert!(sp2.is_none() && c2 == mob, 1); // no cast, idle in place — the reachable set shrank
}

// ── (f) #606 — target INSIDE a ranged spell's min-range ⇒ STEP OUT to the band and FIRE (never point-blank) ────
// A [3,5] mob with the player at d2 (inside the min-range of 3): castable-in-place is impossible, so the ONLY
// viable action is attack_move to the CLOSEST band cell (`cast_cell_for`/`bfs_cast_cell`) — the mob STEPS to a cell
// at manhattan ∈ [3,5] and casts, never walking deeper into the point-blank dead zone. This is the on-chain twin of
// the sim's #606 fix (packages/sim/test/mob_ai_close_attack.test.js) — the two produce the identical firing cell, so
// the close-and-attack path can never drift. Deterministic across a 64-seed sweep (single spell + single target ⇒
// exactly one cast row → the weighted draw is a no-op).
#[test]
fun ranged_target_inside_min_range_steps_out_and_fires() {
  let mob = combat_grid::encode(5, 5);
  let target = combat_grid::encode(5, 7); // d2 — inside the [3,5] band's min-range
  let spells = vector[fire_minrange()];
  let targets = vector[target];
  let ww = w();
  let mut seed = 1;
  while (seed < 65) {
    let mut rng = prng::scramble(seed);
    let (c, sp, tgt) = mob_ai::decide_turn(mob, 6, 6, &spells, &targets, &EMPTY, &EMPTY, &EMPTY, &EMPTY, 0, &ww, &mut rng);
    assert!(sp.is_some(), seed);           // it FIRES — never idles or repositions without casting
    assert!(c != mob, 100 + seed);         // it STEPPED to a firing cell (out of the point-blank dead zone)
    let d = combat_grid::manhattan(c, target);
    assert!(d >= 3 && d <= 5, 200 + seed); // the firing cell is INSIDE the band, not point-blank
    assert!(tgt == target, 300 + seed);
    seed = seed + 1;
  };
}
