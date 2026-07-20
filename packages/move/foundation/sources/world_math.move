// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// WORLD MATH — the overworld's pure kernels (S-70 size split, moved VERBATIM from core `checkpoint`/`zones`):
/// travel-budget plausibility (§17.3 speed-budget law), the join spawn roll, and the §4 distance-difficulty
/// curve. Pure transforms over plain scalars — zero objects, zero events, zero state (quarantine law). Core
/// keeps the `Checkpoint`/`World`/`Zone` shapes and delegates the math here; the SEED-DERIVED zone composition
/// kernel (search-cost rework) lives in the sibling `zone_gen` module.
module aresrpg_foundation::world_math;

use sui::random::{Self, RandomGenerator};

// ── Overflow-guard + mount constants (travel law) ──
const MAX_LINEAR: u64 = 4_000_000; // a budget that dwarfs any in-world distance short-circuits (no squaring)
const BIG_MS: u64 = 10_000_000_000_000; // pathological elapsed saturates the budget instead of overflowing
const SPEED_SCALE: u64 = 100_000; // speed_budget is blocks/sec ×100; ÷100 (fixed-point) then ÷1000 (ms→s)
const PET_NUM: u64 = 3; // ×1.5 mount budget = ×3/2 (both ends equipped)
const PET_DEN: u64 = 2;

// ╔════════════════ [ Travel plausibility (§17.3) ] ═══════════════════════════ ]

/// `true` iff traveling `(from) → (to)` by `now_ms` is physically coverable at `speed_budget` (blocks/sec ×100),
/// ×1.5 when `pet_both`. Exact squared-distance compare (consensus path — no sqrt).
public fun travel_ok(speed_budget: u64, from_x: u32, from_z: u32, from_ms: u64, to_x: u32, to_z: u32, now_ms: u64, pet_both: bool): bool {
  if (now_ms < from_ms) return false;
  let budget = budget_blocks(speed_budget, now_ms - from_ms, pet_both);
  if (budget >= MAX_LINEAR) return true; // dwarfs any in-world distance — accept without squaring (overflow guard)
  let dx = abs_diff(to_x, from_x);
  let dz = abs_diff(to_z, from_z);
  budget * budget >= dx * dx + dz * dz
}

/// How many MORE seconds until the move becomes legal (0 if already legal) — the "wait Ns" UI number. Integer
/// sqrt (NON-consensus — the abort path stays exact via `travel_ok`), so it may be off by <1 block.
public fun wait_seconds(speed_budget: u64, from_x: u32, from_z: u32, from_ms: u64, to_x: u32, to_z: u32, now_ms: u64, pet_both: bool): u64 {
  let dx = abs_diff(to_x, from_x);
  let dz = abs_diff(to_z, from_z);
  let dist = isqrt(dx * dx + dz * dz); // blocks
  let eff = if (pet_both) speed_budget / PET_DEN * PET_NUM else speed_budget; // ×100 (caller clamps speed ≥ 1)
  let need = dist * 100 / eff; // seconds = dist / (eff/100)
  let elapsed_s = if (now_ms >= from_ms) (now_ms - from_ms) / 1000 else 0;
  if (need > elapsed_s) need - elapsed_s else 0
}

/// Max coverable distance (blocks) in `elapsed_ms` at `speed_budget` (×100 fixed-point), ×1.5 when `pet_both`.
/// Saturates for pathological elapsed so the product never overflows (`BIG_MS`).
fun budget_blocks(speed_budget: u64, elapsed_ms: u64, pet_both: bool): u64 {
  let raw = if (elapsed_ms >= BIG_MS) MAX_LINEAR else speed_budget * elapsed_ms / SPEED_SCALE;
  if (pet_both) raw / PET_DEN * PET_NUM else raw
}

public(package) fun abs_diff(a: u32, b: u32): u64 {
  if (a >= b) ((a - b) as u64) else ((b - a) as u64)
}

/// Integer square root (Newton). Used only by the non-consensus `wait_seconds`.
fun isqrt(n: u64): u64 {
  if (n < 2) return n;
  let mut x = n;
  let mut y = (x + 1) / 2;
  while (y < x) {
    x = y;
    y = (x + n / x) / 2;
  };
  x
}

// ╔════════════════ [ Zone spawn rolls (the &Random helpers the JOIN roll still uses) ] ═ ]
// (pick_weighted / roll_u64 / roll_pos / grow_cluster RETIRED with the search-cost rework — the seed-derived
// twins live in `zone_gen.move`; `search_zone` no longer rolls spawns with `&Random`, it draws ONE seed.)

public fun roll_u32(gen: &mut RandomGenerator, lo: u32, hi: u32): u32 {
  if (lo >= hi) lo else random::generate_u32_in_range(gen, lo, hi)
}

/// Clamp a rolled group size to the live engine bound (≤ 6) with a floor of 1, as the zone-table u16.
public fun clamp_group_u16(v: u64, bound: u64): u16 {
  let capped = if (v > bound) bound else v;
  (if (capped < 1) 1 else capped) as u16
}

// ╔════════════════ [ Distance-difficulty curve (§4 overworld difficulty ramp — wave-2b) ] ═ ]
// The overworld's RADIAL difficulty ramp: a zone's Euclidean block distance from the world SPAWN ANCHOR (the
// bounds/2 first-join centre, §4) raises BOTH the eligible mob LEVEL cap and the GROUP-SIZE cap. Pure integer
// fixed-point (PROGRESS_SCALE = 1000), deterministic, zero floats. `progress` is a PIECEWISE-LINEAR fit through
// three world-1 anchors (≤250 blocks → cap 2 · ~1000 → cap 10 · ~5000 → roster max), held in
// NORMALISED roster space so the ONE curve maps onto ANY world's own [roster_min, roster_max] band (a high world
// ramps its 179→198 band on the identical shape). Distance is 2D (§17.3 law: the world is walked, not flown).
const PROGRESS_SCALE: u64 = 1000; // fixed-point unit — `progress` ∈ [0, 1000]
const DIST_EDGE: u64 = 5000; // the world's difficulty range caps around 5000 blocks — progress saturates here
const DIST_A1: u64 = 250; // anchor 1: ≤250 blocks → world-1 cap 2 (trivial groups)
const DIST_A2: u64 = 1000; // anchor 2: ~1000 blocks → world-1 cap 10
const PROG_A1: u64 = 91; // normalised progress at 250 blocks — fits world-1 cap 2  = 1 + round(11·91/1000)
const PROG_A2: u64 = 818; // normalised progress at 1000 blocks — fits world-1 cap 10 = 1 + round(11·818/1000)
const NEAR_GROUP_CAP: u64 = 2; // mob groups near the spawn are capped at 1-2 — the group-size cap floor

/// Normalised difficulty PROGRESS ∈ [0, 1000] for a zone whose representative point is `(ax, az)`, measured from
/// the spawn anchor `(bx, bz)` (= bounds/2). Piecewise-linear in Euclidean block distance through the
/// anchors; saturates at `DIST_EDGE`. A squared-distance early-out skips `isqrt` for the far (common) case AND is
/// the overflow guard: a bounds ≤ 2_000_000 world has deltas ≤ 2e6, so dx²+dz² ≤ 8e12 ≪ u64 max (1.8e19).
public fun distance_progress(ax: u32, az: u32, bx: u32, bz: u32): u64 {
  let dx = abs_diff(ax, bx);
  let dz = abs_diff(az, bz);
  let d2 = dx * dx + dz * dz;
  if (d2 >= DIST_EDGE * DIST_EDGE) return PROGRESS_SCALE; // at/beyond the edge → full difficulty (no isqrt)
  let d = isqrt(d2); // blocks; d < DIST_EDGE here
  if (d <= DIST_A1) {
    d * PROG_A1 / DIST_A1
  } else if (d <= DIST_A2) {
    PROG_A1 + (d - DIST_A1) * (PROG_A2 - PROG_A1) / (DIST_A2 - DIST_A1)
  } else {
    PROG_A2 + (d - DIST_A2) * (PROGRESS_SCALE - PROG_A2) / (DIST_EDGE - DIST_A2)
  }
}

/// The mob-LEVEL cap at `progress`: `roster_min` lerped to `roster_max` (round-to-nearest). A zone at the spawn
/// (progress 0) admits only the roster floor; the edge (progress 1000) admits the whole roster. NEVER divides by
/// the roster span, so a single-level roster (min == max) is safe (the lerp term is just 0). Result ∈ [min, max].
public fun level_cap(progress: u64, roster_min: u16, roster_max: u16): u16 {
  if (roster_max <= roster_min) return roster_min;
  let span = (roster_max - roster_min) as u64;
  let add = (span * progress + PROGRESS_SCALE / 2) / PROGRESS_SCALE; // round-to-nearest ∈ [0, span]
  (roster_min as u64 + add) as u16
}

/// The GROUP-SIZE cap at `progress`: `NEAR_GROUP_CAP` (2) near the spawn, lerped to the live engine `team_bound`
/// at the edge (round-to-nearest). Underflow-guarded when `team_bound < NEAR_GROUP_CAP`. `zones` feeds this to
/// `clamp_group_u16` (which floors at 1), so distance caps pack size near the spawn without touching a mob's
/// authored band out past the edge.
public fun size_cap(progress: u64, team_bound: u64): u64 {
  let near = if (team_bound < NEAR_GROUP_CAP) team_bound else NEAR_GROUP_CAP;
  let span = team_bound - near; // ≥ 0 by the guard above
  near + (span * progress + PROGRESS_SCALE / 2) / PROGRESS_SCALE
}

/// Roster level bounds over a parallel `levels` vector (each mob row's eligibility level; 0 = unauthored). Returns
/// `(min_authored, max)`: `max` is the plain maximum; `min_authored` is the smallest NON-ZERO level (an unauthored
/// straggler at 0 never drags the spawn floor to nothing), or 0 when nothing is authored — the DORMANT case where
/// every mob stays eligible everywhere (the pre-wave-2b behaviour). Whenever any level exists the returned `min` is
/// a REAL roster level, so `level_cap(_, min, _)` always admits at least that mob and a zone is never emptied.
public fun roster_bounds(levels: &vector<u16>): (u16, u16) {
  let n = levels.length();
  let mut max = 0u16;
  let mut min_auth = 0u16;
  let mut i = 0;
  while (i < n) {
    let lv = levels[i];
    if (lv > max) max = lv;
    if (lv > 0 && (min_auth == 0 || lv < min_auth)) min_auth = lv;
    i = i + 1;
  };
  (min_auth, max)
}
