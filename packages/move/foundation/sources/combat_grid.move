// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// COMBAT GRID + FIXED DAMAGE — pure, integer-only board geometry (cell = y*GRID_W + x), Chebyshev distance, the
/// greedy mob-approach AI step, and the FIXED-damage pipeline (the spell formula with the per-cast RNG pinned out).
/// Extracted from `aresrpg_foundation::combat` so the combat module stays focused on the Fight lifecycle. REUSES `spell`'s
/// pure helpers (calculate_raw_damage / apply_level_scaling / apply_resistance); never draws prng → zero variance.
/// `spell.move` / `combat2d.move` / `prng.move` stay byte-identical (qa-code replay gate).
module aresrpg_foundation::combat_grid;

use aresrpg_foundation::{spell::{Self, Stats}, spell_effect};

// D75 — the fixed cell-encoding STRIDE (board width). Cell = y*GRID_W + x, so GRID_W is the SSOT stride EVERY
// reader (contract + fight-los.js twin) encodes against; it is NOT the room's playable width (that varies per
// D75 shape, stored on the Dungeon). Grew 10→20 for the D75 varied-grid vocabulary (RECT w∈[7..17]): x must
// reach 16, so the stride must be ≥17; 20 is the round choice with headroom. GRID_H (max rows) grew 10→19 for
// the "15x19"/tall shapes. GRID_CELLS (380) is the cell-index bound + the shape_mask's bit count (6 u64 words).
const GRID_W: u64 = 20; // encoding STRIDE + max board width — cell = y*GRID_W + x (SSOT; fight-los.js GRID_W must match)
const GRID_H: u64 = 19; // max board height (rows) — D75 tall shapes (h up to 19)
const GRID_CELLS: u64 = GRID_W * GRID_H; // 380 — the cell-index bound (cells 0..GRID_CELLS) + shape_mask bit count
const MASK_WORDS: u64 = (GRID_CELLS + 63) / 64; // 6 — u64 words needed to hold one bit per cell (row-major shape_mask)
const START_ROWS: u64 = 2; // near-side spawn zone depth: rows y < START_ROWS are the valid player start cells (D4 placement)

fun abs_diff(a: u64, b: u64): u64 { if (a > b) a - b else b - a }

fun cell_x(cell: u64): u64 { cell % GRID_W }

fun cell_y(cell: u64): u64 { cell / GRID_W }

public fun encode(x: u64, y: u64): u64 { y * GRID_W + x }

public fun in_grid(cell: u64): bool { cell < GRID_CELLS }

/// PATHFINDING (retro-exact): the 4-connected BFS shortest-path STEP COUNT from `start` to
/// `target` over the GRID_W×GRID_H board, treating every cell SET in `wall_mask` (obstacles ∪ holes ∪ occupied fighters —
/// body-blocking; a MASK_WORDS-word bitset — gas-diet #1) as a WALL. Returns the exact MP cost (= path steps) if
/// `target` is reachable within `max_steps`, else `GRID_CELLS` (a sentinel larger than any real cost) meaning
/// UNREACHABLE. Deterministic + integer-only; the JS twin (`fight-los bfsPathCost`) computes the same COST from
/// its own blocked set (the mask is an internal representation — RESULT parity, the drawn path length == the
/// contract's MP charge). Bounded: ≤100 cells, MP small, so BFS is cheap.
public fun bfs_path_cost(start: u64, target: u64, wall_mask: &vector<u64>, max_steps: u64): u64 {
  if (start == target) return 0;
  if (!in_grid(start) || !in_grid(target) || mask_get(wall_mask, target)) return GRID_CELLS;
  let mut visited = empty_mask();
  mask_set(&mut visited, start);
  let mut frontier = vector<u64>[start];
  let mut steps = 0;
  while (steps < max_steps && !frontier.is_empty()) {
    steps = steps + 1;
    let mut next = vector<u64>[];
    let mut j = 0;
    let fl = frontier.length();
    while (j < fl) {
      let c = *frontier.borrow(j);
      let x = cell_x(c);
      let y = cell_y(c);
      let mut nbrs = vector<u64>[];
      if (x > 0) nbrs.push_back(c - 1);
      if (x + 1 < GRID_W) nbrs.push_back(c + 1);
      if (y > 0) nbrs.push_back(c - GRID_W);
      if (y + 1 < GRID_H) nbrs.push_back(c + GRID_W);
      let mut k = 0;
      while (k < nbrs.length()) {
        let n = *nbrs.borrow(k);
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

/// THE DISTANCE FIELD to `target`: one BFS outward from the target producing, for every cell, its 4-connected
/// shortest step count TO the target over the same wall set — `path_unreachable()` for a wall, for a cell no
/// path reaches, and for anything farther than `max_steps`.
///
/// This is `bfs_path_cost` answered for every cell at once, and it exists because the movement walker needed the
/// answer ~25 times per move: one flood fill for the route cost, then another PER CANDIDATE DIRECTION per step.
/// The graph is undirected (a wall blocks from either side), so distance-to-target read off a field grown FROM
/// the target is the same number `bfs_path_cost(cell, target, …)` returns — the walker's tie-break predicate is
/// unchanged, byte for byte, and only the number of flood fills moves.
///
/// The field does NOT answer for a wall cell, while `bfs_path_cost` never checks whether its START is a wall.
/// Every caller tests `mask_get(walls, cell)` before reading, so the two agree everywhere they are consulted.
public fun bfs_distance_field(target: u64, wall_mask: &vector<u64>, max_steps: u64): vector<u64> {
  let mut field = vector<u64>[];
  let mut i = 0;
  while (i < GRID_CELLS) { field.push_back(GRID_CELLS); i = i + 1; };
  if (!in_grid(target) || mask_get(wall_mask, target)) return field;

  *field.borrow_mut(target) = 0;
  let mut frontier = vector<u64>[target];
  let mut steps = 0;
  while (steps < max_steps && !frontier.is_empty()) {
    steps = steps + 1;
    let mut next = vector<u64>[];
    let mut j = 0;
    while (j < frontier.length()) {
      let c = *frontier.borrow(j);
      let x = cell_x(c);
      let y = cell_y(c);
      let mut nbrs = vector<u64>[];
      if (x > 0) nbrs.push_back(c - 1);
      if (x + 1 < GRID_W) nbrs.push_back(c + 1);
      if (y > 0) nbrs.push_back(c - GRID_W);
      if (y + 1 < GRID_H) nbrs.push_back(c + GRID_W);
      let mut k = 0;
      while (k < nbrs.length()) {
        let n = *nbrs.borrow(k);
        if (*field.borrow(n) == GRID_CELLS && !mask_get(wall_mask, n)) {
          *field.borrow_mut(n) = steps;
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

/// The UNREACHABLE sentinel `bfs_path_cost` returns when no path ≤ max_steps exists (a wrapper for readability + the JS twin).
public fun path_unreachable(): u64 { GRID_CELLS }

/// Total cell count of the fixed board (380 = 20×19) — the enumeration bound for the dungeon's move-blocked-set builder.
public fun grid_cells(): u64 { GRID_CELLS }

/// D125 MOB-MOVE WALKABILITY CLAMP — the destination a mob actually lands on when approaching `target` with a
/// `budget`-step dash, ROUTING AROUND `wall_mask` (obstacles ∪ holes ∪ off-shape ∪ bodies, a MASK_WORDS-word
/// bitset — gas-diet #1). BFS outward from `start` up to `budget` steps; among every reachable cell (cost ≤
/// budget) that is NOT the target's own cell, return the one MINIMIZING (Manhattan distance to target, then path
/// cost, then cell index) — the farthest LEGAL cell toward the target. `start` itself is always a candidate (cost
/// 0 — the mob can hold if walled in), so this never fails. Mirrors the player's `bfs_path_cost` gate (same wall
/// set, same 4-connected metric); the mob thus can never end ON or ACROSS a hole/obstacle/occupant. Deterministic
/// + integer-only. Bounded: ≤ GRID_CELLS cells visited.
public fun bfs_best_toward(start: u64, target: u64, wall_mask: &vector<u64>, budget: u64): u64 {
  if (!in_grid(start)) return start;
  // seed the search with `start` (always legal — the mob's own cell, the BFS origin).
  let mut best = start;
  let mut best_dist = manhattan(start, target);
  let mut best_cost = 0;
  let mut visited = empty_mask();
  mask_set(&mut visited, start);
  let mut frontier = vector<u64>[start];
  let mut cost = 0;
  while (cost < budget && !frontier.is_empty()) {
    cost = cost + 1;
    let mut next = vector<u64>[];
    let mut j = 0;
    let fl = frontier.length();
    while (j < fl) {
      let c = *frontier.borrow(j);
      let x = cell_x(c);
      let y = cell_y(c);
      let mut nbrs = vector<u64>[];
      if (x > 0) nbrs.push_back(c - 1);
      if (x + 1 < GRID_W) nbrs.push_back(c + 1);
      if (y > 0) nbrs.push_back(c - GRID_W);
      if (y + 1 < GRID_H) nbrs.push_back(c + GRID_W);
      let mut k = 0;
      while (k < nbrs.length()) {
        let n = *nbrs.borrow(k);
        if (!mask_get(&visited, n) && !mask_get(wall_mask, n)) {
          mask_set(&mut visited, n);
          next.push_back(n);
          // candidate for the landing cell: never the target's own cell (stop adjacent, retro rule).
          if (n != target) {
            let d = manhattan(n, target);
            if (d < best_dist || (d == best_dist && cost < best_cost) || (d == best_dist && cost == best_cost && n < best)) {
              best = n;
              best_dist = d;
              best_cost = cost;
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

/// Can a spell of effective range band `[range_min, range_max]` be cast at `target` FROM `from`? Manhattan
/// distance in band AND (if `needs_los`) a clear sight line over `los_obstacles`. The cast-legality predicate
/// the band-aware approach filters landing cells by (mirrors `mob_ai::castable_at` minus the AP gate).
fun cell_can_cast(from: u64, target: u64, range_min: u64, range_max: u64, needs_los: bool, los_obstacles: &vector<u64>): bool {
  let d = manhattan(from, target);
  d >= range_min && d <= range_max && (!needs_los || line_of_sight(from, target, los_obstacles))
}

/// RANGE-BAND MOB CAST APPROACH — the cell a mob should stand on to CAST a spell of effective range band
/// `[range_min, range_max]` (LOS-aware) at `target`, reached by a `budget`-step dash routing around `wall_mask`
/// (the SAME 4-connected wall bitset as `bfs_best_toward`). BFS outward from `start` (≤ budget steps); among every
/// reachable cell that CAN CAST (Manhattan in-band AND, when `needs_los`, a clear line of sight to `target`),
/// returns `some` of the one MINIMIZING (path cost, then Manhattan distance to target, then cell index) — the
/// CLOSEST-BY-STEPS legal cast cell. A min-range mob thus HOLDS at its band instead of overshooting into the
/// point-blank dead zone (where `bfs_best_toward` would strand it, uncastable); an LOS-blocked approach reroutes
/// to a cell that can actually see the target. `start` is a candidate at cost 0 (a mob already in a legal cast
/// cell needn't move). `none` when NO reachable cell can cast — the caller then falls back to a plain rush.
/// Deterministic + integer-only; bounded ≤ GRID_CELLS cells visited.
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
  let mut best_cost = 0;
  let mut best_dist = 0;
  if (cell_can_cast(start, target, range_min, range_max, needs_los, los_obstacles)) {
    found = true; best_dist = manhattan(start, target); // best=start, best_cost=0
  };
  let mut visited = empty_mask();
  mask_set(&mut visited, start);
  let mut frontier = vector<u64>[start];
  let mut cost = 0;
  while (cost < budget && !frontier.is_empty()) {
    // GAS DIET (a) — EARLY-EXIT: one while-iteration processes exactly one full BFS cost-layer, and BFS is
    // cost-ordered, so once ANY castable cell is found the min-cost layer is already complete — every deeper
    // layer has strictly higher cost and cannot win the (cost, then dist, then index) tie-break. Stopping here is
    // RESULT-PRESERVING (same cell as the full scan), it just skips the remaining layers up to `budget`.
    if (found) break;
    cost = cost + 1;
    let mut next = vector<u64>[];
    let mut j = 0;
    let fl = frontier.length();
    while (j < fl) {
      let c = *frontier.borrow(j);
      let x = cell_x(c);
      let y = cell_y(c);
      let mut nbrs = vector<u64>[];
      if (x > 0) nbrs.push_back(c - 1);
      if (x + 1 < GRID_W) nbrs.push_back(c + 1);
      if (y > 0) nbrs.push_back(c - GRID_W);
      if (y + 1 < GRID_H) nbrs.push_back(c + GRID_W);
      let mut k = 0;
      while (k < nbrs.length()) {
        let n = *nbrs.borrow(k);
        if (!mask_get(&visited, n) && !mask_get(wall_mask, n)) {
          mask_set(&mut visited, n);
          next.push_back(n);
          if (cell_can_cast(n, target, range_min, range_max, needs_los, los_obstacles)) {
            let d = manhattan(n, target);
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

/// D4 PLACEMENT: is `cell` a valid player start cell? The near-side spawn zone = the first `START_ROWS` rows
/// (y < START_ROWS). Single source of truth for the board's start geometry (dungeon `place_at` reads this so it
/// never re-hardcodes the grid width). The join-time default spread `encode(1 + seat, 1)` lands in this zone.
/// TRAIN-3 FALLBACK ONLY: D75 replaces this with STORED start-list membership (a Dungeon holds explicit
/// start_cells_a/b); `place_at` reads the stored list when present and falls back to THIS rule for a train-3
/// dungeon that has no stored list (shape-tolerant cutover — the data is the flag).
public fun is_start_cell(cell: u64): bool { in_grid(cell) && cell_y(cell) < START_ROWS }

// ╔════════════════ [ D75 — deterministic varied-grid SHAPE VOCABULARY + king-isolation placer (the SSOT) ] ═ ]
// Shape requirement: determined by the move modules, obstacles + holes, random shape, still
// playable". THIS module owns the pure geometry; `aresrpg::dungeon_grid` draws the shape/dims/blockers from the
// chain RandomGenerator and assembles a stored board. The board's playable region is a `shape_mask`
// (`vector<u64>`, 1 bit per cell, row-major, MASK_WORDS words) — NOT a plain rectangle. Walkable(c) = mask-bit
// ∧ ¬obstacle ∧ ¬hole. EVERY shape below is built by filling, per row, a SINGLE CONTIGUOUS run `[lo,hi)` and is
// chosen to also be column-convex — so every row AND every column of the mask is one contiguous run
// (orthogonal convexity). That convexity is the property the king-isolation connectivity proof rides on.

// Shape codes (closed set) — the generator draws one of these; kept as consts so the JS twin mirrors them 1:1.
const SHAPE_RECT: u8 = 0;
const SHAPE_ROUNDED: u8 = 1;
const SHAPE_ELLIPSE: u8 = 2;
const SHAPE_CROSS: u8 = 3;
const SHAPE_BLOB: u8 = 4;
public fun shape_rect(): u8 { SHAPE_RECT }
public fun shape_rounded(): u8 { SHAPE_ROUNDED }
public fun shape_ellipse(): u8 { SHAPE_ELLIPSE }
public fun shape_cross(): u8 { SHAPE_CROSS }
public fun shape_blob(): u8 { SHAPE_BLOB }

/// The number of u64 words in a `shape_mask` (6 — one bit per cell of the 20×19 board). The generator sizes its
/// mask to this; the JS twin mirrors it.
public fun mask_words(): u64 { MASK_WORDS }

/// A fresh all-zero shape_mask (no cell set). MASK_WORDS words.
public fun empty_mask(): vector<u64> {
  let mut m = vector[];
  let mut i = 0;
  while (i < MASK_WORDS) { m.push_back(0); i = i + 1; };
  m
}

/// Set bit `cell` in a shape_mask (row-major). No-op if `cell` is out of the board bound (defensive).
public fun mask_set(mask: &mut vector<u64>, cell: u64) {
  if (cell >= GRID_CELLS) return;
  let w = cell / 64;
  let b = cell % 64;
  let cur = *mask.borrow(w);
  *mask.borrow_mut(w) = cur | (1u64 << (b as u8));
}

/// Set every cell of `cells` (a plain cell-index list) into `mask` — the cell-list → bitset bridge the movement-
/// wall builders use (obstacles/holes/bodies are stored as cell lists but tested as O(1) `mask_get` bits). Out-of-
/// board + duplicate cells collapse (bit-set semantics; `mask_set` drops out-of-board defensively).
public fun mask_add_cells(mask: &mut vector<u64>, cells: &vector<u64>) {
  let n = cells.length();
  let mut i = 0;
  while (i < n) { mask_set(mask, *cells.borrow(i)); i = i + 1; };
}

/// A fresh MASK_WORDS-word bitmask holding exactly the cells in `cells`. Membership then costs one shift+and
/// (`mask_get` — the O(1) `contains` test) instead of an O(|cells|) linear scan. The single constructor the BFS
/// wall sets + `visited` masks are built through (gas-diet #1: kills ~400K vector-element reads per BFS).
public fun mask_from_cells(cells: &vector<u64>): vector<u64> {
  let mut m = empty_mask();
  mask_add_cells(&mut m, cells);
  m
}

/// Is bit `cell` set in a shape_mask? `false` for an out-of-board cell OR an empty/short mask (train-3 tolerance:
/// a stored-but-empty mask reads as "no shape" so a reader can distinguish absent-mask from present-mask itself).
public fun mask_get(mask: &vector<u64>, cell: u64): bool {
  if (cell >= GRID_CELLS) return false;
  let w = cell / 64;
  if (w >= mask.length()) return false;
  (*mask.borrow(w) >> ((cell % 64) as u8)) & 1 == 1
}

/// D75 walkable-by-SHAPE: is `cell` inside the room's stored mask? (The full walkability check also excludes
/// obstacles/holes — that composition lives on the Dungeon's `move_blocked_cells`, which reads this.) An EMPTY
/// mask (train-3 dungeon: no D75 shape stored) means "no mask" → the caller uses the legacy rectangle instead.
public fun on_mask(mask: &vector<u64>, cell: u64): bool { mask_get(mask, cell) }

/// Does a shape_mask hold ANY set cell? Distinguishes a present D75 mask (some bit set) from an absent one (a
/// train-3 dungeon stores an empty `vector<u64>`). The client/contract branch shape-driven vs legacy on this.
public fun mask_any(mask: &vector<u64>): bool {
  let n = mask.length();
  let mut i = 0;
  while (i < n) { if (*mask.borrow(i) != 0) return true; i = i + 1; };
  false
}

/// Fill row `y`'s cells `x ∈ [lo, hi)` into `mask` (a single contiguous run — the convexity primitive every
/// shape builder below uses). `hi` is clamped to GRID_W; `lo ≥ hi` writes nothing.
fun fill_row(mask: &mut vector<u64>, y: u64, lo: u64, hi: u64) {
  let end = if (hi > GRID_W) GRID_W else hi;
  let mut x = lo;
  while (x < end) { mask_set(mask, encode(x, y)); x = x + 1; };
}

/// RECT(w,h): the full `[0,w) × [0,h)` rectangle (today's board = RECT-shaped). Trivially row- AND column-convex.
public fun rect_mask(w: u64, h: u64): vector<u64> {
  let mut m = empty_mask();
  let mut y = 0;
  while (y < h) { fill_row(&mut m, y, 0, w); y = y + 1; };
  m
}

/// ELLIPSE(w,h): the filled axis-aligned ellipse inscribed in `[0,w) × [0,h)`. Center at half-integer
/// ((w-1)/2, (h-1)/2); a cell is IN iff `(2Δx)²·h² + (2Δy)²·w² ≤ (w·h)²` (the ellipse inequality cleared of
/// fractions — pure integer, u64-safe for w,h ≤ 19: (2·18)²·19² ≈ 468k, ×2 terms ≪ 2^64). Per row the x-span is
/// a single symmetric interval → row-convex by construction; the ellipse is column-convex by symmetry.
public fun ellipse_mask(w: u64, h: u64): vector<u64> {
  let mut m = empty_mask();
  // work in doubled coords to keep the center integral: cx2 = w-1, cy2 = h-1 (so Δx2 = 2x-cx2 is an integer).
  let cx2 = w - 1;
  let cy2 = h - 1;
  let rhs = (w * h) * (w * h); // (w·h)²
  let mut y = 0;
  while (y < h) {
    let dy2 = abs_diff(2 * y, cy2); // |2Δy|
    let ty = dy2 * dy2 * (w * w); // (2Δy)²·w²
    // widen the row to the largest contiguous x-interval satisfying the inequality (single run — convex).
    let mut lo = w; // sentinel "empty"
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

/// ROUNDED(w,h,r): RECT(w,h) with the four corners bevelled by a quarter-ellipse of radius `r` (r ≤ min(w,h)/3).
/// A corner cell is REMOVED iff it lies within `r` of a corner along BOTH axes AND falls outside that corner's
/// quarter-ellipse. Per row, only the two ENDS are trimmed (top/bottom r rows) → the row stays one contiguous
/// run `[lo,hi)`; symmetric ⇒ column-convex. r==0 degenerates to RECT.
public fun rounded_mask(w: u64, h: u64, r: u64): vector<u64> {
  if (r == 0) return rect_mask(w, h);
  let mut m = empty_mask();
  let arc = (r - 1) * (r - 1); // keep the corner quarter-arc of radius (r-1): at r=1 only the extreme cell drops.
  let mut y = 0;
  while (y < h) {
    // vertical distance INTO a corner band (0 outside the band): top r rows → (r-1-y), bottom r rows → (y-(h-r)).
    let in_band = y < r || y >= h - r;
    let dy = if (y < r) { r - 1 - y } else if (y >= h - r) { y - (h - r) } else { 0 };
    // trim `cut` cells off EACH end where the quarter-arc excludes them: a rim offset dx (k cells in) is cut iff
    // dx² + dy² > (r-1)². Contiguous from the rim inward, so `cut` is a single prefix ⇒ the row stays one run.
    let mut cut = 0;
    if (in_band) {
      let mut k = 0;
      while (k < r) {
        let dx = r - 1 - k; // horizontal distance into the corner (k cells in from the rim)
        if (dx * dx + dy * dy > arc) { cut = k + 1; } else break;
        k = k + 1;
      };
    };
    fill_row(&mut m, y, cut, w - cut);
    y = y + 1;
  };
  m
}

/// Cells cut from ONE horizontal end of row `y` by a quarter-arc corner of radius `r`. `top` = the corner is in
/// the TOP band (rows [0,r), vertical depth r-1-y) vs the BOTTOM band (rows [h-r,h), depth y-(h-r)). 0 outside
/// the band or r==0. Mirrors rounded_mask's per-end prefix cut (dx²+dy² > (r-1)² ⇒ cut). Contiguous prefix ⇒
/// the row stays one run.
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

/// BLOB(w,h,r_tl,r_tr,r_bl,r_br): a rounded rectangle with FOUR INDEPENDENT corner radii — an ASYMMETRIC, organic
/// playable region (never a square blob). Each corner is bevelled by its own quarter-arc (the SAME
/// arc math as rounded_mask); different radii per corner make the perimeter irregular. Per row the left inset =
/// max(top-left cut, bottom-left cut) — a monotone "valley" (top cut falls, bottom cut rises; the two bands are
/// disjoint since each r ≤ min(w,h)/3) — and the right inset a "hill", so every ROW and every COLUMN is one run ⇒
/// orthogonally convex (connectivity by construction, same as the other shapes). left+right insets ≤ 2·min(w,h)/3
/// < w ⇒ every row keeps ≥ w/3 cells (never empty).
public fun blob_mask(w: u64, h: u64, r_tl: u64, r_tr: u64, r_bl: u64, r_br: u64): vector<u64> {
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

/// CROSS(w,h): a plus made of a horizontal bar (rows `[ry0,ry1)` × full width) ∪ a vertical bar (full height ×
/// cols `[cx0,cx1)`). Both bars are ≥3 wide and share the center band. Per row: a horizontal-bar row = `[0,w)`,
/// any other row = `[cx0,cx1)` — ONE run either way; column-symmetric ⇒ column-convex. The generator picks the
/// bar bands centered, ≥3 thick (so the "≥3-row shared band" holds and the interior min-dim ≥3 guards the king
/// proof).
public fun cross_mask(w: u64, h: u64, ry0: u64, ry1: u64, cx0: u64, cx1: u64): vector<u64> {
  let mut m = empty_mask();
  let mut y = 0;
  while (y < h) {
    if (y >= ry0 && y < ry1) { fill_row(&mut m, y, 0, w); }        // horizontal-bar row → full width
    else { fill_row(&mut m, y, cx0, cx1); };                        // vertical-bar-only row → center columns
    y = y + 1;
  };
  m
}

/// KING-MOVE ISOLATION (the safety core): may a blocker (obstacle/hole) be placed at `cand`? Yes iff `cand` is
/// ON the mask, is ≥1 cell INSIDE the mask rim (its full 8-ring is on-mask — so it never seals a boundary
/// pocket), and NO already-placed `blocked` cell lies within Chebyshev distance 1 (orthogonal AND diagonal
/// adjacency banned — the review's sealed-diamond class: four pairwise-DIAGONAL blockers can wall an orthogonal
/// path, so the whole Chebyshev-1 class is excluded). With every blocker's 8-ring on-mask and no two blockers
/// king-adjacent, no watertight blocked curve can form in an orthogonally-convex region ⇒ connectivity BY
/// CONSTRUCTION, zero flood-fill. `blocked` is the already-committed obstacle∪hole set.
public fun blocker_placeable(mask: &vector<u64>, blocked: &vector<u64>, cand: u64): bool {
  if (!mask_get(mask, cand)) return false;
  let x = cell_x(cand);
  let y = cell_y(cand);
  // rim margin: the candidate's whole 8-ring must be on-mask (guards edge pockets + keeps the arc argument).
  if (x == 0 || y == 0 || x + 1 >= GRID_W || y + 1 >= GRID_H) return false;
  let mut dy = 0;
  while (dy < 3) {
    let ny = y + dy - 1; // y-1 .. y+1
    let mut dx = 0;
    while (dx < 3) {
      let nx = x + dx - 1; // x-1 .. x+1
      let ring = encode(nx, ny);
      if (!mask_get(mask, ring)) return false;            // 8-ring must be walkable-by-shape
      if (ring != cand && blocked.contains(&ring)) return false; // Chebyshev-1 ban vs existing blockers
      dx = dx + 1;
    };
    dy = dy + 1;
  };
  true
}

/// CHEBYSHEV distance (open chessboard, king-moves): max(|Δx|, |Δy|).
public fun cheby(a: u64, b: u64): u64 {
  let dx = abs_diff(cell_x(a), cell_x(b));
  let dy = abs_diff(cell_y(a), cell_y(b));
  if (dx > dy) dx else dy
}

/// Greedy king-step approach toward `to_cell`, up to `budget` steps, STOPPING adjacent (Chebyshev 1) so the mob
/// never lands on the target's cell. Deterministic given the budget; the budget is the Random-driven part.
public fun approach(from_cell: u64, to_cell: u64, budget: u64): u64 {
  let mut x = cell_x(from_cell);
  let mut y = cell_y(from_cell);
  let tx = cell_x(to_cell);
  let ty = cell_y(to_cell);
  let mut steps = 0;
  while (steps < budget) {
    let dx = abs_diff(x, tx);
    let dy = abs_diff(y, ty);
    let cur = if (dx > dy) dx else dy;
    if (cur <= 1) break; // adjacent → stop (don't occupy the target)
    if (x < tx) { x = x + 1 } else if (x > tx) { x = x - 1 };
    if (y < ty) { y = y + 1 } else if (y > ty) { y = y - 1 };
    steps = steps + 1;
  };
  encode(x, y)
}

/// MANHATTAN distance (4-directional grid, no diagonals — Phase-2a dungeon movement law): |Δx| + |Δy|.
public fun manhattan(a: u64, b: u64): u64 {
  abs_diff(cell_x(a), cell_x(b)) + abs_diff(cell_y(a), cell_y(b))
}

/// §387 — are `a` and `b` on the SAME straight cardinal line (a shared row OR column)? The spellbook LINE class may
/// only aim along a cardinal line from the attacker.
public fun same_axis(a: u64, b: u64): bool {
  cell_x(a) == cell_x(b) || cell_y(a) == cell_y(b)
}

/// Greedy 4-DIRECTIONAL (N/S/E/W only, no diagonals) approach toward `to_cell`, up to `budget` steps, STOPPING as
/// soon as Manhattan distance <= 1 (adjacent — never land on the target's own cell). Mirrors `approach`'s
/// structure exactly but reduces Manhattan distance instead of Chebyshev: each step moves exactly ONE cell along
/// a single axis, reducing |Δx|+|Δy| by 1 — the LARGER of |Δx|/|Δy| is reduced first (deterministic tie-break:
/// equal → reduce x first). Deterministic given the budget; the budget is the Random-driven part.
public fun approach_manhattan(from_cell: u64, to_cell: u64, budget: u64): u64 {
  let mut x = cell_x(from_cell);
  let mut y = cell_y(from_cell);
  let tx = cell_x(to_cell);
  let ty = cell_y(to_cell);
  let mut steps = 0;
  while (steps < budget) {
    let dx = abs_diff(x, tx);
    let dy = abs_diff(y, ty);
    if (dx + dy <= 1) break; // adjacent (or already there) → stop (don't occupy the target)
    if (dx >= dy) {
      if (x < tx) { x = x + 1 } else if (x > tx) { x = x - 1 };
    } else {
      if (y < ty) { y = y + 1 } else if (y > ty) { y = y - 1 };
    };
    steps = steps + 1;
  };
  encode(x, y)
}

/// FIXED damage — the spell pipeline with the per-cast RNG pinned out. raw range → DETERMINISTIC midpoint →
/// +1%/level → target's element resistance. REUSES spell's pure helpers; never draws prng (no `roll_damage`).
public fun fixed_damage(
  element: u8,
  smin: u64,
  smax: u64,
  caster: &Stats,
  target: &Stats,
  caster_level: u64,
): u64 {
  let (rmin, rmax) = spell::calculate_raw_damage(element, smin, smax, caster);
  let mid = (rmin + rmax) / 2; // PIN — zero variance (no roll_damage, crit off)
  let scaled = spell::apply_level_scaling(mid, caster_level);
  spell::apply_resistance(scaled, element, target)
}

// ╔════════════════ [ Line of sight — integer-only 1.29 reference shadow-casting ] ══════════════════════════ ]

/// LINE OF SIGHT — an EXACT, integer-only adaptation of 1.29 reference shadow-casting (HydreIO's 1.29 protocol reference
/// `ShadowCasting.getAccesibleCells`) to this square board. Returns
/// true iff NO obstacle in `obstacles` occludes the straight sight line from `from` to `to`. The reference's
/// rotated (isometric) coordinates are only its diamond-storage adapter; its occlusion math runs on a plain
/// square grid identical to ours (cell = y*GRID_W + x), so the algorithm ports directly. Every floating-point
/// slope comparison is replaced by an integer cross-multiplication (Move has no floats — and this permanently
/// kills the T14 float-LOS bug). Proven verdict-equivalent to the reference over 166,983 (origin,obstacle,
/// target) triples — corners, diagonals, axis-aligned, adjacent, multi-obstacle, 0 mismatches (proof harness
/// in workspace/cto/los_equivalence.py). The client (WS-C) MUST port this SAME function 1:1 (replacing the
/// legacy float LOS telegraph in sim/visibility.js), so contract-side and display-side LOS can never diverge.
/// MVP rooms ship with no obstacles (empty vector → trivially true), but the primitive is fully built + tested
/// with obstacles for the obstacle-bearing rooms that follow.
public fun line_of_sight(from: u64, to: u64, obstacles: &vector<u64>): bool {
  let n = obstacles.length();
  let mut i = 0;
  while (i < n) {
    if (blocks(from, *obstacles.borrow(i), to)) return false;
    i = i + 1;
  };
  true
}

/// Does obstacle `b` occlude target `t` seen from origin `o`? The per-cell shadow-wedge test extracted from
/// `castShadow`: a target cell is shadowed iff its center-slope falls inside the obstacle's half-cell wedge
/// (slope1 = (2ax-1)/(2ay+1) near edge, slope2 = (2ax+1)/(2ay-1) far edge) on the obstacle's side of the
/// origin, beyond the obstacle. `castShadow`'s flag/scan optimization only skips cells the slope test already
/// excludes (candidate slope cx/cy is monotonic in cx), so this pure per-cell test is exactly equivalent.
/// Integer-only via cross-multiplication; axis cases (ax==0 / ay==0, where an edge slope degenerates) handled
/// explicitly, mirroring the reference's `getSlope(_,0)=99` sentinel and its `(slope2<0 && cx>x)` branch.
fun blocks(o: u64, b: u64, t: u64): bool {
  if (b == o || b == t) return false; // origin & target cells never self-occlude (matches getAccesibleCells)
  let ox = cell_x(o); let oy = cell_y(o);
  let bx = cell_x(b); let by = cell_y(b);
  let tx = cell_x(t); let ty = cell_y(t);
  let ax = abs_diff(bx, ox); let ay = abs_diff(by, oy); // obstacle |Δ| from origin
  let cx = abs_diff(tx, ox); let cy = abs_diff(ty, oy); // target   |Δ| from origin
  // Side/mirror check: the shadow reflects into the obstacle's quadrant; an axis obstacle casts to both sides.
  // A target on the opposite x/y side of the origin from the obstacle can never be in its shadow.
  if (bx != ox && ((bx >= ox) != (tx >= ox))) return false;
  if (by != oy && ((by >= oy) != (ty >= oy))) return false;
  // Candidate domain: castShadow scans cx>=ax, cy>=ay; the obstacle's own cell (cx==ax && cy==ay) isn't shadow.
  if (cx < ax || cy < ay) return false;
  if (cx == ax && cy == ay) return false;
  // slope > slope1, slope1 = (2ax-1)/(2ay+1). cy==0 → candidate slope is +inf (> slope1). ax==0 → (2ax-1) is
  // negative so RHS ≤ 0 ≤ LHS → always true. Otherwise cross-multiply (all terms positive, u64-safe).
  let s_gt_s1 = if (ax == 0 || cy == 0) true else cx * (2 * ay + 1) > (2 * ax - 1) * cy;
  if (!s_gt_s1) return false;
  // ay==0 → slope2 = (2ax+1)/(2ay-1) is negative → reference's (slope2<0 && cx>x) branch: on the obstacle's
  // own row, everything strictly beyond the obstacle along x is shadowed (x = bx-ox signed; a -x-side obstacle
  // shadows the whole -x side since cx > negative is always true).
  if (ay == 0) return if (bx < ox) true else cx > ax;
  // ay>=1 → 2ay-1>=1. cy==0 → candidate slope +inf, not < slope2 → not shadowed. Else cross-multiply.
  if (cy == 0) return false;
  cx * (2 * ay - 1) < (2 * ax + 1) * cy
}

// ╔════════════════ [ #55 AoE ZONE GEOMETRY (ruling 3 — real cross/line/tbar/ring, replaces the lozenge POC) ] ═ ]
// Shape codes MIRROR `spell_effect::shape_*`. Two entry points: `in_zone` answers containment for the
// DIRECTION-INDEPENDENT shapes (point/circle/cross/ring/allmap — used by placed traps/glyphs which store no cast
// direction), and `zone_cells` enumerates every in-grid cell of a zone INCLUDING the direction-dependent
// line/tbar (the instantaneous cast knows the caster→anchor line). Manhattan (4-dir) metric throughout,
// consistent with dungeon movement.

/// Direction codes for cardinal stepping. 0=+x, 1=-x, 2=+y, 3=-y, 255 = none (from==to).
const DIR_NONE: u8 = 255;
public fun dir_none(): u8 { DIR_NONE }

/// Dominant-axis cardinal direction pointing FROM `pivot` TOWARD `subject` — the push-AWAY direction (pivot =
/// caster, subject = the pushed fighter). Tie (|Δx|==|Δy|) breaks to the x axis, matching `approach_manhattan`.
/// `DIR_NONE` when the two cells coincide.
public fun away_dir(pivot: u64, subject: u64): u8 {
  let px = cell_x(pivot); let py = cell_y(pivot);
  let sx = cell_x(subject); let sy = cell_y(subject);
  let adx = abs_diff(sx, px); let ady = abs_diff(sy, py);
  if (adx == 0 && ady == 0) return DIR_NONE;
  if (adx >= ady) { if (sx >= px) 0 else 1 } else { if (sy >= py) 2 else 3 }
}

/// The pull-TOWARD direction (opposite of `away_dir`).
public fun toward_dir(pivot: u64, subject: u64): u8 { opposite_dir(away_dir(pivot, subject)) }

fun opposite_dir(dir: u8): u8 {
  if (dir == 0) 1 else if (dir == 1) 0 else if (dir == 2) 3 else if (dir == 3) 2 else DIR_NONE
}

/// Step one cell in `dir`; `none` if that would leave the grid (a wall) or `dir == DIR_NONE`.
public fun step_cell(cell: u64, dir: u8): Option<u64> {
  let x = cell_x(cell); let y = cell_y(cell);
  if (dir == 0) { if (x + 1 < GRID_W) option::some(encode(x + 1, y)) else option::none() }
  else if (dir == 1) { if (x >= 1) option::some(encode(x - 1, y)) else option::none() }
  else if (dir == 2) { if (y + 1 < GRID_H) option::some(encode(x, y + 1)) else option::none() }
  else if (dir == 3) { if (y >= 1) option::some(encode(x, y - 1)) else option::none() }
  else option::none()
}

/// Containment for the DIRECTION-INDEPENDENT shapes (point/circle/cross/ring/allmap) — EXACT (no lozenge
/// approximation). LINE/TBAR need the cast direction, which a placed board zone does not store, so they fall
/// back to the filled lozenge here (flagged — the census's placed zones are point/circle; instantaneous
/// line/tbar go through `zone_cells`).
public fun in_zone(shape: u8, size: u64, anchor: u64, cell: u64): bool {
  if (!in_grid(cell)) return false;
  if (shape == spell_effect::shape_point()) return cell == anchor;
  if (shape == spell_effect::shape_allmap()) return true;
  let d = manhattan(anchor, cell);
  if (shape == spell_effect::shape_ring()) return d == size;
  if (shape == spell_effect::shape_cross()) {
    return d <= size && (cell_x(cell) == cell_x(anchor) || cell_y(cell) == cell_y(anchor))
  };
  // circle + line/tbar fallback = filled lozenge.
  d <= size
}

/// Every in-grid cell of a `(shape, size)` zone anchored at `anchor`, cast from `caster` (the direction source
/// for line/tbar). O(GRID_CELLS) for the isotropic shapes (bounded 100, cheap); explicit walk for line/tbar.
public fun zone_cells(shape: u8, size: u64, anchor: u64, caster: u64): vector<u64> {
  if (shape == spell_effect::shape_point()) return vector[anchor];
  if (shape == spell_effect::shape_line()) return line_cells(anchor, caster, size);
  if (shape == spell_effect::shape_tbar()) return tbar_cells(anchor, caster, size);
  if (shape == spell_effect::shape_podium()) return podium_cells(anchor, caster, size);
  if (shape == spell_effect::shape_cone()) return cone_cells(anchor, caster, size);
  // circle / cross / ring / allmap — scan the board.
  let mut out = vector[];
  let mut c = 0;
  while (c < GRID_CELLS) {
    if (in_zone(shape, size, anchor, c)) out.push_back(c);
    c = c + 1;
  };
  out
}

/// LINE: `anchor` + up to `size` cells continuing along the caster→anchor line (dominant axis), stopping at the
/// grid edge.
fun line_cells(anchor: u64, caster: u64, size: u64): vector<u64> {
  let dir = away_dir(caster, anchor); // extend away from the caster, past the anchor
  let mut out = vector[anchor];
  let mut cur = anchor;
  let mut k = 0;
  while (k < size) {
    let nxt = step_cell(cur, dir);
    if (nxt.is_none()) break;
    cur = nxt.destroy_some();
    out.push_back(cur);
    k = k + 1;
  };
  out
}

/// TBAR: a bar PERPENDICULAR to the caster→anchor line, `size` cells each way from `anchor` (half-length size).
fun tbar_cells(anchor: u64, caster: u64, size: u64): vector<u64> {
  let along = away_dir(caster, anchor);
  // perpendicular axis: a horizontal line (±x) → vertical bar (±y); a vertical line → horizontal bar.
  let (perp_a, perp_b) = if (along == 0 || along == 1 || along == DIR_NONE) (2u8, 3u8) else (0u8, 1u8);
  let mut out = vector[anchor];
  out.append(walk(anchor, perp_a, size));
  out.append(walk(anchor, perp_b, size));
  out
}

/// PODIUM (#387 — battleaxe / mace / hammer): the TBAR front-arc AT `anchor` PLUS one cell BEYOND `anchor` along
/// the strike axis (caster→anchor). At `size` 1 it touches exactly 4 cells. With the attacker at `A` striking the
/// target `T` to the east (caster→anchor = +x), the touched set (`#`) is:
///
///        . P .            P = anchor + perpendicular (tbar half-length `size`, both ways)
///     A  T F .            T = anchor (the aimed cell)     F = anchor + strike-dir (the "beyond" stem)
///        . P .            A = attacker (never hit)
///
/// = tbar_cells(anchor, caster, size) ∪ { step_cell(anchor, away_dir(caster, anchor)) }. The forward stem drops
/// off-grid cells (Option). `caster == anchor` (no direction) degenerates to the tbar/point set, same as line/tbar.
fun podium_cells(anchor: u64, caster: u64, size: u64): vector<u64> {
  let mut out = tbar_cells(anchor, caster, size);
  let fwd = step_cell(anchor, away_dir(caster, anchor));
  if (fwd.is_some()) out.push_back(fwd.destroy_some());
  out
}

/// CONE: a triangle fanning FROM the caster TOWARD `anchor` (the aimed cell = the direction source), `size` cells
/// deep. The tip (depth 1) is a single cell in front of the caster; from depth 2 on it is 3 cells wide (the center
/// cell + one cell to each perpendicular side) — a 3-wide, `size`-deep wedge. Mirrors `line_cells`/`tbar_cells`:
/// the caster's own cell is excluded (the cone starts one step ahead); it stops at the grid edge.
fun cone_cells(anchor: u64, caster: u64, size: u64): vector<u64> {
  let dir = away_dir(caster, anchor); // fan away from the caster, through/past the aimed cell
  let (perp_a, perp_b) = if (dir == 0 || dir == 1 || dir == DIR_NONE) (2u8, 3u8) else (0u8, 1u8);
  let mut out = vector[];
  let mut center = caster;
  let mut k = 0;
  while (k < size) {
    let nxt = step_cell(center, dir);
    if (nxt.is_none()) break;
    center = nxt.destroy_some();
    out.push_back(center);
    if (k > 0) { // depth ≥ 2 widens to 3 (one cell each perpendicular side of the center)
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

// ===========================================================================
// #55 geometry tests — exact cross/line/tbar/ring vs the old lozenge, + push/pull stepping.
// ===========================================================================

#[test]
fun t_zone_point_and_circle() {
  let a = encode(5, 5);
  assert!(zone_cells(spell_effect::shape_point(), 0, a, encode(0, 0)) == vector[a], 0);
  // circle radius 1 = anchor + 4 orthogonal neighbours (interior cell → all in grid).
  assert!(zone_cells(spell_effect::shape_circle(), 1, a, encode(0, 0)).length() == 5, 1);
}

#[test]
fun t_zone_cross_is_arms_only() {
  let a = encode(5, 5);
  let cross = zone_cells(spell_effect::shape_cross(), 2, a, encode(0, 0));
  // 4 arms of length 2 + centre = 9 cells; a diagonal cell (6,6) is NOT in a cross but IS in a circle.
  assert!(cross.length() == 9, 0);
  assert!(!in_zone(spell_effect::shape_cross(), 2, a, encode(6, 6)), 1);
  assert!(in_zone(spell_effect::shape_circle(), 2, a, encode(6, 6)), 2); // circle includes the diagonal
  assert!(in_zone(spell_effect::shape_cross(), 2, a, encode(7, 5)), 3); // straight arm cell
}

#[test]
fun t_zone_ring_is_perimeter_only() {
  let a = encode(5, 5);
  assert!(in_zone(spell_effect::shape_ring(), 2, a, encode(7, 5)), 0); // manhattan 2 → on the ring
  assert!(!in_zone(spell_effect::shape_ring(), 2, a, encode(6, 5)), 1); // manhattan 1 → inside, not on ring
  assert!(!in_zone(spell_effect::shape_ring(), 2, a, a), 2); // centre not on ring
}

#[test]
fun t_zone_line_extends_away_from_caster() {
  let caster = encode(1, 5);
  let anchor = encode(3, 5); // caster→anchor points +x
  let line = zone_cells(spell_effect::shape_line(), 2, anchor, caster);
  // anchor (3,5) + (4,5) + (5,5).
  assert!(line == vector[encode(3, 5), encode(4, 5), encode(5, 5)], 0);
}

#[test]
fun t_zone_tbar_is_perpendicular() {
  let caster = encode(1, 5);
  let anchor = encode(3, 5); // horizontal cast → vertical bar
  let tbar = zone_cells(spell_effect::shape_tbar(), 1, anchor, caster);
  // anchor (3,5) + (3,6) + (3,4) in some order → 3 cells, all same x.
  assert!(tbar.length() == 3, 0);
  assert!(tbar.contains(&encode(3, 4)) && tbar.contains(&encode(3, 6)), 1);
}

#[test]
fun t_zone_cone_is_widening_wedge() {
  let caster = encode(2, 5);
  let anchor = encode(5, 5); // caster→anchor points +x → cone fans +x, widening on ±y
  let cone = zone_cells(spell_effect::shape_cone(), 3, anchor, caster);
  // depth 1 tip (3,5) is 1-wide; depths 2-3 are 3-wide → 1 + 3 + 3 = 7 cells.
  assert!(cone.length() == 7, 0);
  assert!(cone.contains(&encode(3, 5)), 1); // tip
  assert!(cone.contains(&encode(4, 5)) && cone.contains(&encode(4, 4)) && cone.contains(&encode(4, 6)), 2); // depth-2 row
  assert!(cone.contains(&encode(5, 5)) && cone.contains(&encode(5, 4)) && cone.contains(&encode(5, 6)), 3); // depth-3 row
  assert!(!cone.contains(&encode(3, 4)), 4); // tip is 1-wide — the side cell is NOT in the cone
  assert!(!cone.contains(&encode(2, 5)), 5); // the caster's own cell is excluded
  assert!(!cone.contains(&encode(6, 5)), 6); // beyond the 3-deep reach
}

#[test]
fun t_push_pull_directions_and_step() {
  let caster = encode(2, 2);
  let target = encode(4, 2); // to the +x of the caster
  assert!(away_dir(caster, target) == 0, 0); // push → +x
  assert!(toward_dir(caster, target) == 1, 1); // pull → -x
  // stepping +x from (4,2) → (5,2); stepping off the east edge → none.
  assert!(step_cell(encode(4, 2), 0) == option::some(encode(5, 2)), 2);
  assert!(step_cell(encode(19, 2), 0).is_none(), 3); // wall (D75: GRID_W=20 — east edge is x=19, not 9)
}
