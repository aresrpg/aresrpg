/// BOARD — deterministic fight-board derivation. THE canonical generator: `(world_seed, anchor) -> board
/// layout`, byte-identical to the harvested `aresrpg::dungeon_grid` draw sequence (the frontend/engine twin
/// aligns to THIS; the dungeon reuses it per-room). PURE — seed only, no time / IO / stored roll (§7 "nothing
/// about a board is stored or randomly rolled at fight time"). `combat_grid` (foundation) owns the shape
/// geometry; this module owns the DRAW ORDER, which IS the cross-language contract.
///
/// ┌─ THE DERIVATION (document precisely — the engine twin mirrors every step) ─────────────────────────────┐
/// │ 1. board_seed = `board_seed_from_anchor(world_seed, anchor_x, anchor_z)`:                                │
/// │      mixed = (world_seed & MASK32) XOR (anchor_x·PRIME_X & MASK32) XOR (anchor_z·PRIME_Z & MASK32), &M32 │
/// │      → prng::rng_seed(mixed).  (world fights call generate(board_seed, 0); dungeons pass the room index) │
/// │ 2. `variant` de-correlates a reuse index: mixed2 = (variant+1)·ROOM_MIX & M32; s = rng_seed(seed ^ m2).  │
/// │ 3. width  = rng_range(MIN_W, MAX_W);  height = rng_range(MIN_H, MAX_H).                                  │
/// │ 4. shape  = vocab[rng_int(N_SHAPES)] (BLOB/ROUNDED/ELLIPSE/CROSS) → build_shape draws its params IN ORDER.│
/// │ 5. blockers: obstacles first (rng_range(OBS_MIN,OBS_MAX) count), then holes (which see the obstacles) —  │
/// │    king-isolated, bounded-probe, connectivity-safe by construction (combat_grid::blocker_placeable).     │
/// │ 6. start cells: 6/side, on-mask, unblocked, in OPPOSITE bands (A near / B far). Explicit + returned.     │
/// └────────────────────────────────────────────────────────────────────────────────────────────────────────┘
/// NEVER reorder / insert / remove a draw without mirroring it in the JS twin.
module aresrpg_foundation::board;

use aresrpg_foundation::{combat_grid, prng};

const MASK32: u64 = 0xFFFFFFFF;

const MIN_W: u64 = 7;
const MAX_W: u64 = 17;
const MIN_H: u64 = 7;
const MAX_H: u64 = 19;
const MAX_SEATS: u64 = 6; // §17.8 team cap — one start cell per potential seat, per side
const OBS_MIN: u64 = 2;
const OBS_MAX: u64 = 6;
const HOLE_MIN: u64 = 1;
const HOLE_MAX: u64 = 4;
const N_SHAPES: u64 = 4; // BLOB / ROUNDED / ELLIPSE / CROSS
const ROOM_MIX: u64 = 0x9E3779B1; // golden-ratio odd constant — de-correlates a reuse variant before seeding
const PRIME_X: u64 = 0x85EBCA77; // anchor-x fold prime (odd)
const PRIME_Z: u64 = 0xC2B2AE3D; // anchor-z fold prime (odd)

/// The generated board layout — private fields, read via the getters (single source of the layout's shape). No
/// `store`: a layout is always recomputed from the seed, never persisted (the Fight stores its own copies).
public struct GridSpec has copy, drop {
  width: u64,
  height: u64,
  shape_mask: vector<u64>,
  obstacles: vector<u64>,
  holes: vector<u64>,
  start_cells_a: vector<u64>,
  start_cells_b: vector<u64>,
}

public fun grid_width(g: &GridSpec): u64 { g.width }
public fun grid_height(g: &GridSpec): u64 { g.height }
public fun shape_mask(g: &GridSpec): vector<u64> { g.shape_mask }
public fun obstacles(g: &GridSpec): vector<u64> { g.obstacles }
public fun holes(g: &GridSpec): vector<u64> { g.holes }
public fun start_cells_a(g: &GridSpec): vector<u64> { g.start_cells_a }
public fun start_cells_b(g: &GridSpec): vector<u64> { g.start_cells_b }

/// Fold (world_seed, anchor_x, anchor_z) into a u32 board seed — step 1 above. Documented so the engine twin
/// derives the identical board for any world mob-group anchor.
public fun board_seed_from_anchor(world_seed: u64, anchor_x: u32, anchor_z: u32): u64 {
  ((world_seed & MASK32) ^ (((anchor_x as u64) * PRIME_X) & MASK32) ^ (((anchor_z as u64) * PRIME_Z) & MASK32)) & MASK32
}

/// Deterministically generate a fight board from `(board_seed, variant)`. World fights pass `variant = 0`; the
/// dungeon passes its room index when it reuses this generator. PURE.
public fun generate(board_seed: u64, variant: u64): GridSpec {
  let mixed = ((variant + 1) * ROOM_MIX) & MASK32;
  let mut s = prng::rng_seed((board_seed & MASK32) ^ mixed);

  let width = { let (ns, v) = prng::rng_range(s, MIN_W, MAX_W); s = ns; v };
  let height = { let (ns, v) = prng::rng_range(s, MIN_H, MAX_H); s = ns; v };

  let vocab = vector[combat_grid::shape_blob(), combat_grid::shape_rounded(), combat_grid::shape_ellipse(), combat_grid::shape_cross()];
  let shape_code = { let (ns, v) = prng::rng_int(s, N_SHAPES); s = ns; *vocab.borrow(v) };
  let (ns, mask) = build_shape(s, shape_code, width, height);
  s = ns;

  let candidates = placeable_candidates(&mask);
  let obs_count = { let (ns2, v) = prng::rng_range(s, OBS_MIN, OBS_MAX); s = ns2; v };
  let mut obstacles = vector[];
  s = place_blockers(s, &mask, &candidates, &mut obstacles, obs_count);

  let hole_count = { let (ns2, v) = prng::rng_range(s, HOLE_MIN, HOLE_MAX); s = ns2; v };
  let mut holes = obstacles;
  place_blockers(s, &mask, &candidates, &mut holes, hole_count); // final PRNG state intentionally unused
  let holes = tail_after(&holes, obstacles.length());

  let mut blocked = obstacles;
  blocked.append(holes);
  let pool = open_cells(&mask, &blocked);
  let start_cells_a = pick_starts(&pool, MAX_SEATS, true, &vector[]);
  let start_cells_b = pick_starts(&pool, MAX_SEATS, false, &start_cells_a);

  GridSpec { width, height, shape_mask: mask, obstacles, holes, start_cells_a, start_cells_b }
}

/// Convenience: derive a world fight board straight from (world_seed, anchor) — the seam `fight::create` uses.
public fun generate_for_anchor(world_seed: u64, anchor_x: u32, anchor_z: u32): GridSpec {
  generate(board_seed_from_anchor(world_seed, anchor_x, anchor_z), 0)
}

// ╔════════════════ [ Internals — verbatim from dungeon_grid (the frozen draw contract) ] ═ ]

fun build_shape(mut s: u64, shape_code: u8, width: u64, height: u64): (u64, vector<u64>) {
  if (shape_code == combat_grid::shape_rect()) {
    (s, combat_grid::rect_mask(width, height))
  } else if (shape_code == combat_grid::shape_ellipse()) {
    (s, combat_grid::ellipse_mask(width, height))
  } else if (shape_code == combat_grid::shape_rounded()) {
    let cap = min_u64(width, height) / 3;
    let r = { let (ns, v) = prng::rng_range(s, 1, cap); s = ns; v };
    (s, combat_grid::rounded_mask(width, height, r))
  } else if (shape_code == combat_grid::shape_cross()) {
    let bar_h = { let (ns, v) = prng::rng_range(s, 3, height); s = ns; v };
    let bar_w = { let (ns, v) = prng::rng_range(s, 3, width); s = ns; v };
    let ry0 = (height - bar_h) / 2;
    let cx0 = (width - bar_w) / 2;
    (s, combat_grid::cross_mask(width, height, ry0, ry0 + bar_h, cx0, cx0 + bar_w))
  } else {
    let cap = min_u64(width, height) / 3;
    let r_tl = { let (ns, v) = prng::rng_range(s, 1, cap); s = ns; v };
    let r_tr = { let (ns, v) = prng::rng_range(s, 1, cap); s = ns; v };
    let r_bl = { let (ns, v) = prng::rng_range(s, 1, cap); s = ns; v };
    let r_br = { let (ns, v) = prng::rng_range(s, 1, cap); s = ns; v };
    (s, combat_grid::blob_mask(width, height, r_tl, r_tr, r_bl, r_br))
  }
}

fun min_u64(a: u64, b: u64): u64 { if (a < b) a else b }

fun placeable_candidates(mask: &vector<u64>): vector<u64> {
  let mut out = vector[];
  let empty = vector<u64>[];
  let mut c = 0;
  let n = combat_grid::grid_cells();
  while (c < n) {
    if (combat_grid::blocker_placeable(mask, &empty, c)) out.push_back(c);
    c = c + 1;
  };
  out
}

fun place_blockers(mut s: u64, mask: &vector<u64>, candidates: &vector<u64>, out: &mut vector<u64>, count: u64): u64 {
  let len = candidates.length();
  if (len == 0) return s;
  let mut placed = 0;
  while (placed < count) {
    let idx0 = { let (ns, v) = prng::rng_int(s, len); s = ns; v };
    let mut j = 0;
    let mut took = false;
    while (j < len) {
      let cand = *candidates.borrow((idx0 + j) % len);
      if (!out.contains(&cand) && combat_grid::blocker_placeable(mask, out, cand)) {
        out.push_back(cand);
        took = true;
        break
      };
      j = j + 1;
    };
    if (!took) break;
    placed = placed + 1;
  };
  s
}

fun open_cells(mask: &vector<u64>, blocked: &vector<u64>): vector<u64> {
  let mut out = vector[];
  let mut c = 0;
  let n = combat_grid::grid_cells();
  while (c < n) {
    if (combat_grid::mask_get(mask, c) && !blocked.contains(&c)) out.push_back(c);
    c = c + 1;
  };
  out
}

fun pick_starts(pool: &vector<u64>, count: u64, from_top: bool, used: &vector<u64>): vector<u64> {
  let mut out = vector[];
  let n = pool.length();
  let mut k = 0;
  while (k < n && out.length() < count) {
    let idx = if (from_top) k else n - 1 - k;
    let cell = *pool.borrow(idx);
    if (!used.contains(&cell) && !out.contains(&cell)) out.push_back(cell);
    k = k + 1;
  };
  out
}

fun tail_after(v: &vector<u64>, from: u64): vector<u64> {
  let mut out = vector[];
  let n = v.length();
  let mut i = from;
  while (i < n) { out.push_back(*v.borrow(i)); i = i + 1; };
  out
}
