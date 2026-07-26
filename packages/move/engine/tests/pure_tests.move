// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// PURE tests — the judgment-dense algorithms that need NO on-chain scaffold: the §17.28 global-interleave
/// order (determinism + even distribution across uneven teams), the deterministic board derivation, the
/// harvested claim kernels (/700 loot, /600 xp), and the reference-corpus hp scaling.
#[test_only]
module aresrpg_fight::pure_tests;

use aresrpg_fight::{settlement, mob, participant, interleave::{Self, Actor}};
use aresrpg_foundation::board;
use aresrpg_foundation::{spell, spell_effect, combat_grid};
use std::unit_test::assert_eq;

// ── helpers ──
fun players(n: u64): vector<Actor> {
  let mut v = vector[];
  let mut i = 0;
  while (i < n) { v.push_back(interleave::new_player_actor(i)); i = i + 1; };
  v
}
fun mobs(n: u64): vector<Actor> {
  let mut v = vector[];
  let mut i = 0;
  while (i < n) { v.push_back(interleave::new_mob_actor(i)); i = i + 1; };
  v
}
/// The is-mob pattern of a queue (true = mob slot).
fun pattern(q: &vector<Actor>): vector<bool> {
  let mut p = vector[];
  let mut i = 0;
  while (i < q.length()) { p.push_back(interleave::actor_is_mob(q.borrow(i))); i = i + 1; };
  p
}

// ╔════════════════ [ §17.28 global interleave ] ════════════════════════════ ]

#[test]
/// Equal teams (3v3) → strict A,B,A,B,A,B (players first on ties).
fun interleave_3v3_strict_alternation() {
  let q = interleave::order(players(3), mobs(3));
  assert_eq!(q.length(), 6);
  assert_eq!(pattern(&q), vector[false, true, false, true, false, true]);
}

#[test]
/// Undermanned 1v3 → the lone player is CENTERED (B,A,B,B), never front-loaded, never solo-wrapping.
fun interleave_1v3_minority_centered() {
  let q = interleave::order(players(1), mobs(3));
  assert_eq!(q.length(), 4);
  assert_eq!(pattern(&q), vector[true, false, true, true]);
}

#[test]
/// 2v6 → the two players are spread every 4th slot (B,A,B,B,B,A,B,B): no two player turns in a row, mobs never
/// stall the minority into a hopeless round.
fun interleave_2v6_evenly_spread() {
  let q = interleave::order(players(2), mobs(6));
  assert_eq!(q.length(), 8);
  assert_eq!(pattern(&q), vector[true, false, true, true, true, false, true, true]);
  // the two player slots carry seats 0 then 1, in join order.
  assert_eq!(interleave::actor_idx(q.borrow(1)), 0);
  assert_eq!(interleave::actor_idx(q.borrow(5)), 1);
}

#[test]
/// Determinism: same inputs → byte-identical queue, always (pure function, replayable forever).
fun interleave_is_deterministic() {
  let a = interleave::order(players(2), mobs(6));
  let b = interleave::order(players(2), mobs(6));
  assert_eq!(pattern(&a), pattern(&b));
}

#[test]
/// A one-sided queue drains in order (all players, no mobs).
fun interleave_one_sided() {
  let q = interleave::order(players(4), mobs(0));
  assert_eq!(pattern(&q), vector[false, false, false, false]);
}

// ╔════════════════ [ Board derivation ] ════════════════════════════════════ ]

#[test]
fun board_is_deterministic_and_well_formed() {
  let g1 = board::generate_for_anchor(12345, 100, 200);
  let g2 = board::generate_for_anchor(12345, 100, 200);
  // determinism: identical dims + start cells.
  assert_eq!(board::grid_width(&g1), board::grid_width(&g2));
  assert_eq!(board::grid_height(&g1), board::grid_height(&g2));
  assert_eq!(board::start_cells_a(&g1), board::start_cells_a(&g2));
  assert_eq!(board::start_cells_b(&g1), board::start_cells_b(&g2));
  // dims in the vocab bounds.
  assert!(board::grid_width(&g1) >= 7 && board::grid_width(&g1) <= 17);
  assert!(board::grid_height(&g1) >= 7 && board::grid_height(&g1) <= 19);
  // 6 start cells per side, disjoint.
  let a = board::start_cells_a(&g1);
  let b = board::start_cells_b(&g1);
  assert_eq!(a.length(), 6);
  assert_eq!(b.length(), 6);
  let mut i = 0;
  while (i < a.length()) { assert!(!b.contains(a.borrow(i))); i = i + 1; };
}

#[test]
/// A different anchor yields a different board seed (→ generally a different layout) — the board IS the world.
fun board_varies_with_anchor() {
  let s1 = board::board_seed_from_anchor(12345, 100, 200);
  let s2 = board::board_seed_from_anchor(12345, 101, 200);
  assert!(s1 != s2);
}

// ╔════════════════ [ Claim kernels (harvested /700 & /600) ] ═══════════════ ]

#[test]
fun xp_share_kernel() {
  // solo, no wisdom, no aging, ×1 → the whole pot.
  assert_eq!(settlement::xp_share_kernel(600, 1, 0, 0, 100), 600);
  // 2-party flat split, but +600 wisdom doubles the share → back to 600.
  assert_eq!(settlement::xp_share_kernel(600, 2, 600, 0, 100), 600);
  // solo, +100% aging (10_000 bp) → doubled.
  assert_eq!(settlement::xp_share_kernel(600, 1, 0, 10000, 100), 1200);
  // solo, ×2 xp multiplier → doubled.
  assert_eq!(settlement::xp_share_kernel(600, 1, 0, 0, 200), 1200);
}

// ╔════════════════ [ Reference-corpus hp scaling ] ═══════════════════════════════════ ]

#[test]
fun mob_hp_scaling() {
  // base 100, level band [10,20]: 0.7×base at min → base×(0.7+0.7·frac) up to 1.4×base at max.
  assert_eq!(mob::scaled_hp_for_testing(100, 10, 20, 10), 70);
  assert_eq!(mob::scaled_hp_for_testing(100, 10, 20, 15), 105);
  assert_eq!(mob::scaled_hp_for_testing(100, 10, 20, 20), 140);
  // degenerate band (min==max) → base verbatim.
  assert_eq!(mob::scaled_hp_for_testing(100, 5, 5, 5), 100);
}

// ╔════════════════ [ SEEDED mob spawn (S-68 — the (state,value) tuple-order regression) ] ═ ]
// The deployed engine destructured the prng tuple BACKWARDS (bound the 32-bit STATE as the value), so level
// was a raw ~2^32 PRNG state and hp exploded — fights unwinnable. These tests exercise the min<max roll branch
// the old min==max templates SKIPPED, and freeze the corrected stream forever. Contract (prng.move): every
// tuple is (next_state, value); rng_range is INCLUSIVE [min,max].

// A FULL walkable mask (every one of the 380 cells set) → the spawn-cell pool is [0,1,…,379] in order, so with
// no blockers the picked cell equals the raw prng index — makes the pinned-cell vector exactly computable.
#[test_only]
fun full_mask(): vector<u64> {
  let mut m = combat_grid::empty_mask();
  let mut c = 0;
  while (c < combat_grid::grid_cells()) { combat_grid::mask_set(&mut m, c); c = c + 1; };
  m
}
// A mob spec with an explicit level band (neutral stats, no spells/loot — only the roll math matters here).
#[test_only]
fun banded_spec(min_level: u16, max_level: u16, base_hp: u64): mob::MobSpec {
  mob::new_mob_spec(min_level, max_level, base_hp, 6, 3,
    spell::new_stats(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0), vector[], 100, vector[])
}

#[test]
/// (a) The rolled level stays inside [min,max] across 200 seeds (the old inversion put a ~2^32 state here).
fun spawn_seeded_level_in_band_over_seeds() {
  let spec = banded_spec(10, 20, 100);
  let mask = full_mask();
  let empty: vector<u64> = vector[];
  let mut seed = 0u64;
  while (seed < 200) {
    let (m, _s) = mob::spawn_seeded(&spec, &mask, &empty, &empty, &empty, 0, seed);
    let lvl = mob::level(&m);
    assert!(lvl >= 10 && lvl <= 20);
    seed = seed + 1;
  };
}

#[test]
/// (b) hp/max_hp == scaled_hp(rolled level) and stays in the [scaled(min)=70, scaled(max)=140] band — never
/// the 19-billion garbage the state-as-level bug produced.
fun spawn_seeded_hp_matches_scaled_level() {
  let spec = banded_spec(10, 20, 100);
  let mask = full_mask();
  let empty: vector<u64> = vector[];
  let mut seed = 0u64;
  while (seed < 200) {
    let (m, _s) = mob::spawn_seeded(&spec, &mask, &empty, &empty, &empty, 0, seed);
    let expect_hp = mob::scaled_hp_for_testing(100, 10, 20, mob::level(&m));
    assert_eq!(mob::hp(&m), expect_hp);
    assert_eq!(mob::max_hp(&m), expect_hp);
    assert!(expect_hp >= 70 && expect_hp <= 140);
    seed = seed + 1;
  };
}

#[test]
/// (c) PINNED VECTOR — FROZEN forever. seed 0, band [10,20], full mask, no blockers, archimob_bp 0. Derived by
/// hand from the prng reference vectors (prng.move test): rng_next(0)→val 1144304738; 1144304738 % 11 = 5 →
/// level 15; next state 1831565813; rng_next→val 1416247; 1416247 % 10000 = 6247 (archimob roll, bp 0 → false);
/// next state 3663131626; rng_next→val 958946056; 958946056 % 380 = 96 → cell 96; final state 1199730143.
/// hp = scaled(100,10,20,15) = 105. ANY drift here means the on-chain stream desynced from the JS sim client.
fun spawn_seeded_pinned_vector_freezes_stream() {
  let spec = banded_spec(10, 20, 100);
  let mask = full_mask();
  let empty: vector<u64> = vector[];
  let (m, state_out) = mob::spawn_seeded(&spec, &mask, &empty, &empty, &empty, 0, 0);
  assert_eq!(mob::level(&m), 15);
  assert_eq!(mob::hp(&m), 105);
  assert_eq!(mob::cell(&m), 96);
  assert_eq!(mob::is_archimob(&m), false);
  assert_eq!(state_out, 1199730143);
}

#[test]
/// (d) archimob_bp = 10000 (100%): the roll is rng_int(_,10000) ∈ [0,10000), ALWAYS < 10000 → the flag is
/// certain across 100 seeds. Pre-fix the inverted binding put the 32-bit STATE in `aroll`, almost never
/// < 10000, so the §8 archimob roll was silently dead — this asserts it fires.
fun spawn_seeded_archimob_certain_at_full_bp() {
  let spec = banded_spec(10, 20, 100);
  let mask = full_mask();
  let empty: vector<u64> = vector[];
  let mut seed = 0u64;
  while (seed < 100) {
    let (m, _s) = mob::spawn_seeded(&spec, &mask, &empty, &empty, &empty, 10000, seed);
    assert!(mob::is_archimob(&m));
    seed = seed + 1;
  };
}

// ╔════════════════ [ §17.21 STOCHASTIC AI — seed-goldens + viability + spread ] ═ ]
// The policy is a WEIGHTED DRAW over the viable-action set off a threaded rng: replay is EXACT from a seed,
// futures are unpredictable, and NONSENSE (out-of-range casts, full-HP-ally heals) is never selected. These
// tests fix a seed list, so every assertion below is fully deterministic (no flake).

// An ally/self heal: AP 3, range 0..6, no LOS, one heal(30) base effect (TF_NOT_ENEMY — ally-inclusive).
#[test_only]
fun heal_level(): spell_effect::SpellLevel {
  spell_effect::new_spell_level(1, 3, 0, 6, false, false, false, false, 255, 255, 0, 0, false, vector[], vector[], vector[spell_effect::heal(30)], vector[])
}
// An enemy fire: AP 4, range 1..6, LOS required, one fire damage(15).
#[test_only]
fun fire_level(): spell_effect::SpellLevel {
  spell_effect::new_spell_level(1, 4, 1, 6, false, false, true, false, 255, 255, 0, 0, false, vector[], vector[], vector[spell_effect::damage(spell::el_fire(), 15)], vector[])
}
// A MIN-RANGE enemy fire: AP 4, range 2..4 (a ranged mob's dead-zone band — uncastable point-blank), LOS req.
#[test_only]
fun fire_level_min2(): spell_effect::SpellLevel {
  spell_effect::new_spell_level(1, 4, 2, 4, false, false, true, false, 255, 255, 0, 0, false, vector[], vector[], vector[spell_effect::damage(spell::el_fire(), 15)], vector[])
}
// A melee enemy fire: AP 4, range 1..1 (must be adjacent), LOS req — the pure "rush + strike" class.
#[test_only]
fun fire_level_melee(): spell_effect::SpellLevel {
  spell_effect::new_spell_level(1, 4, 1, 1, false, false, true, false, 255, 255, 0, 0, false, vector[], vector[], vector[spell_effect::damage(spell::el_fire(), 15)], vector[])
}

/// Encode one decision as a comparable key (cells < 100_000; spell 0 = none).
#[test_only]
fun decision_key(new_cell: u64, spell_opt: &Option<u64>, target: u64): u64 {
  let sp = if (spell_opt.is_some()) *spell_opt.borrow() + 1 else 0;
  new_cell * 10_000_000 + sp * 1_000_000 + target
}

#[test]
/// REPLAY LAW: the same rng seed produces the byte-identical decision (a fight turn replays exactly from its
/// recorded seed); two different seeds are allowed to differ (and do, over the spread test below).
fun mob_ai_replay_exact_from_seed() {
  let healer = combat_grid::encode(2, 5);
  let ally_hurt = combat_grid::encode(4, 5);
  let player = combat_grid::encode(5, 5);
  let kit = vector[fire_level(), heal_level()];
  let m = mob::new_mob_for_testing(healer, 100, 100, 6, 3);
  let mut r1 = 42u64;
  let (c1, s1, t1) = mob::decide_turn(&m, &kit, &vector[player], &vector[ally_hurt], &vector[60], &vector[], &vector[], &mut r1);
  let mut r2 = 42u64;
  let (c2, s2, t2) = mob::decide_turn(&m, &kit, &vector[player], &vector[ally_hurt], &vector[60], &vector[], &vector[], &mut r2);
  assert_eq!(decision_key(c1, &s1, t1), decision_key(c2, &s2, t2));
}

#[test]
/// VIABILITY FILTER: a healer with a FULL-hp ally never wastes the heal (a heal is only ever aimed at a wounded
/// ally), and every cast picked is actually castable — across 64 fixed seeds.
fun mob_ai_never_picks_nonsense() {
  let healer = combat_grid::encode(2, 5);
  let ally_full = combat_grid::encode(3, 5); // missing 0 — healing it is NONSENSE
  let player = combat_grid::encode(5, 5); // in fire range (manhattan 3), LOS clear
  let kit = vector[fire_level(), heal_level()];
  let m = mob::new_mob_for_testing(healer, 100, 100, 6, 3);
  let mut i = 0u64;
  while (i < 64) {
    let mut rng = i;
    let (_c, sp, tgt) = mob::decide_turn(&m, &kit, &vector[player], &vector[ally_full], &vector[0], &vector[], &vector[], &mut rng);
    if (sp.is_some()) {
      let s = sp.destroy_some();
      if (s == 1) assert!(tgt != ally_full); // the heal never lands on a full ally (it is filtered as nonsense)
      if (s == 0) assert_eq!(tgt, player); // the fire only ever aims at the player
    };
    i = i + 1;
  };
}

#[test]
/// SPREAD LAW, attack-dominant era (supersedes the earlier 3-way premise): with an attack viable the
/// draw pool is {attacks, heals} ONLY — reposition is STRUCTURALLY excluded ("a mob that can hit never
/// wanders"). The spread this guards is over the surviving pool: ≥2 distinct decisions over 200 fixed seeds,
/// most frequent ≤70%, and EVERY draw casts (an attack-capable mob never bare-moves).
fun mob_ai_spreads_over_viable_actions() {
  let healer = combat_grid::encode(2, 5);
  let ally_hurt = combat_grid::encode(4, 5); // wounded → heal viable (range 0..6)
  let player = combat_grid::encode(5, 5); // fire viable from here (range 1..6)
  let kit = vector[fire_level(), heal_level()];
  let m = mob::new_mob_for_testing(healer, 100, 100, 6, 3);
  let mut keys: vector<u64> = vector[];
  let mut counts: vector<u64> = vector[];
  let total = 200u64;
  let mut i = 0u64;
  while (i < total) {
    let mut rng = i * 7919 + 13; // fixed seed schedule
    let (c, sp, t) = mob::decide_turn(&m, &kit, &vector[player], &vector[ally_hurt], &vector[60], &vector[], &vector[], &mut rng);
    assert!(sp.is_some()); // attack-dominant invariant: never a bare reposition while an attack is viable
    let k = decision_key(c, &sp, t);
    let (found, idx) = keys.index_of(&k);
    if (found) { let cnt = counts.borrow_mut(idx); *cnt = *cnt + 1; } else { keys.push_back(k); counts.push_back(1); };
    i = i + 1;
  };
  assert!(keys.length() >= 2); // the fire attack AND the heal both draw real probability mass
  let mut mx = 0u64;
  let mut j = 0;
  while (j < counts.length()) { if (*counts.borrow(j) > mx) mx = *counts.borrow(j); j = j + 1; };
  assert!(mx * 100 <= total * 70); // no single action dominates past 70%
}

#[test]
/// A pure damage kit (no heal) with a wounded ally NEVER heals (no support action exists) — every cast is the
/// fire at the player, across seeds. Guards the viable-set composition.
fun mob_ai_no_heal_kit_ignores_wounded_ally() {
  let attacker = combat_grid::encode(2, 5);
  let ally_hurt = combat_grid::encode(3, 5);
  let player = combat_grid::encode(5, 5);
  let kit = vector[fire_level()];
  let m = mob::new_mob_for_testing(attacker, 100, 100, 6, 3);
  let mut i = 0u64;
  while (i < 32) {
    let mut rng = i;
    let (_c, sp, tgt) = mob::decide_turn(&m, &kit, &vector[player], &vector[ally_hurt], &vector[80], &vector[], &vector[], &mut rng);
    if (sp.is_some()) { assert_eq!(sp.destroy_some(), 0); assert_eq!(tgt, player); };
    i = i + 1;
  };
}

#[test]
/// NOTHING VIABLE → idle in place (no cast, no move): surrounded by walls (every neighbor blocked), target far
/// out of range. The degenerate case never aborts and never fabricates an action.
fun mob_ai_idles_when_nothing_viable() {
  let cell = combat_grid::encode(2, 5);
  let far_player = combat_grid::encode(16, 15); // far outside fire range 1..6
  // wall off every step the BFS could take by blocking the 4 neighbors (a wall BITSET — gas-diet #1).
  let blocked = combat_grid::mask_from_cells(&vector[combat_grid::encode(1, 5), combat_grid::encode(3, 5), combat_grid::encode(2, 4), combat_grid::encode(2, 6)]);
  let kit = vector[fire_level()];
  let m = mob::new_mob_for_testing(cell, 100, 100, 6, 3);
  let mut rng = 7u64;
  let (c, sp, _t) = mob::decide_turn(&m, &kit, &vector[far_player], &vector[], &vector[], &blocked, &vector[], &mut rng);
  assert_eq!(c, cell); // no move
  assert!(sp.is_none()); // no cast
}

// ╔════════════════ [ §17.21 RANGE-BAND advance — fixes mobs walking adjacent without attacking ] ═ ]
// ROOT CAUSE: the mob advance was `bfs_best_toward` — minimize distance to the target, blind to the spell's
// range band and LOS. A min-range (≥2) mob thus RUSHED to an adjacent cell where its own spell is uncastable
// (d < range_min), and an LOS-required cast from behind an obstacle was never offered — leaving `reposition`
// (a plain rush) the only viable action, so the mob walked up and idled. FIX: `combat_grid::bfs_cast_cell`
// paths to the closest reachable cell INSIDE the effective [min,max] band with clear LOS, so a castable
// attack enters the viable set. The stochastic weights are untouched — only action generation.

#[test]
/// REPRODUCTION: a MIN-RANGE mob (range 2..4) with the MP to overshoot to adjacent
/// (d=1) must still ATTACK, not just walk. PRE-FIX `decide_turn` returned NO cast for every seed — the old
/// advance landed the mob at d=1 (below min 2 → uncastable), leaving only `reposition`. POST-FIX the band-aware
/// advance finds an in-band cast cell, so casts are drawn (and every cast is legal from its landing cell).
fun mob_ai_min_range_mob_attacks_not_just_walks() {
  let mob_cell = combat_grid::encode(2, 5);
  let player = combat_grid::encode(8, 5); // manhattan 6 — out of band; mp 6 can overshoot to d=1 (the dead zone)
  let kit = vector[fire_level_min2()];
  let m = mob::new_mob_for_testing(mob_cell, 100, 100, 6, 6);
  let mut cast_seen = false;
  let mut i = 0u64;
  while (i < 64) {
    let mut rng = i;
    let (nc, sp, tgt) = mob::decide_turn(&m, &kit, &vector[player], &vector[], &vector[], &vector[], &vector[], &mut rng);
    if (sp.is_some()) {
      cast_seen = true;
      let d = combat_grid::manhattan(nc, player);
      assert!(d >= 2 && d <= 4); // the cast is only ever taken from a cell inside the [2,4] band
      assert_eq!(tgt, player);
    };
    i = i + 1;
  };
  assert!(cast_seen); // the mob ATTACKS — PRE-FIX this fails: not one cast was ever drawn (walk-only)
}

#[test]
/// MELEE rush + strike: a range-1 mob closes to an ADJACENT cell and strikes from there (the classic rush).
/// Every cast it draws is taken from a cell exactly 1 away from the player.
fun mob_ai_melee_rushes_and_strikes_adjacent() {
  let mob_cell = combat_grid::encode(2, 5);
  let player = combat_grid::encode(5, 5); // manhattan 3 — must close to adjacent to swing
  let kit = vector[fire_level_melee()];
  let m = mob::new_mob_for_testing(mob_cell, 100, 100, 6, 6);
  let mut cast_seen = false;
  let mut i = 0u64;
  while (i < 64) {
    let mut rng = i;
    let (nc, sp, tgt) = mob::decide_turn(&m, &kit, &vector[player], &vector[], &vector[], &vector[], &vector[], &mut rng);
    if (sp.is_some()) { cast_seen = true; assert_eq!(combat_grid::manhattan(nc, player), 1); assert_eq!(tgt, player); };
    i = i + 1;
  };
  assert!(cast_seen);
}

#[test]
/// MIN-RANGE HOLDS its band: a range 2..4 mob already standing in band (d=3) casts IN PLACE — it never creeps
/// to point-blank to attack. Every cast is drawn from the mob's own cell (no self-inflicted overshoot).
fun mob_ai_min_range_holds_band_and_casts_in_place() {
  let mob_cell = combat_grid::encode(2, 5);
  let player = combat_grid::encode(5, 5); // manhattan 3 — inside the [2,4] band already
  let kit = vector[fire_level_min2()];
  let m = mob::new_mob_for_testing(mob_cell, 100, 100, 6, 6);
  let mut cast_seen = false;
  let mut i = 0u64;
  while (i < 64) {
    let mut rng = i;
    let (nc, sp, tgt) = mob::decide_turn(&m, &kit, &vector[player], &vector[], &vector[], &vector[], &vector[], &mut rng);
    if (sp.is_some()) { cast_seen = true; assert_eq!(nc, mob_cell); assert_eq!(tgt, player); }; // casts without moving
    i = i + 1;
  };
  assert!(cast_seen);
}

#[test]
/// OBSTACLE-BLOCKED LOS repaths: an obstacle on the straight line makes the naive closest approach cell
/// (5,5) unable to SEE the player — the band-aware advance instead lands the mob on a cell with CLEAR line of
/// sight. Invariant: every cast the AI draws is LOS-legal AND in range from its landing cell (never a blind shot).
fun mob_ai_los_blocked_repaths_to_a_seeing_cell() {
  let mob_cell = combat_grid::encode(2, 5);
  let player = combat_grid::encode(8, 5);
  let obstacle = combat_grid::encode(6, 5); // sits on row 5 between any left cell and the player
  let blocked = vector[obstacle]; // LOS blocker CELL LIST (line_of_sight iterates it)
  let blocked_mask = combat_grid::mask_from_cells(&blocked); // the SAME wall as a BFS BITSET (gas-diet #1)
  // the naive straight-line approach cell (5,5) is LOS-BLOCKED by the obstacle → the old advance would strand it.
  assert!(!combat_grid::line_of_sight(combat_grid::encode(5, 5), player, &blocked));
  let kit = vector[fire_level()]; // range 1..6, LOS required
  let m = mob::new_mob_for_testing(mob_cell, 100, 100, 6, 6);
  let mut cast_seen = false;
  let mut i = 0u64;
  while (i < 64) {
    let mut rng = i;
    let (nc, sp, tgt) = mob::decide_turn(&m, &kit, &vector[player], &vector[], &vector[], &blocked_mask, &blocked, &mut rng);
    if (sp.is_some()) {
      cast_seen = true;
      assert!(combat_grid::line_of_sight(nc, player, &blocked)); // the cast cell can SEE the target
      let d = combat_grid::manhattan(nc, player);
      assert!(d >= 1 && d <= 6);
      assert_eq!(tgt, player);
    };
    i = i + 1;
  };
  assert!(cast_seen); // the obstacle never strands the mob — it finds a seeing cell and fires
}

#[test]
/// AP GATE ("stops after casts, not before"): a mob whose AP is below the spell's cost CANNOT cast — it falls to
/// the rush (advances toward the player), never idling; the SAME mob with enough AP does cast. Proves the AP gate,
/// not the range band, decides castability. (Mob attacks are casts_per_turn 1 today, so one cast is the whole turn.)
fun mob_ai_ap_starved_rushes_ap_flush_casts() {
  let mob_cell = combat_grid::encode(2, 5);
  let player = combat_grid::encode(5, 5); // manhattan 3, inside fire range 1..6
  let start_d = combat_grid::manhattan(mob_cell, player);
  // fire_level costs 4 AP. Starved mob: ap 3 (< 4) → cannot cast anywhere.
  let kit = vector[fire_level()];
  let starved = mob::new_mob_for_testing(mob_cell, 100, 100, 3, 6);
  let mut advanced = false;
  let mut i = 0u64;
  while (i < 64) {
    let mut rng = i;
    let (nc, sp, _t) = mob::decide_turn(&starved, &kit, &vector[player], &vector[], &vector[], &vector[], &vector[], &mut rng);
    assert!(sp.is_none()); // never casts — it can't afford the spell
    if (combat_grid::manhattan(nc, player) < start_d) advanced = true; // but it DOES rush in
    i = i + 1;
  };
  assert!(advanced);
  // AP-flush mob: ap 6 (>= 4) → casts (from its in-range cell).
  let kit = vector[fire_level()];
  let flush = mob::new_mob_for_testing(mob_cell, 100, 100, 6, 6);
  let mut cast_seen = false;
  let mut j = 0u64;
  while (j < 64) {
    let mut rng = j;
    let (_c, sp, _t) = mob::decide_turn(&flush, &kit, &vector[player], &vector[], &vector[], &vector[], &vector[], &mut rng);
    if (sp.is_some()) cast_seen = true;
    j = j + 1;
  };
  assert!(cast_seen);
}

#[test]
/// The heal APPLICATION primitive (the landing end of the AI pick): `apply_heal` raises hp, caps at max_hp, and
/// never revives a dead (0-hp) mob. Proves the hp actually rises once the resolver routes a k_heal to the ally.
fun mob_apply_heal_raises_caps_and_never_revives() {
  let mut m = mob::new_mob_for_testing(0, 40, 100, 6, 3);
  mob::apply_heal(&mut m, 30);
  assert_eq!(mob::hp(&m), 70); // 40 → 70
  mob::apply_heal(&mut m, 1000);
  assert_eq!(mob::hp(&m), 100); // capped at max_hp
  let mut dead = mob::new_mob_for_testing(0, 0, 100, 6, 3);
  mob::apply_heal(&mut dead, 50);
  assert_eq!(mob::hp(&dead), 0); // a corpse stays dead
}

// ╔════════════════ [ Timed-alter recompute (the revert-saturation regression) ] ═ ]

fun seat_with(stats: spell::Stats): participant::Participant {
  let c = participant::new_combatant(
    object::id_from_address(@0xA), b"iop".to_string(), 10, stats,
    100, 100, 6, 3, participant::weapon_line_of(option::none(), false), sui::vec_map::empty(),
  );
  participant::new(c, @0xA, 0, 0)
}
fun seat_with_strength(base: u64): participant::Participant {
  seat_with(spell::new_stats(base, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0))
}
fun strength_of(p: &participant::Participant): u64 { spell::stat_strength(participant::stats(p)) }

#[test]
/// A debuff EXCEEDING the stat clamps live to 0; when its row leaves, live returns to EXACTLY base. The old
/// flipped-sign revert re-added the full magnitude (30 → 0 → 50: a permanent +20 leak into loot-roll chance).
fun timed_debuff_exceeding_stat_reverts_exactly() {
  let mut p = seat_with_strength(30);
  let debuff = spell_effect::alter_stat(spell_effect::stat_strength(), participant::centered_value(50, true), true, true, 2);
  participant::refresh_stats(&mut p, &vector[debuff]);
  assert_eq!(strength_of(&p), 0);
  participant::refresh_stats(&mut p, &vector[]); // row expired/dispelled → re-derive from base
  assert_eq!(strength_of(&p), 30);
}

#[test]
/// INTERLEAVED clamped rows: +50 buff and −70 debuff on base 30 → 10; buff expires → 0; debuff expires → 30.
/// Per-row delta bookkeeping cannot reproduce this (the revert itself clamps); re-derivation is exact.
fun interleaved_clamped_alters_rederive_exactly() {
  let mut p = seat_with_strength(30);
  let buff = spell_effect::alter_stat(spell_effect::stat_strength(), participant::centered_value(50, false), false, true, 2);
  let debuff = spell_effect::alter_stat(spell_effect::stat_strength(), participant::centered_value(70, true), true, true, 3);
  participant::refresh_stats(&mut p, &vector[buff, debuff]);
  assert_eq!(strength_of(&p), 10);
  participant::refresh_stats(&mut p, &vector[debuff]); // buff expired first
  assert_eq!(strength_of(&p), 0);
  participant::refresh_stats(&mut p, &vector[]); // debuff expired
  assert_eq!(strength_of(&p), 30);
}

// ╔════════════════ [ The signed-effect encoding — captured wire bytes (#904) ] ═ ]

#[test]
/// CAPTURED CHAIN BYTES. Signed effect values are stored CENTERED at 32768 — the sign lives in the VALUE, and
/// `FLAG_NEGATIVE` is never read for it (#904 final ruling). Provenance: testnet `sui client object`, 2026-07-26.
///   Razkin  0x4a00a579…be97 (version 45, digest 7i3f6jDBPuhsqGUU7P3jeTRdepwcN3bDZ9Ne5J65icBA)
///     spells[1].effects[0] = { kind 9, stat 8 percent_damage, flags 0, value "32793", turns 2 } — authors +25
///   Bonelet 0xb80ade53…d444 = { kind 9, stat 3 agility, flags 8, value "32751" } — authors −17
/// The buff is a POSITIVE delta carrying flags 0 and the debuff carries flags 8: reading the flag for sign
/// folded Razkin's raw 32793 onto the mob (a ~32768× buff) and shredded the debuffed stat to the 0 floor.
fun captured_centered_rows_fold_their_authored_delta() {
  let mut p = seat_with(spell::new_stats(0, 0, 0, 20, 0, 0, 0, 0, 0, 0, 0)); // agility 20
  let razkin = spell_effect::new_effect(
    spell_effect::k_alter_stat(), 255, 32_793, spell_effect::shape_point(), 0,
    spell_effect::tf_not_enemy(), 100, 2, spell_effect::stat_percent_damage(), 0, spell_effect::phase_on_enter(),
  );
  let bonelet = spell_effect::new_effect(
    spell_effect::k_alter_stat(), 255, 32_751, spell_effect::shape_point(), 0,
    spell_effect::tf_not_team(), 100, 2, spell_effect::stat_agility(), spell_effect::flag_negative(),
    spell_effect::phase_on_enter(),
  );

  participant::refresh_stats(&mut p, &vector[razkin]);
  assert_eq!(spell::stat_percent_damage(participant::stats(&p)), 25); // +25 — NOT +32793

  participant::refresh_stats(&mut p, &vector[bonelet]);
  assert_eq!(spell::stat_agility(participant::stats(&p)), 3); // 20 − 17 — NOT floored to 0

  // Both live: the two-pass ordering is untouched — every addition first, then one saturating subtraction pass.
  participant::refresh_stats(&mut p, &vector[bonelet, razkin]);
  assert_eq!(spell::stat_percent_damage(participant::stats(&p)), 25);
  assert_eq!(spell::stat_agility(participant::stats(&p)), 3);

  // The rows stay the single home for timed deltas: drop them and live returns to EXACTLY base.
  participant::refresh_stats(&mut p, &vector[]);
  assert_eq!(spell::stat_agility(participant::stats(&p)), 20);
  assert_eq!(spell::stat_percent_damage(participant::stats(&p)), 0);
}

#[test]
/// The encoding round-trips and the neutral point is exact: 32768 is a zero delta, not a 32768-strong buff.
fun centered_value_round_trips_through_alter_delta() {
  let neutral = spell_effect::alter_stat(spell_effect::stat_strength(), 32_768, false, true, 1);
  let (amount, negative) = participant::alter_delta(&neutral);
  assert_eq!(amount, 0);
  assert!(!negative);

  assert_eq!(participant::centered_value(25, false), 32_793); // Razkin's minted value, derived
  assert_eq!(participant::centered_value(17, true), 32_751); // Bonelet's minted value, derived

  let buff = spell_effect::alter_stat(spell_effect::stat_strength(), participant::centered_value(25, false), false, true, 1);
  let (buff_amount, buff_negative) = participant::alter_delta(&buff);
  assert_eq!(buff_amount, 25);
  assert!(!buff_negative);

  // A magnitude past the shift saturates at value 0 (the most-negative row) rather than wrapping the u64.
  assert_eq!(participant::centered_value(40_000, true), 0);
}

#[test]
/// PERMANENT (turns==0) alters land on the BASE block and survive every re-derivation; timed rows stack on top.
fun permanent_alter_lands_on_base() {
  let mut p = seat_with_strength(30);
  participant::alter_base_stat(&mut p, spell_effect::stat_strength(), 10, false);
  participant::refresh_stats(&mut p, &vector[]);
  assert_eq!(strength_of(&p), 40);
  let debuff = spell_effect::alter_stat(spell_effect::stat_strength(), participant::centered_value(100, true), true, true, 1);
  participant::refresh_stats(&mut p, &vector[debuff]);
  assert_eq!(strength_of(&p), 0);
  participant::refresh_stats(&mut p, &vector[]);
  assert_eq!(strength_of(&p), 40);
}

#[test]
/// S-16-sim board parity dump: derives the JS golden's three inputs and PRINTS every field — diff the run's
/// debug output against sim/test/board_gen.test.js GOLDEN to prove bit-exact parity (FIXTURE_GAP settlement).
fun board_dump_for_js_parity() {
  let cases = vector[vector[12345u64, 100, 200], vector[777u64, 5, 5], vector[3735928559u64, 4000000000, 3000000000]];
  let mut i = 0;
  while (i < cases.length()) {
    let c = cases.borrow(i);
    let g = board::generate_for_anchor(*c.borrow(0), (*c.borrow(1) as u32), (*c.borrow(2) as u32));
    std::debug::print(&board::grid_width(&g));
    std::debug::print(&board::grid_height(&g));
    std::debug::print(&board::shape_mask(&g));
    std::debug::print(&board::obstacles(&g));
    std::debug::print(&board::holes(&g));
    std::debug::print(&board::start_cells_a(&g));
    std::debug::print(&board::start_cells_b(&g));
    i = i + 1;
  };
}
