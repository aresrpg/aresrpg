// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// GAS-DIET proofs for the mob-AI compute crank (money-path — the crank cost is compute-dominated + was unbounded
/// per living mob). Covers the sanctioned/behavior-neutral changes landed in `mob_ai` + `combat_grid`:
///   (a) bfs_cast_cell EARLY-EXIT is RESULT-PRESERVING — it returns the exact cell a full-scan would, proven
///       against a brute-force reference over crafted boards (open movement ⇒ BFS cost == manhattan, so the
///       reference needs no BFS of its own).
///   (b) decide_turn's TARGET CAP considers only the nearest 2 players — deterministic, replay-exact, and a
///       farther target is NEVER selected.
///   (c) the cast UNREACHABLE PRE-CHECK is behavior-neutral at the rmax+mp reachability boundary.
#[test_only]
module aresrpg_foundation::mob_ai_gas_tests;

use aresrpg_foundation::{combat_grid, mob_ai, prng, spell_effect::{Self, SpellLevel}, spell};

// ── spell kit builders (mirror the engine pure_tests fixtures) ────────────────────────────────────────────────
// enemy fire: AP 4, range 1..6, LOS required.
#[test_only]
fun fire(): SpellLevel {
  spell_effect::new_spell_level(1, 4, 1, 6, false, false, true, false, 255, 255, 0, 0, false, vector[], vector[], vector[spell_effect::damage(spell::el_fire(), 15)], vector[])
}
// melee fire: AP 4, range 1..1, LOS required — the pure rush-and-strike class.
#[test_only]
fun fire_melee(): SpellLevel {
  spell_effect::new_spell_level(1, 4, 1, 1, false, false, true, false, 255, 255, 0, 0, false, vector[], vector[], vector[spell_effect::damage(spell::el_fire(), 15)], vector[])
}

// ── (a) EARLY-EXIT == FULL SCAN ──────────────────────────────────────────────────────────────────────────────
// Reference: the definitional min-(cost, then manhattan-to-target, then cell-index) castable cell. With an EMPTY
// movement-blocked set the board is fully open and convex, so BFS path cost == manhattan(start, cell) — the
// reference can enumerate cells with cost = manhattan and needs no BFS. This is exactly what the pre-early-exit
// full scan computed, so equality proves the early-exit changed nothing but the work done.
#[test_only]
fun ref_cast_cell(start: u64, target: u64, budget: u64, rmin: u64, rmax: u64, needs_los: bool, los: &vector<u64>): Option<u64> {
  let n = combat_grid::grid_cells();
  let mut best = option::none<u64>();
  let mut best_cost = 0;
  let mut best_dist = 0;
  let mut c = 0;
  while (c < n) {
    let cost = combat_grid::manhattan(start, c);
    if (cost <= budget) {
      let d = combat_grid::manhattan(c, target);
      let in_band = d >= rmin && d <= rmax;
      let los_ok = !needs_los || combat_grid::line_of_sight(c, target, los);
      if (in_band && los_ok) {
        if (best.is_none() || cost < best_cost || (cost == best_cost && d < best_dist) || (cost == best_cost && d == best_dist && c < *best.borrow())) {
          best = option::some(c); best_cost = cost; best_dist = d;
        };
      };
    };
    c = c + 1;
  };
  best
}

// assert bfs_cast_cell (with the early-exit) matches the reference; `blocked` empty so cost == manhattan holds.
#[test_only]
fun assert_matches(start: u64, target: u64, budget: u64, rmin: u64, rmax: u64, needs_los: bool, los: vector<u64>, code: u64) {
  let got = combat_grid::bfs_cast_cell(start, target, &vector[], budget, rmin, rmax, needs_los, &los);
  let want = ref_cast_cell(start, target, budget, rmin, rmax, needs_los, &los);
  assert!(got == want, code);
}

#[test]
fun bfs_cast_early_exit_matches_full_scan() {
  // 1) MELEE (range 1..1): the min-cost adjacent cell.
  assert_matches(combat_grid::encode(2, 5), combat_grid::encode(8, 5), 10, 1, 1, false, vector[], 1);
  // 2) BAND (range 2..4): the near edge reached first.
  assert_matches(combat_grid::encode(2, 5), combat_grid::encode(15, 5), 12, 2, 4, false, vector[], 2);
  // 3) MIN-RANGE BACKSTEP: start adjacent (d1 < rmin) → must step OUT to the [2,4] band.
  assert_matches(combat_grid::encode(5, 5), combat_grid::encode(6, 5), 6, 2, 4, false, vector[], 3);
  // 4) LOS-BLOCKED (movement open, sight blocked at (5,5)): must reroute to a cell that can SEE the target.
  assert_matches(combat_grid::encode(2, 5), combat_grid::encode(8, 5), 10, 1, 6, true, vector[combat_grid::encode(5, 5)], 4);
  // 5) UNREACHABLE within budget → both `none`.
  assert_matches(combat_grid::encode(2, 5), combat_grid::encode(18, 15), 3, 1, 1, false, vector[], 5);

  // the crafted boards 1-4 must actually have a castable cell (guard against a vacuous pass).
  assert!(ref_cast_cell(combat_grid::encode(2, 5), combat_grid::encode(8, 5), 10, 1, 1, false, &vector[]).is_some(), 10);
  assert!(ref_cast_cell(combat_grid::encode(5, 5), combat_grid::encode(6, 5), 6, 2, 4, false, &vector[]).is_some(), 11);
}

// ── (b) TARGET CAP — nearest 2 only, deterministic ───────────────────────────────────────────────────────────
#[test]
fun decide_turn_caps_to_nearest_two() {
  let mob = combat_grid::encode(2, 5);
  let w = mob_ai::new_weights(120, 100, 100, 40);
  let spells = vector[fire()]; // range 1..6, LOS req (empty los ⇒ always clear)
  // nearest two = A(5,5) d3 and B(6,5) d4; C(12,5) d10 and D(15,5) d13 must NEVER be chosen (unordered input).
  let targets = vector[combat_grid::encode(15, 5), combat_grid::encode(6, 5), combat_grid::encode(5, 5), combat_grid::encode(12, 5)];
  let a = combat_grid::encode(5, 5);
  let b = combat_grid::encode(6, 5);
  let mut seed = 1;
  while (seed < 64) {
    let mut rng = seed;
    let (_c, _sp, tgt) = mob_ai::decide_turn(mob, 6, 6, &spells, &targets, &vector[], &vector[], &vector[], &vector[], 0, &w, &mut rng);
    assert!(tgt == a || tgt == b, seed); // a farther target is never engaged
    seed = seed + 1;
  };
}

#[test]
fun decide_turn_cap_is_replay_exact() {
  let mob = combat_grid::encode(5, 5);
  let w = mob_ai::new_weights(120, 100, 100, 40);
  let spells = vector[fire()];
  // two targets tie at d3 (indices 0,1) → both are the nearest-2; a third at d7 must be excluded.
  let targets = vector[combat_grid::encode(5, 8), combat_grid::encode(5, 2), combat_grid::encode(12, 5)];
  let mut r1 = 77;
  let mut r2 = 77;
  let (c1, s1, t1) = mob_ai::decide_turn(mob, 6, 6, &spells, &targets, &vector[], &vector[], &vector[], &vector[], 0, &w, &mut r1);
  let (c2, s2, t2) = mob_ai::decide_turn(mob, 6, 6, &spells, &targets, &vector[], &vector[], &vector[], &vector[], 0, &w, &mut r2);
  assert!(c1 == c2 && t1 == t2 && s1.is_some() == s2.is_some(), 0); // same state + seed ⇒ identical decision
  assert!(t1 == combat_grid::encode(5, 8) || t1 == combat_grid::encode(5, 2), 1); // the d7 target is never chosen
}

// ── (c) UNREACHABLE PRE-CHECK boundary (behavior-neutral) ────────────────────────────────────────────────────
#[test]
fun cast_reachability_boundary() {
  let w = mob_ai::new_weights(120, 100, 100, 40);
  let melee = vector[fire_melee()]; // range 1..1 ⇒ reachable iff manhattan(mob,target) <= 1 + mp
  let mob = combat_grid::encode(2, 5);

  // AT the boundary d=7 (== rmax 1 + mp 6): the cell (8,5) is a reachable cast cell → a cast IS drawn on some seed.
  let mut cast_at_boundary = false;
  let mut s = 1;
  while (s < 80) {
    let mut rng = s;
    let (_c, sp, _t) = mob_ai::decide_turn(mob, 6, 6, &melee, &vector[combat_grid::encode(9, 5)], &vector[], &vector[], &vector[], &vector[], 0, &w, &mut rng);
    if (sp.is_some()) cast_at_boundary = true;
    s = s + 1;
  };
  assert!(cast_at_boundary, 1);

  // BEYOND it d=8 (> rmax+mp): no cast cell is reachable → the pre-check returns none (same as a full BFS) and the
  // mob only ever repositions. Never a cast, across every seed.
  let mut cast_beyond = false;
  let mut s2 = 1;
  while (s2 < 80) {
    let mut rng = s2;
    let (_c, sp, _t) = mob_ai::decide_turn(mob, 6, 6, &melee, &vector[combat_grid::encode(10, 5)], &vector[], &vector[], &vector[], &vector[], 0, &w, &mut rng);
    if (sp.is_some()) cast_beyond = true;
    s2 = s2 + 1;
  };
  assert!(!cast_beyond, 2);
}

// ══════════════════════════════════════════════════════════════════════════════════════════════════════════════
// GAS-DIET #1 — WALL SETS & `visited` AS BITMASKS (result-identity proof)
// The three BFS fns now read a MASK_WORDS-word wall BITSET (`mask_get` — O(1)) instead of an O(|blocked|) cell-list
// `.contains`, and use a 6-word `visited` bitset instead of a 380-`push_back` vector<bool>. REPRESENTATION-ONLY:
// these tests prove the production (mask) BFS returns the EXACT result a VERBATIM COPY of the OLD cell-list
// algorithm (vector<bool> visited + `.contains`) returns, on crafted walled boards + a seeded sweep. bfs_cast_cell's
// reference is the FULL scan (no early-exit), so identity here ALSO re-proves the diet's early-exit is result-
// preserving WITH walls (the diet test only covered open boards where cost == manhattan).
// ══════════════════════════════════════════════════════════════════════════════════════════════════════════════

// Local mirrors of combat_grid's SSOT stride/bounds (guarded == grid_cells() in the test below).
const TGRID_W: u64 = 20;
const TGRID_H: u64 = 19;

/// The 4-connected in-grid neighbours of `c` in the EXACT production order (x-1, x+1, y-1, y+1).
#[test_only]
fun ref_neighbors(c: u64): vector<u64> {
  let x = c % TGRID_W;
  let y = c / TGRID_W;
  let mut nbrs = vector<u64>[];
  if (x > 0) nbrs.push_back(c - 1);
  if (x + 1 < TGRID_W) nbrs.push_back(c + 1);
  if (y > 0) nbrs.push_back(c - TGRID_W);
  if (y + 1 < TGRID_H) nbrs.push_back(c + TGRID_W);
  nbrs
}

/// REFERENCE `bfs_path_cost` — verbatim OLD algorithm over a cell-list `blocked` + vector<bool> `visited`.
#[test_only]
fun ref_path_cost(start: u64, target: u64, blocked: &vector<u64>, max_steps: u64): u64 {
  let cells = combat_grid::grid_cells();
  if (start == target) return 0;
  if (!combat_grid::in_grid(start) || !combat_grid::in_grid(target) || blocked.contains(&target)) return cells;
  let mut visited = vector<bool>[];
  let mut i = 0;
  while (i < cells) { visited.push_back(false); i = i + 1; };
  *visited.borrow_mut(start) = true;
  let mut frontier = vector<u64>[start];
  let mut steps = 0;
  while (steps < max_steps && !frontier.is_empty()) {
    steps = steps + 1;
    let mut next = vector<u64>[];
    let mut j = 0;
    let fl = frontier.length();
    while (j < fl) {
      let nbrs = ref_neighbors(*frontier.borrow(j));
      let mut k = 0;
      while (k < nbrs.length()) {
        let n = *nbrs.borrow(k);
        if (!*visited.borrow(n) && !blocked.contains(&n)) {
          if (n == target) return steps;
          *visited.borrow_mut(n) = true;
          next.push_back(n);
        };
        k = k + 1;
      };
      j = j + 1;
    };
    frontier = next;
  };
  cells
}

/// REFERENCE `bfs_best_toward` — verbatim OLD algorithm (cell-list + vector<bool>).
#[test_only]
fun ref_best_toward(start: u64, target: u64, blocked: &vector<u64>, budget: u64): u64 {
  if (!combat_grid::in_grid(start)) return start;
  let cells = combat_grid::grid_cells();
  let mut best = start;
  let mut best_dist = combat_grid::manhattan(start, target);
  let mut best_cost = 0;
  let mut visited = vector<bool>[];
  let mut i = 0;
  while (i < cells) { visited.push_back(false); i = i + 1; };
  *visited.borrow_mut(start) = true;
  let mut frontier = vector<u64>[start];
  let mut cost = 0;
  while (cost < budget && !frontier.is_empty()) {
    cost = cost + 1;
    let mut next = vector<u64>[];
    let mut j = 0;
    let fl = frontier.length();
    while (j < fl) {
      let nbrs = ref_neighbors(*frontier.borrow(j));
      let mut k = 0;
      while (k < nbrs.length()) {
        let n = *nbrs.borrow(k);
        if (!*visited.borrow(n) && !blocked.contains(&n)) {
          *visited.borrow_mut(n) = true;
          next.push_back(n);
          if (n != target) {
            let d = combat_grid::manhattan(n, target);
            if (d < best_dist || (d == best_dist && cost < best_cost) || (d == best_dist && cost == best_cost && n < best)) {
              best = n; best_dist = d; best_cost = cost;
            };
          };
        };
        k = k + 1;
      };
      j = j + 1;
    };
    frontier = next;
  };
  best
}

#[test_only]
fun ref_can_cast(from: u64, target: u64, rmin: u64, rmax: u64, needs_los: bool, los: &vector<u64>): bool {
  let d = combat_grid::manhattan(from, target);
  d >= rmin && d <= rmax && (!needs_los || combat_grid::line_of_sight(from, target, los))
}

/// REFERENCE `bfs_cast_cell` — verbatim OLD algorithm, FULL scan (NO early-exit): a stronger oracle that also
/// re-proves the production early-exit is result-preserving with walls present. (`_walls` distinguishes it from
/// the diet's open-board `ref_cast_cell` above.)
#[test_only]
fun ref_cast_cell_walls(start: u64, target: u64, blocked: &vector<u64>, budget: u64, rmin: u64, rmax: u64, needs_los: bool, los: &vector<u64>): Option<u64> {
  if (!combat_grid::in_grid(start)) return option::none();
  let cells = combat_grid::grid_cells();
  let mut best = start;
  let mut found = false;
  let mut best_cost = 0;
  let mut best_dist = 0;
  if (ref_can_cast(start, target, rmin, rmax, needs_los, los)) { found = true; best_dist = combat_grid::manhattan(start, target); };
  let mut visited = vector<bool>[];
  let mut i = 0;
  while (i < cells) { visited.push_back(false); i = i + 1; };
  *visited.borrow_mut(start) = true;
  let mut frontier = vector<u64>[start];
  let mut cost = 0;
  while (cost < budget && !frontier.is_empty()) {
    cost = cost + 1;
    let mut next = vector<u64>[];
    let mut j = 0;
    let fl = frontier.length();
    while (j < fl) {
      let nbrs = ref_neighbors(*frontier.borrow(j));
      let mut k = 0;
      while (k < nbrs.length()) {
        let n = *nbrs.borrow(k);
        if (!*visited.borrow(n) && !blocked.contains(&n)) {
          *visited.borrow_mut(n) = true;
          next.push_back(n);
          if (ref_can_cast(n, target, rmin, rmax, needs_los, los)) {
            let d = combat_grid::manhattan(n, target);
            if (!found || cost < best_cost || (cost == best_cost && d < best_dist) || (cost == best_cost && d == best_dist && n < best)) {
              best = n; found = true; best_cost = cost; best_dist = d;
            };
          };
        };
        k = k + 1;
      };
      j = j + 1;
    };
    frontier = next;
  };
  if (found) option::some(best) else option::none()
}

/// All three production (mask) BFS fns == their cell-list references for one board/query. `los` stays a cell LIST
/// (line_of_sight iterates it — gas-diet #1 leaves LOS unchanged).
#[test_only]
fun assert_bfs_identity(start: u64, target: u64, blocked: &vector<u64>, budget: u64, rmin: u64, rmax: u64, needs_los: bool, los: &vector<u64>, code: u64) {
  let mask = combat_grid::mask_from_cells(blocked);
  assert!(combat_grid::bfs_path_cost(start, target, &mask, budget) == ref_path_cost(start, target, blocked, budget), code);
  assert!(combat_grid::bfs_best_toward(start, target, &mask, budget) == ref_best_toward(start, target, blocked, budget), code + 1);
  assert!(combat_grid::bfs_cast_cell(start, target, &mask, budget, rmin, rmax, needs_los, los) == ref_cast_cell_walls(start, target, blocked, budget, rmin, rmax, needs_los, los), code + 2);
}

// ── the wall bitset faithfully mirrors cell-list membership (the atom the whole change rests on) ────────────────
#[test]
fun mask_membership_matches_cell_list() {
  assert!(combat_grid::grid_cells() == TGRID_W * TGRID_H, 0); // local dims mirror the SSOT
  let cells = combat_grid::grid_cells();
  // a spread of crafted cell lists (incl. duplicates + an out-of-board cell — both must be tolerated like `.contains`).
  let lists = vector[
    vector<u64>[],
    vector[combat_grid::encode(0, 0)],
    vector[combat_grid::encode(6, 5), combat_grid::encode(6, 5), combat_grid::encode(19, 18)], // dup + far corner
    vector[combat_grid::encode(1, 1), combat_grid::encode(10, 9), combat_grid::encode(15, 12), 999], // 999 = out of board
  ];
  let mut li = 0;
  while (li < lists.length()) {
    let list = lists.borrow(li);
    let mask = combat_grid::mask_from_cells(list);
    let mut c = 0;
    while (c < cells) {
      assert!(combat_grid::mask_get(&mask, c) == list.contains(&c), 100 + li * 400 + c);
      c = c + 1;
    };
    li = li + 1;
  };
}

#[test]
fun bfs_mask_matches_cell_list_reference_on_crafted_boards() {
  assert!(combat_grid::grid_cells() == TGRID_W * TGRID_H, 0);

  // Board 1 — a vertical wall x=6 (rows 0..14) with a GAP at (6,7): the BFS must detour through the gap.
  let mut b1 = vector<u64>[];
  let mut y = 0;
  while (y < 15) { if (y != 7) b1.push_back(combat_grid::encode(6, y)); y = y + 1; };
  assert_bfs_identity(combat_grid::encode(2, 7), combat_grid::encode(12, 7), &b1, 30, 1, 1, false, &vector[], 1_000);
  assert_bfs_identity(combat_grid::encode(2, 3), combat_grid::encode(10, 3), &b1, 30, 2, 4, true, &b1, 1_100);

  // Board 2 — an L-shaped wall boxing a pocket around (3,3).
  let b2 = vector[combat_grid::encode(4,1), combat_grid::encode(4,2), combat_grid::encode(4,3), combat_grid::encode(4,4), combat_grid::encode(0,4), combat_grid::encode(1,4), combat_grid::encode(2,4), combat_grid::encode(3,4)];
  assert_bfs_identity(combat_grid::encode(1, 1), combat_grid::encode(10, 10), &b2, 40, 1, 6, false, &vector[], 2_000);
  assert_bfs_identity(combat_grid::encode(3, 3), combat_grid::encode(8, 8), &b2, 40, 1, 1, false, &vector[], 2_100);

  // Board 3 — scattered obstacles, LOS-required cast (the obstacles double as sight blockers).
  let b3 = vector[combat_grid::encode(1,5), combat_grid::encode(3,5), combat_grid::encode(2,4), combat_grid::encode(7,7), combat_grid::encode(9,2), combat_grid::encode(12,12)];
  assert_bfs_identity(combat_grid::encode(2, 5), combat_grid::encode(15, 12), &b3, 40, 1, 3, true, &b3, 3_000);

  // Board 4 — the target's own cell walled off (unreachable path + no cast cell can stand on it).
  let b4 = vector[combat_grid::encode(9,9), combat_grid::encode(11,9), combat_grid::encode(10,8), combat_grid::encode(10,10)];
  assert_bfs_identity(combat_grid::encode(2, 2), combat_grid::encode(10, 9), &b4, 40, 1, 1, false, &vector[], 4_000);

  // Board 5 — a horizontal corridor: walls on rows 4 and 6 across x∈[3,16], funnelling through row 5.
  let mut b5 = vector<u64>[];
  let mut x = 3;
  while (x < 17) { b5.push_back(combat_grid::encode(x, 4)); b5.push_back(combat_grid::encode(x, 6)); x = x + 1; };
  assert_bfs_identity(combat_grid::encode(4, 5), combat_grid::encode(15, 5), &b5, 40, 1, 1, false, &vector[], 5_000);
  assert_bfs_identity(combat_grid::encode(4, 5), combat_grid::encode(15, 5), &b5, 40, 3, 5, true, &b5, 5_100);
}

#[test]
fun bfs_mask_matches_reference_seeded_sweep() {
  let cells = combat_grid::grid_cells();
  let mut seed = prng::rng_seed(0x5eed);
  let mut iter = 0;
  while (iter < 48) {
    // ~8 pseudo-random walls, then random start/target/budget (prng::draw is overflow-safe, unlike a raw LCG).
    let mut blocked = vector<u64>[];
    let mut b = 0u64;
    while (b < 8) { blocked.push_back(prng::draw(&mut seed) % cells); b = b + 1; };
    let start = prng::draw(&mut seed) % cells;
    let target = prng::draw(&mut seed) % cells;
    let budget = 2 + prng::draw(&mut seed) % 10; // 2..11
    let needs_los = (prng::draw(&mut seed) % 2) == 0;
    assert_bfs_identity(start, target, &blocked, budget, 1, 4, needs_los, &blocked, 10_000 + iter * 3);
    iter = iter + 1;
  };
}
