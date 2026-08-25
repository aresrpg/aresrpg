// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// The fight-board GEOMETRY — pure, integer-only, Manhattan-metric everywhere (ruling
/// 2026-08-09: fights know no diagonal distance). Cell = y*GRID_W + x over a fixed 20×19
/// encoding stride; the playable region is a bitmask shape. Owns: cells, masks, BFS pathing,
/// the 1.29 shadow-casting line of sight (proven verdict-equivalent to the reference over
/// 166,983 triples), spell-zone enumeration, push/pull stepping, and `grid_spec` — the one
/// constructor authored boards enter through (boards are CONTENT since 2026-08-23: authored
/// offline, proven by the seed validator, published to the catalog, COPIED into each Fight).
/// The old on-chain generator survives as test-only fixture machinery; it never ships.
module aresrpg_math::combat_grid;

use aresrpg_math::{prng, spell_effect};

// ╔════════════════ [ The cell law ] ═════════════════════════════════════════ ]

const GRID_W: u64 = 20; // encoding STRIDE + max width — every reader (chain + client) shares it
const GRID_H: u64 = 19; // max rows
const GRID_CELLS: u64 = GRID_W * GRID_H; // 380 — cell-index bound + shape-mask bit count
const MASK_WORDS: u64 = (GRID_CELLS + 63) / 64; // 6 u64 words, one bit per cell, row-major

// Board-generation dials (owner 2026-08-09: more blockers than the old boards, multi-cell).
#[test_only]
const MIN_W: u64 = 7;
#[test_only]
const MAX_W: u64 = 17;
#[test_only]
const MIN_H: u64 = 7;
#[test_only]
const MAX_H: u64 = 19;
const START_CELLS: u64 = 6; // per side — the team cap, one start cell per fighter
#[test_only]
const OBS_MIN: u64 = 3;
#[test_only]
const OBS_MAX: u64 = 8;
#[test_only]
const HOLE_MIN: u64 = 2;
#[test_only]
const HOLE_MAX: u64 = 6;
#[test_only]
const BLOCKER_MAX_LEN: u64 = 3; // a blocker is a straight run of 1..3 cells
#[test_only]
const N_SHAPES: u64 = 4; // BLOB / ROUNDED / ELLIPSE / CROSS
#[test_only]
const VARIANT_MIX: u64 = 0x9E3779B1; // golden-ratio odd constant — de-correlates a reuse variant

// Board outline codes (internal generation vocabulary — distinct from spell zones).
#[test_only]
const SHAPE_ROUNDED: u8 = 1;
#[test_only]
const SHAPE_ELLIPSE: u8 = 2;
#[test_only]
const SHAPE_CROSS: u8 = 3;
#[test_only]
const SHAPE_BLOB: u8 = 4;

/// Direction codes: 0=+x · 1=-x · 2=+y · 3=-y · 255 = none.
const DIR_NONE: u8 = 255;

const EBadBoard: u64 = 1101; // grid_spec: an authored board violates the cheap sanity floor

fun abs_diff(a: u64, b: u64): u64 { if (a > b) a - b else b - a }

fun cell_x(cell: u64): u64 { cell % GRID_W }

fun cell_y(cell: u64): u64 { cell / GRID_W }

public fun encode(x: u64, y: u64): u64 { y * GRID_W + x }

public fun in_grid(cell: u64): bool { cell < GRID_CELLS }

public fun grid_cells(): u64 { GRID_CELLS }

/// MANHATTAN distance — THE fight metric (4-directional, no diagonals).
public fun manhattan(a: u64, b: u64): u64 {
  abs_diff(cell_x(a), cell_x(b)) + abs_diff(cell_y(a), cell_y(b))
}

/// Do two cells share a row or a column? The linearity gate (`line_launch` spells, the
/// line-only strikes).
public fun same_line(a: u64, b: u64): bool { cell_x(a) == cell_x(b) || cell_y(a) == cell_y(b) }

// ╔════════════════ [ Bitmasks — O(1) membership for walls and shapes ] ══════ ]

/// A fresh all-zero mask (MASK_WORDS words).
public fun empty_mask(): vector<u64> {
  let mut m = vector[];
  let mut i = 0;
  while (i < MASK_WORDS) { m.push_back(0); i = i + 1; };
  m
}

/// Set bit `cell` (row-major). Out-of-board is a defensive no-op.
public fun mask_set(mask: &mut vector<u64>, cell: u64) {
  if (cell >= GRID_CELLS) return;
  let w = cell / 64;
  let cur = mask[w];
  *&mut mask[w] = cur | (1u64 << ((cell % 64) as u8));
}

/// Set every cell of a plain cell list into `mask` — the list → bitset bridge wall builders use.
public fun mask_add_cells(mask: &mut vector<u64>, cells: &vector<u64>) {
  let n = cells.length();
  let mut i = 0;
  while (i < n) { mask_set(mask, cells[i]); i = i + 1; };
}

/// A fresh mask holding exactly `cells` — membership then costs one shift+and.
public fun mask_from_cells(cells: &vector<u64>): vector<u64> {
  let mut m = empty_mask();
  mask_add_cells(&mut m, cells);
  m
}

/// Is bit `cell` set? `false` for out-of-board cells and short masks.
public fun mask_get(mask: &vector<u64>, cell: u64): bool {
  if (cell >= GRID_CELLS) return false;
  let w = cell / 64;
  if (w >= mask.length()) return false;
  (mask[w] >> ((cell % 64) as u8)) & 1 == 1
}

/// Does `path` describe an exact walk from `start` within `max_steps`? The caller chooses
/// every orthogonal step; this validates that choice without replacing it with a BFS tie-break.
public fun path_is_walkable(start: u64, path: &vector<u64>, wall_mask: &vector<u64>, max_steps: u64): bool {
  if (!in_grid(start) || path.length() > max_steps) return false;
  let mut previous = start;
  let mut i = 0;
  while (i < path.length()) {
    let cell = path[i];
    if (!in_grid(cell) || mask_get(wall_mask, cell) || manhattan(previous, cell) != 1) return false;
    previous = cell;
    i = i + 1;
  };
  true
}

// ╔════════════════ [ BFS — pathing over a wall bitset ] ═════════════════════ ]

/// The 4-connected shortest-path STEP COUNT from `start` to `target` around `wall_mask`
/// (obstacles ∪ holes ∪ off-shape ∪ bodies). Exactly the MP cost when reachable within
/// `max_steps`, else `path_unreachable()`.
public fun bfs_path_cost(start: u64, target: u64, wall_mask: &vector<u64>, max_steps: u64): u64 {
  if (start == target) return 0;
  if (!in_grid(start) || !in_grid(target) || mask_get(wall_mask, target)) return GRID_CELLS;
  let mut visited = empty_mask();
  mask_set(&mut visited, start);
  let mut frontier = vector[start];
  let mut steps = 0;
  while (steps < max_steps && !frontier.is_empty()) {
    steps = steps + 1;
    let mut next = vector[];
    let mut j = 0;
    let fl = frontier.length();
    while (j < fl) {
      let nbrs = neighbours(frontier[j]);
      let mut k = 0;
      while (k < nbrs.length()) {
        let n = nbrs[k];
        if (!mask_get(&visited, n) && !mask_get(wall_mask, n)) {
          if (n == target) return steps;
          mask_set(&mut visited, n);
          next.push_back(n);
        };
        k = k + 1;
      };
      j = j + 1;
    };
    frontier = next;
  };
  GRID_CELLS
}

/// The DISTANCE FIELD to `target`: one flood fill answering `bfs_path_cost(cell, target, …)`
/// for every cell at once (the movement walker reads it ~25 times per move). Walls and
/// unreached cells read `path_unreachable()`.
public fun bfs_distance_field(target: u64, wall_mask: &vector<u64>, max_steps: u64): vector<u64> {
  let mut field = vector[];
  let mut i = 0;
  while (i < GRID_CELLS) { field.push_back(GRID_CELLS); i = i + 1; };
  if (!in_grid(target) || mask_get(wall_mask, target)) return field;

  *&mut field[target] = 0;
  let mut frontier = vector[target];
  let mut steps = 0;
  while (steps < max_steps && !frontier.is_empty()) {
    steps = steps + 1;
    let mut next = vector[];
    let mut j = 0;
    while (j < frontier.length()) {
      let nbrs = neighbours(frontier[j]);
      let mut k = 0;
      while (k < nbrs.length()) {
        let n = nbrs[k];
        if (field[n] == GRID_CELLS && !mask_get(wall_mask, n)) {
          *&mut field[n] = steps;
          next.push_back(n);
        };
        k = k + 1;
      };
      j = j + 1;
    };
    frontier = next;
  };
  field
}

/// The sentinel `bfs_path_cost` returns when no path within budget exists.
public fun path_unreachable(): u64 { GRID_CELLS }

/// The APPROACH FIELD to `target`: distances to the nearest of the target's open flanks
/// (its in-grid, unwalled neighbours — the target's own cell is usually a body and thus a
/// wall). One flood answers "which way around" for the whole board, so a rusher just walks
/// DOWN it; the flood stops early once `until` (the rusher's cell) is assigned. A sealed
/// target has no open flank — everything reads `path_unreachable()` and the rusher holds.
public fun approach_field(target: u64, wall_mask: &vector<u64>, until: u64): vector<u64> {
  let mut field = vector[];
  let mut i = 0;
  while (i < GRID_CELLS) { field.push_back(GRID_CELLS); i = i + 1; };
  let flanks = neighbours(target);
  let mut frontier = vector[];
  let mut j = 0;
  while (j < flanks.length()) {
    let f = flanks[j];
    if (!mask_get(wall_mask, f)) {
      *&mut field[f] = 0;
      frontier.push_back(f);
    };
    j = j + 1;
  };
  let mut steps = 0;
  while (!frontier.is_empty() && field[until] == GRID_CELLS) {
    steps = steps + 1;
    let mut next = vector[];
    let mut j = 0;
    while (j < frontier.length()) {
      let nbrs = neighbours(frontier[j]);
      let mut k = 0;
      while (k < nbrs.length()) {
        let n = nbrs[k];
        if (field[n] == GRID_CELLS && !mask_get(wall_mask, n)) {
          *&mut field[n] = steps;
          next.push_back(n);
        };
        k = k + 1;
      };
      j = j + 1;
    };
    frontier = next;
  };
  field
}

/// The cell a mob should stand on to CAST a `[range_min, range_max]` (LOS-aware) spell at
/// `target`, reached within `budget` steps: the closest-by-steps legal cast cell (cost, then
/// distance, then index). BFS is cost-ordered, so the first layer with a hit decides — the
/// scan early-exits result-preserving. `none` when no reachable cell can cast (caller rushes).
public fun bfs_cast_cell(
  start: u64,
  target: u64,
  wall_mask: &vector<u64>,
  budget: u64,
  range_min: u64,
  range_max: u64,
  needs_los: bool,
  los_obstacles: &vector<u64>,
): Option<u64> {
  if (!in_grid(start)) return option::none();
  let mut best = start;
  let mut found = false;
  let mut best_dist = 0;
  if (cell_can_cast(start, target, range_min, range_max, needs_los, los_obstacles)) {
    found = true;
    best_dist = manhattan(start, target);
  };
  let mut visited = empty_mask();
  mask_set(&mut visited, start);
  let mut frontier = vector[start];
  let mut cost = 0;
  while (cost < budget && !frontier.is_empty()) {
    if (found) break;
    cost = cost + 1;
    let mut next = vector[];
    let mut j = 0;
    let fl = frontier.length();
    while (j < fl) {
      let nbrs = neighbours(frontier[j]);
      let mut k = 0;
      while (k < nbrs.length()) {
        let n = nbrs[k];
        if (!mask_get(&visited, n) && !mask_get(wall_mask, n)) {
          mask_set(&mut visited, n);
          next.push_back(n);
          if (cell_can_cast(n, target, range_min, range_max, needs_los, los_obstacles)) {
            let d = manhattan(n, target);
            if (!found || d < best_dist || (d == best_dist && n < best)) {
              best = n;
              found = true;
              best_dist = d;
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

fun neighbours(c: u64): vector<u64> {
  let x = cell_x(c);
  let y = cell_y(c);
  let mut out = vector[];
  if (x > 0) out.push_back(c - 1);
  if (x + 1 < GRID_W) out.push_back(c + 1);
  if (y > 0) out.push_back(c - GRID_W);
  if (y + 1 < GRID_H) out.push_back(c + GRID_W);
  out
}

public fun first_free(starts: &vector<u64>, occupied: &vector<u64>): Option<u64> {
  let mut i = 0;
  while (i < starts.length()) {
    if (!occupied.contains(&starts[i])) return option::some(starts[i]);
    i = i + 1;
  };
  option::none()
}

fun cell_can_cast(from: u64, target: u64, range_min: u64, range_max: u64, needs_los: bool, los_obstacles: &vector<u64>): bool {
  let d = manhattan(from, target);
  d >= range_min && d <= range_max && (!needs_los || line_of_sight(from, target, los_obstacles))
}

// ╔════════════════ [ Line of sight — integer 1.29 reference shadow-casting ] ═ ]

/// True iff no obstacle occludes the sight line from `from` to `to`. Exact integer adaptation
/// of the 1.29 reference shadow-casting; every float slope compare is a cross-multiplication.
/// The client ports this SAME function 1:1 so the two sides can never diverge.
public fun line_of_sight(from: u64, to: u64, obstacles: &vector<u64>): bool {
  let n = obstacles.length();
  let mut i = 0;
  while (i < n) {
    if (blocks(from, obstacles[i], to)) return false;
    i = i + 1;
  };
  true
}

/// Does obstacle `b` occlude target `t` seen from origin `o`? The per-cell shadow-wedge test:
/// a target is shadowed iff its center slope falls inside the obstacle's half-cell wedge on
/// the obstacle's side of the origin, beyond the obstacle. Axis cases handled explicitly.
fun blocks(o: u64, b: u64, t: u64): bool {
  if (b == o || b == t) return false;
  let ox = cell_x(o);
  let oy = cell_y(o);
  let bx = cell_x(b);
  let by = cell_y(b);
  let ax = abs_diff(bx, ox);
  let ay = abs_diff(by, oy);
  let cx = abs_diff(cell_x(t), ox);
  let cy = abs_diff(cell_y(t), oy);
  // a target on the opposite x/y side of the origin from the obstacle is never in its shadow.
  if (bx != ox && ((bx >= ox) != (cell_x(t) >= ox))) return false;
  if (by != oy && ((by >= oy) != (cell_y(t) >= oy))) return false;
  if (cx < ax || cy < ay) return false;
  if (cx == ax && cy == ay) return false;
  // slope > slope1 = (2ax-1)/(2ay+1): cy==0 → +inf (true); ax==0 → RHS ≤ 0 (true); else cross-multiply.
  let s_gt_s1 = if (ax == 0 || cy == 0) true else cx * (2 * ay + 1) > (2 * ax - 1) * cy;
  if (!s_gt_s1) return false;
  // ay==0 → slope2 negative: on the obstacle's own row everything strictly beyond it is shadowed.
  if (ay == 0) return if (bx < ox) true else cx > ax;
  if (cy == 0) return false;
  cx * (2 * ay - 1) < (2 * ax + 1) * cy
}

// ╔════════════════ [ Push / pull stepping ] ═════════════════════════════════ ]

public fun dir_none(): u8 { DIR_NONE }

/// Dominant-axis cardinal direction FROM `pivot` TOWARD `subject` — the push-AWAY direction.
/// Tie breaks to the x axis; `DIR_NONE` when the cells coincide.
public fun away_dir(pivot: u64, subject: u64): u8 {
  let px = cell_x(pivot);
  let py = cell_y(pivot);
  let sx = cell_x(subject);
  let sy = cell_y(subject);
  let adx = abs_diff(sx, px);
  let ady = abs_diff(sy, py);
  if (adx == 0 && ady == 0) return DIR_NONE;
  if (adx >= ady) { if (sx >= px) 0 else 1 } else { if (sy >= py) 2 else 3 }
}

/// The pull-TOWARD direction (opposite of `away_dir`).
public fun toward_dir(pivot: u64, subject: u64): u8 { opposite_dir(away_dir(pivot, subject)) }

fun opposite_dir(dir: u8): u8 {
  if (dir == 0) 1 else if (dir == 1) 0 else if (dir == 2) 3 else if (dir == 3) 2 else DIR_NONE
}

/// Step one cell in `dir`; `none` off the encoding grid or for `DIR_NONE`.
public fun step_cell(cell: u64, dir: u8): Option<u64> {
  let x = cell_x(cell);
  let y = cell_y(cell);
  if (dir == 0) { if (x + 1 < GRID_W) option::some(encode(x + 1, y)) else option::none() }
  else if (dir == 1) { if (x >= 1) option::some(encode(x - 1, y)) else option::none() }
  else if (dir == 2) { if (y + 1 < GRID_H) option::some(encode(x, y + 1)) else option::none() }
  else if (dir == 3) { if (y >= 1) option::some(encode(x, y - 1)) else option::none() }
  else option::none()
}

// ╔════════════════ [ Spell zones — the sealed shape list, resolved ] ════════ ]

/// Containment for the direction-independent shapes (point/circle/cross/ring/allmap/blob —
/// codes imported from `spell_effect`, their one home). Direction-dependent shapes
/// (line/tbar/cone/podium) fall back to the filled lozenge here — placed board zones (traps,
/// glyphs) store no cast direction.
public fun in_zone(shape: u8, size: u64, anchor: u64, cell: u64): bool {
  if (!in_grid(cell)) return false;
  if (shape == spell_effect::shape_point()) return cell == anchor;
  if (shape == spell_effect::shape_allmap()) return true;
  let d = manhattan(anchor, cell);
  if (shape == spell_effect::shape_ring()) return d == size;
  if (shape == spell_effect::shape_cross()) {
    return d <= size && (cell_x(cell) == cell_x(anchor) || cell_y(cell) == cell_y(anchor))
  };
  d <= size
}

/// Every in-grid cell of a `(shape, size)` zone anchored at `anchor`, cast from `caster` (the
/// direction source for line/tbar/cone/podium).
public fun zone_cells(shape: u8, size: u64, anchor: u64, caster: u64): vector<u64> {
  if (shape == spell_effect::shape_point()) return vector[anchor];
  if (shape == spell_effect::shape_line()) return line_cells(anchor, caster, size);
  if (shape == spell_effect::shape_tbar()) return tbar_cells(anchor, caster, size);
  if (shape == spell_effect::shape_podium()) return podium_cells(anchor, caster, size);
  if (shape == spell_effect::shape_cone()) return cone_cells(anchor, caster, size);
  // allmap is the ONE shape a box would silently amputate — it keeps the board scan.
  let mut out = vector[];
  if (shape == spell_effect::shape_allmap()) {
    let mut c = 0;
    while (c < GRID_CELLS) {
      if (in_zone(shape, size, anchor, c)) out.push_back(c);
      c = c + 1;
    };
    return out
  };
  // circle / cross / ring / blob live inside the anchor's ±size box — scan that, not 380.
  let ax = cell_x(anchor);
  let ay = cell_y(anchor);
  let x0 = if (ax > size) ax - size else 0;
  let y0 = if (ay > size) ay - size else 0;
  let x1 = if (ax + size < GRID_W - 1) ax + size else GRID_W - 1;
  let y1 = if (ay + size < GRID_H - 1) ay + size else GRID_H - 1;
  let mut y = y0;
  while (y <= y1) {
    let mut x = x0;
    while (x <= x1) {
      let c = encode(x, y);
      if (in_zone(shape, size, anchor, c)) out.push_back(c);
      x = x + 1;
    };
    y = y + 1;
  };
  out
}

/// LINE: `anchor` + up to `size` cells continuing along the caster→anchor axis.
fun line_cells(anchor: u64, caster: u64, size: u64): vector<u64> {
  let mut out = vector[anchor];
  out.append(walk(anchor, away_dir(caster, anchor), size));
  out
}

/// TBAR: a bar perpendicular to the caster→anchor axis, `size` cells each way from `anchor`.
fun tbar_cells(anchor: u64, caster: u64, size: u64): vector<u64> {
  let along = away_dir(caster, anchor);
  let (perp_a, perp_b) = if (along == 0 || along == 1 || along == DIR_NONE) (2u8, 3u8) else (0u8, 1u8);
  let mut out = vector[anchor];
  out.append(walk(anchor, perp_a, size));
  out.append(walk(anchor, perp_b, size));
  out
}

/// PODIUM: the tbar arc at `anchor` PLUS one cell beyond along the strike
/// axis. At size 1 it touches exactly 4 cells.
fun podium_cells(anchor: u64, caster: u64, size: u64): vector<u64> {
  let mut out = tbar_cells(anchor, caster, size);
  let fwd = step_cell(anchor, away_dir(caster, anchor));
  if (fwd.is_some()) out.push_back(fwd.destroy_some());
  out
}

/// CONE: a wedge fanning from the caster toward `anchor`, `size` deep — 1 cell at depth 1,
/// 3 wide from depth 2. The caster's own cell is excluded.
fun cone_cells(anchor: u64, caster: u64, size: u64): vector<u64> {
  let dir = away_dir(caster, anchor);
  let (perp_a, perp_b) = if (dir == 0 || dir == 1 || dir == DIR_NONE) (2u8, 3u8) else (0u8, 1u8);
  let mut out = vector[];
  let mut center = caster;
  let mut k = 0;
  while (k < size) {
    let nxt = step_cell(center, dir);
    if (nxt.is_none()) break;
    center = nxt.destroy_some();
    out.push_back(center);
    if (k > 0) {
      let a = step_cell(center, perp_a);
      if (a.is_some()) out.push_back(a.destroy_some());
      let b = step_cell(center, perp_b);
      if (b.is_some()) out.push_back(b.destroy_some());
    };
    k = k + 1;
  };
  out
}

/// `count` cells stepping from `anchor` (exclusive) in `dir`, stopping at the edge.
fun walk(anchor: u64, dir: u8, count: u64): vector<u64> {
  let mut out = vector[];
  let mut cur = anchor;
  let mut k = 0;
  while (k < count) {
    let nxt = step_cell(cur, dir);
    if (nxt.is_none()) break;
    cur = nxt.destroy_some();
    out.push_back(cur);
    k = k + 1;
  };
  out
}

// ╔════════════════ [ The board generator — seed → playable board ] ══════════ ]
// Every outline below is orthogonally convex (each row and column one contiguous run) and
// every blocker keeps its full outer ring walkable with no other blocker king-adjacent —
// no watertight blocked curve can form, so connectivity holds BY CONSTRUCTION, zero flood-fill.

/// A generated board. Recomputed from the seed by any reader; the Fight embeds one copy.
public struct GridSpec has copy, drop, store {
  width: u64,
  height: u64,
  shape_mask: vector<u64>,
  obstacles: vector<u64>, // block movement AND sight
  holes: vector<u64>, // block movement only
  start_cells_a: vector<u64>, // 6 near-band cells — team A picks among these
  start_cells_b: vector<u64>, // 6 far-band cells — team B
}

public fun width(g: &GridSpec): u64 { g.width }

public fun height(g: &GridSpec): u64 { g.height }

public fun shape_mask(g: &GridSpec): vector<u64> { g.shape_mask }

public fun obstacles(g: &GridSpec): vector<u64> { g.obstacles }

public fun holes(g: &GridSpec): vector<u64> { g.holes }

public fun start_cells_a(g: &GridSpec): vector<u64> { g.start_cells_a }

public fun start_cells_b(g: &GridSpec): vector<u64> { g.start_cells_b }

/// The AUTHORED-board constructor — the board catalog's one door into GridSpec (fields are
/// module-private; nothing else builds one). Sanity here is the cheap floor: bounds, mask
/// shape, live start bands, blockers on-mask; the deep proof (full connectivity) lives in
/// the off-chain seed validator, which every catalog write passes through first.
public fun grid_spec(
  width: u64,
  height: u64,
  shape_mask: vector<u64>,
  obstacles: vector<u64>,
  holes: vector<u64>,
  start_cells_a: vector<u64>,
  start_cells_b: vector<u64>,
): GridSpec {
  assert!(width >= 1 && width <= GRID_W && height >= 1 && height <= GRID_H, EBadBoard);
  assert!(shape_mask.length() == MASK_WORDS, EBadBoard);
  assert!(start_cells_a.length() == START_CELLS, EBadBoard);
  assert!(start_cells_b.length() == START_CELLS, EBadBoard);
  aos(&shape_mask, &obstacles);
  aos(&shape_mask, &holes);
  let mut blockers = obstacles;
  blockers.append(holes);
  let blocked = mask_from_cells(&blockers);
  aof(&shape_mask, &blocked, &start_cells_a);
  aof(&shape_mask, &blocked, &start_cells_b);
  assert_unique_starts(&start_cells_a, &start_cells_b);
  GridSpec { width, height, shape_mask, obstacles, holes, start_cells_a, start_cells_b }
}

fun assert_unique_starts(a: &vector<u64>, b: &vector<u64>) {
  let mut i = 0;
  while (i < a.length()) {
    let mut j = i + 1;
    while (j < a.length()) { assert!(a[i] != a[j], EBadBoard); j = j + 1; };
    let mut k = 0;
    while (k < b.length()) { assert!(a[i] != b[k], EBadBoard); k = k + 1; };
    i = i + 1;
  };
  let mut x = 0;
  while (x < b.length()) {
    let mut y = x + 1;
    while (y < b.length()) { assert!(b[x] != b[y], EBadBoard); y = y + 1; };
    x = x + 1;
  };
}

// assert_on_shape
fun aos(shape: &vector<u64>, cells: &vector<u64>) {
  let mut i = 0;
  while (i < cells.length()) {
    assert!(in_grid(cells[i]) && mask_get(shape, cells[i]), EBadBoard);
    i = i + 1;
  };
}

// assert_open_footing — a start cell is on-shape AND unblocked
fun aof(shape: &vector<u64>, blocked: &vector<u64>, cells: &vector<u64>) {
  aos(shape, cells);
  let mut i = 0;
  while (i < cells.length()) {
    assert!(!mask_get(blocked, cells[i]), EBadBoard);
    i = i + 1;
  };
}

/// Deterministically generate a board from `(board_seed, variant)` — world fights pass
/// variant 0; dungeons their room index. The DRAW ORDER is the cross-language contract:
/// width · height · outline (+ its params) · obstacles (count, then per blocker len/dir/anchor)
/// · holes (same) · starts. Never reorder a draw without mirroring the client twin.
#[test_only]
public fun generate(board_seed: u64, variant: u64): GridSpec {
  let mut s = prng::rng_seed(board_seed ^ (((variant + 1) * VARIANT_MIX) & 0xFFFFFFFF));

  let width = { let (ns, v) = prng::rng_range(s, MIN_W, MAX_W); s = ns; v };
  let height = { let (ns, v) = prng::rng_range(s, MIN_H, MAX_H); s = ns; v };

  let vocab = vector[SHAPE_BLOB, SHAPE_ROUNDED, SHAPE_ELLIPSE, SHAPE_CROSS];
  let shape_code = { let (ns, v) = prng::rng_int(s, N_SHAPES); s = ns; vocab[v] };
  let (ns, mask) = build_shape(s, shape_code, width, height);
  s = ns;

  let anchors = ring_safe_cells(&mask);
  let mut blocked = vector[];
  let obs_count = { let (ns2, v) = prng::rng_range(s, OBS_MIN, OBS_MAX); s = ns2; v };
  s = place_blockers(s, &mask, &anchors, &mut blocked, obs_count);
  let n_obs = blocked.length();
  let hole_count = { let (ns2, v) = prng::rng_range(s, HOLE_MIN, HOLE_MAX); s = ns2; v };
  place_blockers(s, &mask, &anchors, &mut blocked, hole_count); // final prng state unused
  let (obstacles, holes) = split_at(&blocked, n_obs);

  let pool = open_cells(&mask, &blocked);
  let start_cells_a = pick_starts(&pool, true, &vector[]);
  let start_cells_b = pick_starts(&pool, false, &start_cells_a);

  GridSpec { width, height, shape_mask: mask, obstacles, holes, start_cells_a, start_cells_b }
}

#[test_only]
fun build_shape(mut s: u64, shape_code: u8, width: u64, height: u64): (u64, vector<u64>) {
  if (shape_code == SHAPE_ELLIPSE) {
    (s, ellipse_mask(width, height))
  } else if (shape_code == SHAPE_ROUNDED) {
    let cap = min_u64(width, height) / 3;
    let r = { let (ns, v) = prng::rng_range(s, 1, cap); s = ns; v };
    (s, rounded_mask(width, height, r))
  } else if (shape_code == SHAPE_CROSS) {
    let bar_h = { let (ns, v) = prng::rng_range(s, 3, height); s = ns; v };
    let bar_w = { let (ns, v) = prng::rng_range(s, 3, width); s = ns; v };
    let ry0 = (height - bar_h) / 2;
    let cx0 = (width - bar_w) / 2;
    (s, cross_outline(width, height, ry0, ry0 + bar_h, cx0, cx0 + bar_w))
  } else {
    let cap = min_u64(width, height) / 3;
    let r_tl = { let (ns, v) = prng::rng_range(s, 1, cap); s = ns; v };
    let r_tr = { let (ns, v) = prng::rng_range(s, 1, cap); s = ns; v };
    let r_bl = { let (ns, v) = prng::rng_range(s, 1, cap); s = ns; v };
    let r_br = { let (ns, v) = prng::rng_range(s, 1, cap); s = ns; v };
    (s, blob_mask(width, height, r_tl, r_tr, r_bl, r_br))
  }
}

#[test_only]
fun min_u64(a: u64, b: u64): u64 { if (a < b) a else b }

/// Fill row `y`'s cells `x ∈ [lo, hi)` — the single-contiguous-run primitive every outline uses.
#[test_only]
fun fill_row(mask: &mut vector<u64>, y: u64, lo: u64, hi: u64) {
  let end = if (hi > GRID_W) GRID_W else hi;
  let mut x = lo;
  while (x < end) { mask_set(mask, encode(x, y)); x = x + 1; };
}

#[test_only]
fun rect_mask(w: u64, h: u64): vector<u64> {
  let mut m = empty_mask();
  let mut y = 0;
  while (y < h) { fill_row(&mut m, y, 0, w); y = y + 1; };
  m
}

/// The filled axis-aligned ellipse in `[0,w) × [0,h)` — `(2Δx)²h² + (2Δy)²w² ≤ (wh)²` in
/// doubled coordinates (integral center, u64-safe).
#[test_only]
fun ellipse_mask(w: u64, h: u64): vector<u64> {
  let mut m = empty_mask();
  let cx2 = w - 1;
  let cy2 = h - 1;
  let rhs = (w * h) * (w * h);
  let mut y = 0;
  while (y < h) {
    let dy2 = abs_diff(2 * y, cy2);
    let ty = dy2 * dy2 * (w * w);
    let mut lo = w;
    let mut hi = 0;
    let mut x = 0;
    while (x < w) {
      let dx2 = abs_diff(2 * x, cx2);
      if (dx2 * dx2 * (h * h) + ty <= rhs) {
        if (x < lo) lo = x;
        if (x + 1 > hi) hi = x + 1;
      };
      x = x + 1;
    };
    if (lo < hi) fill_row(&mut m, y, lo, hi);
    y = y + 1;
  };
  m
}

/// RECT with four corners bevelled by a quarter-arc of radius `r` (r ≤ min(w,h)/3).
#[test_only]
fun rounded_mask(w: u64, h: u64, r: u64): vector<u64> {
  if (r == 0) return rect_mask(w, h);
  let mut m = empty_mask();
  let mut y = 0;
  while (y < h) {
    let cut = corner_cut(r, y, h, y < r);
    fill_row(&mut m, y, cut, w - cut);
    y = y + 1;
  };
  m
}

/// Cells a quarter-arc corner of radius `r` cuts from one end of row `y` — 0 outside the
/// corner bands; a contiguous prefix inside (dx² + dy² > (r-1)² ⇒ cut), so rows stay one run.
#[test_only]
fun corner_cut(r: u64, y: u64, h: u64, top: bool): u64 {
  if (r == 0) return 0;
  let in_band = if (top) y < r else y >= h - r;
  if (!in_band) return 0;
  let dy = if (top) r - 1 - y else y - (h - r);
  let arc = (r - 1) * (r - 1);
  let mut cut = 0;
  let mut k = 0;
  while (k < r) {
    let dx = r - 1 - k;
    if (dx * dx + dy * dy > arc) { cut = k + 1; } else break;
    k = k + 1;
  };
  cut
}

/// A rounded rectangle with FOUR independent corner radii — asymmetric, organic outlines.
/// Left inset = max(top-left, bottom-left) cut per row (the bands are disjoint), same right.
#[test_only]
fun blob_mask(w: u64, h: u64, r_tl: u64, r_tr: u64, r_bl: u64, r_br: u64): vector<u64> {
  let mut m = empty_mask();
  let mut y = 0;
  while (y < h) {
    let tl = corner_cut(r_tl, y, h, true);
    let tr = corner_cut(r_tr, y, h, true);
    let bl = corner_cut(r_bl, y, h, false);
    let br = corner_cut(r_br, y, h, false);
    let left = if (tl > bl) tl else bl;
    let right = if (tr > br) tr else br;
    fill_row(&mut m, y, left, w - right);
    y = y + 1;
  };
  m
}

/// A plus: horizontal bar rows `[ry0,ry1)` × full width ∪ vertical bar cols `[cx0,cx1)` ×
/// full height. Both bars ≥3 thick and centered.
#[test_only]
fun cross_outline(w: u64, h: u64, ry0: u64, ry1: u64, cx0: u64, cx1: u64): vector<u64> {
  let mut m = empty_mask();
  let mut y = 0;
  while (y < h) {
    if (y >= ry0 && y < ry1) { fill_row(&mut m, y, 0, w); } else { fill_row(&mut m, y, cx0, cx1); };
    y = y + 1;
  };
  m
}

/// Every cell whose full 8-ring is on-mask (≥1 inside the rim) — the legal blocker anchors.
#[test_only]
fun ring_safe_cells(mask: &vector<u64>): vector<u64> {
  let mut out = vector[];
  let mut c = 0;
  while (c < GRID_CELLS) {
    if (ring_on_mask(mask, c)) out.push_back(c);
    c = c + 1;
  };
  out
}

/// Is `cell` on-mask with its whole 8-ring on-mask? Guards edge pockets — a blocker never
/// seals a boundary passage.
#[test_only]
fun ring_on_mask(mask: &vector<u64>, cell: u64): bool {
  if (!mask_get(mask, cell)) return false;
  let x = cell_x(cell);
  let y = cell_y(cell);
  if (x == 0 || y == 0 || x + 1 >= GRID_W || y + 1 >= GRID_H) return false;
  let mut dy = 0;
  while (dy < 3) {
    let mut dx = 0;
    while (dx < 3) {
      if (!mask_get(mask, encode(x + dx - 1, y + dy - 1))) return false;
      dx = dx + 1;
    };
    dy = dy + 1;
  };
  true
}

/// May a straight run of blocker `cells` be committed? Every cell ring-safe AND no already-
/// committed blocked cell within king distance 1 of any member (the isolation the
/// connectivity-by-construction proof rides on; the run's own members are exempt).
#[test_only]
fun group_placeable(mask: &vector<u64>, blocked: &vector<u64>, cells: &vector<u64>): bool {
  let n = cells.length();
  let bn = blocked.length();
  let mut i = 0;
  while (i < n) {
    let c = cells[i];
    if (!ring_on_mask(mask, c)) return false;
    let mut j = 0;
    while (j < bn) {
      let b = blocked[j];
      if (abs_diff(cell_x(b), cell_x(c)) <= 1 && abs_diff(cell_y(b), cell_y(c)) <= 1) return false;
      j = j + 1;
    };
    i = i + 1;
  };
  true
}

/// Place `count` blockers, each a straight run of 1..BLOCKER_MAX_LEN cells (drawn per
/// blocker: length, then axis, then a rotating anchor probe over `anchors`). A run that fits
/// nowhere retries at length 1; a board with no room left stops early.
#[test_only]
fun place_blockers(mut s: u64, mask: &vector<u64>, anchors: &vector<u64>, blocked: &mut vector<u64>, count: u64): u64 {
  let n = anchors.length();
  if (n == 0) return s;
  let mut placed = 0;
  while (placed < count) {
    let len = { let (ns, v) = prng::rng_range(s, 1, BLOCKER_MAX_LEN); s = ns; v };
    let step = { let (ns, v) = prng::rng_int(s, 2); s = ns; if (v == 0) 1 else GRID_W };
    let idx0 = { let (ns, v) = prng::rng_int(s, n); s = ns; v };
    let mut took = probe_run(mask, anchors, blocked, idx0, len, step);
    if (!took && len > 1) took = probe_run(mask, anchors, blocked, idx0, 1, step);
    if (!took) break;
    placed = placed + 1;
  };
  s
}

/// Rotating probe: from `idx0`, the first anchor whose straight run of `len` cells (stepping
/// `step`) is placeable gets committed. Returns whether a run landed.
#[test_only]
fun probe_run(mask: &vector<u64>, anchors: &vector<u64>, blocked: &mut vector<u64>, idx0: u64, len: u64, step: u64): bool {
  let n = anchors.length();
  let mut j = 0;
  while (j < n) {
    let anchor = anchors[(idx0 + j) % n];
    let mut cells = vector[anchor];
    let mut k = 1;
    while (k < len) {
      cells.push_back(anchor + k * step);
      k = k + 1;
    };
    if (group_placeable(mask, blocked, &cells)) {
      blocked.append(cells);
      return true
    };
    j = j + 1;
  };
  false
}

#[test_only]
fun open_cells(mask: &vector<u64>, blocked: &vector<u64>): vector<u64> {
  let mut out = vector[];
  let mut c = 0;
  while (c < GRID_CELLS) {
    if (mask_get(mask, c) && !blocked.contains(&c)) out.push_back(c);
    c = c + 1;
  };
  out
}

/// 6 start cells from one band: the near rows for team A (`from_top`), the far rows for B —
/// the first/last open cells in row-major order, skipping the other side's picks.
#[test_only]
fun pick_starts(pool: &vector<u64>, from_top: bool, used: &vector<u64>): vector<u64> {
  let mut out = vector[];
  let n = pool.length();
  let mut k = 0;
  while (k < n && out.length() < START_CELLS) {
    let cell = pool[if (from_top) k else n - 1 - k];
    if (!used.contains(&cell)) out.push_back(cell);
    k = k + 1;
  };
  out
}

#[test_only]
fun split_at(v: &vector<u64>, at: u64): (vector<u64>, vector<u64>) {
  let mut head = vector[];
  let mut tail = vector[];
  let n = v.length();
  let mut i = 0;
  while (i < n) {
    if (i < at) head.push_back(v[i]) else tail.push_back(v[i]);
    i = i + 1;
  };
  (head, tail)
}

/// The neighbouring cell strictly closer on a distance field, tie-breaking by cell index.
public fun best_step(current: u64, field: &vector<u64>): Option<u64> {
  let mut best = option::none();
  let mut best_value = field[current];
  let mut direction = 0u8;
  while (direction < 4) {
    let step = step_cell(current, direction);
    if (step.is_some()) {
      let cell = step.destroy_some();
      let value = field[cell];
      if (value < best_value || (value == best_value && best.is_some() && cell < *best.borrow())) {
        best = option::some(cell);
        best_value = value;
      };
    };
    direction = direction + 1;
  };
  best
}

public fun closed_mask(board: &GridSpec): vector<u64> {
  let shape = board.shape_mask();
  let mut closed = empty_mask();
  let mut cell = 0;
  while (cell < GRID_CELLS) {
    if (!mask_get(&shape, cell)) mask_set(&mut closed, cell);
    cell = cell + 1;
  };
  mask_add_cells(&mut closed, &board.obstacles());
  mask_add_cells(&mut closed, &board.holes());
  closed
}

public fun travel_order(
  targets: vector<u64>,
  fighter_cells: &vector<u64>,
  pivot: u64,
  push: bool,
): vector<u64> {
  let mut sorted = targets;
  let count = sorted.length();
  let mut index = 0;
  while (index < count) {
    let mut best = index;
    let mut candidate = index + 1;
    while (candidate < count) {
      let candidate_distance = manhattan(fighter_cells[sorted[candidate]], pivot);
      let best_distance = manhattan(fighter_cells[sorted[best]], pivot);
      let ahead = if (push) candidate_distance > best_distance else candidate_distance < best_distance;
      if (ahead || (candidate_distance == best_distance && sorted[candidate] < sorted[best])) best = candidate;
      candidate = candidate + 1;
    };
    sorted.swap(index, best);
    index = index + 1;
  };
  sorted
}
