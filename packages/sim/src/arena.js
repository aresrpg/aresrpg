// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Self-contained, seed-generated tactical arena — the radius-carve that ISOLATES a finite fight grid
// out of the unbounded procedural world (MVP-PLAN Phase 2).
//
// carve_world_arena(...) is a PURE INTEGER function: same inputs -> byte-identical arena on every machine.
// No floats, no Math.random, no Date.now. The real-terrain window, connectivity flood-fill, the
// playability-clearing guard, and team-split spawns are all integer math.
//
// Walkability here is TERRAIN ONLY. Live actor occupancy is NEVER baked into `cells` — the reducer ANDs
// this terrain grid with a fresh occupancy check over its actors (the #1 copy-paste trap from the plan).

import { neighbors_4dir } from './cell.js'
import { squirrel_noise_2d } from './noise.js'
import { rng_seed, rng_int } from './prng.js'
import { CELL, world_cell } from './world.js'

/**
 * Cell value in `Arena.cells`: 0 = walkable terrain, 1 = obstacle/void (out-of-disc or blocked).
 * @typedef {0 | 1} CellValue
 */

/**
 * A carved tactical arena. A finite, bounded `width*height` grid, origin (0,0) at the top-left, center at
 * `(floor(width/2), floor(height/2))`. The board is NON-SQUARE: width and height are rolled INDEPENDENTLY
 * per fight (width != height), so the grid is row-major over `width` columns by `height` rows. Walkable iff
 * real FLOOR terrain (the real-terrain window), and connected to the center.
 * @typedef {object} Arena
 * @property {number} width      grid column count (rolled per fight)
 * @property {number} height     grid row count (rolled INDEPENDENTLY of width — the board is non-square)
 * @property {number} radius     horizontal half-extent (`floor(width/2)`) — cosmetic fight-state metadata
 * @property {import('./cell.js').Cell} center  the center cell `(floor(width/2), floor(height/2))`
 * @property {Uint8Array} cells  row-major `width*height` terrain (0 walkable, 1 obstacle/void)
 * @property {import('./cell.js').Cell[]} spawns_a  team-A spawn cells (disjoint from spawns_b)
 * @property {import('./cell.js').Cell[]} spawns_b  team-B spawn cells (disjoint from spawns_a)
 */

const WALKABLE = 0
const OBSTACLE = 1

// --- the board bounds ARE the real-terrain window ----------------------------------------------------
// The fight board is the REAL deterministic terrain window around the encounter anchor: a cell is walkable iff
// its `world_cell` is FLOOR (the same predicate the reducer + roam use), connected to the center. There is NO
// synthetic boundary mask — the playable area is the spot's ACTUAL walkable terrain, so the board is an organic
// window of real terrain (open plains carve a full rectangle of real FLOOR; forest/water carve an irregular
// edge + interior). The prior inscribed-ELLIPSE "never a clean square" mask is GONE in favor of the
// genuine terrain window, not a featureless synthetic diamond.
//
// PLAYABILITY GUARD (the degenerate-window fallback). A FLOOR-starved window — a fight anchored on a lone FLOOR
// cell amid water/forest, ~19% of FLOOR anchors (see arena.test.js) — would carve too few connected cells to
// seat two teams, which must NEVER ship. When the connected walkable count falls below the area-scaled
// MIN_FIGHT_CELLS floor we deterministically force a MINIMAL centered CLEARING: a growing integer disc of
// forced-walkable cells (unioned with the real FLOOR) until the connected core is big enough — a "battle
// clearing", NOT the old ellipse mask. Integer-only (dx²+dy² ≤ clear²); same inputs → same clearing radius, so
// the carve stays byte-identical server↔client.
// Minimum CONNECTED walkable cells the guard guarantees, tuned at the REFERENCE 13x13 board to 48 and scaled to
// the rolled board AREA by `min_fight_cells` (so the floor tracks every board size). The common open/forest
// window clears this from real FLOOR alone (no clearing forced); only terrain-starved spots grow the clearing.
const MIN_FIGHT_CELLS = 48
const REF_AREA = 13 * 13 // the reference board area MIN_FIGHT_CELLS was tuned against

// --- deterministic-random board SIZE: VARIED, NON-SQUARE (#30) -----------------------------------------------
// A FIXED window plays TOO BIG, and a SQUARE board (the superseded `2r+1` roll) is monotonous. width and height
// are now rolled INDEPENDENTLY from the fight seed, so every encounter gets a different — but REPLAYABLE —
// compact RECTANGLE: same seed → same dims on server (authority) and client (prediction), byte-identical.
// Integer-only (two stateless position-hash draws, no floats / Math.random / Date.now). width ∈ [W_MIN..W_MAX],
// height ∈ [H_MIN..H_MAX], decorrelated salts so width != height (e.g. 10x10, 12x7, 18x24). Clamped to the
// caller's `max_radius` (a safety upper bound on either dimension, 2*max_radius+1).
const W_MIN = 10
const W_MAX = 18
const H_MIN = 7
const H_MAX = 24
const W_SALT = 0x5126e // distinct salt for the width field (decorrelated from boundary/terrain/height)
const H_SALT = 0x6d3b9 // distinct salt for the height field (decorrelated from the width field)

/**
 * Roll deterministic, INDEPENDENT board dimensions from the fight seed: width ∈ [W_MIN..W_MAX], height ∈
 * [H_MIN..H_MAX], each clamped to the caller's `max_radius` safety bound (2*max_radius+1). Pure integer: two
 * stateless position-hash draws bucketed across each span — same (fight_seed, world_seed) → same dims on every
 * machine, so the server's carve and the client's re-carve agree by construction. width != height by design.
 * @param {number} fight_seed  the per-fight determinism root (carve_world_arena's rng_seed)
 * @param {number} world_seed  overworld terrain seed (decorrelates the size fields from the spawn split)
 * @param {number} max_radius  caller's upper safety bound on either dimension (clamps to 2*max_radius+1)
 * @returns {{ width: number, height: number }}
 */
const roll_dims = (fight_seed, world_seed, max_radius) => {
  const cap = 2 * (max_radius | 0) + 1
  const fs = fight_seed | 0
  const ws = world_seed | 0
  const w = W_MIN + (squirrel_noise_2d(fs, W_SALT, ws) % (W_MAX - W_MIN + 1))
  const h = H_MIN + (squirrel_noise_2d(fs, H_SALT, ws) % (H_MAX - H_MIN + 1))
  return { width: w < cap ? w : cap, height: h < cap ? h : cap }
}

/**
 * The MIN_FIGHT_CELLS floor scaled to the rolled board AREA (the reference 13x13 board's tuned 48): smaller
 * boards scale the floor DOWN proportionally to width*height so the organic boundary trim is preserved at every
 * size (a small board would otherwise force-relax the bite to a clean ellipse to meet a too-high fixed floor).
 * Pure integer (truncating divide; 13x13 → exactly 48).
 * @param {number} width @param {number} height @returns {number}
 */
const min_fight_cells = (width, height) =>
  ((MIN_FIGHT_CELLS * width * height) / REF_AREA) | 0

// How many spawn cells to reserve per team (by design: 6 starting positions/side; the board has ample
// walkable cells/side so 6 fits easily, and pick_spawn_sets clamps to the available count if a carve is tight).
const SPAWNS_PER_TEAM = 6

/**
 * Index into the row-major `cells` array. Caller guarantees in-bounds.
 * @param {number} width
 * @param {number} x
 * @param {number} y
 * @returns {number}
 */
const idx = (width, x, y) => y * width + x

/**
 * Carve a tactical arena from the REAL overworld terrain window centered on a fixed anchor — the
 * load-bearing "fight board = real terrain" change (memory: koshi-fight-board-from-terrain). Instead of
 * a procedural disc, the obstacle grid is the ACTUAL `world_cell(world_seed, …)` terrain
 * the roam scene renders, so the board carries the real obstacles of the spot the encounter happened on.
 *
 * The window is a `width*height` rectangle (dims rolled per fight) whose CENTER cell (cx, cy) maps to the world
 * anchor `(anchor_x, anchor_y)`; local cell `(lx, ly)` maps to world `(anchor_x - cx + lx, anchor_y - cy + ly)`.
 * A cell is WALKABLE iff its `world_cell` is FLOOR (OBSTACLE/HOLE/WATER all block movement — the same predicate
 * the sim reducer + roam use), connected to the center; the center is forced walkable so the flood-fill always
 * has a seed even if the anchor itself isn't FLOOR. The BOUNDS ARE THE REAL TERRAIN WINDOW: there is
 * NO synthetic boundary mask, so the playable shape is the spot's genuine walkable terrain — a full rectangle of
 * real FLOOR on open plains, an irregular terrain-shaped blob in forest/near water. An obstacle cell (value 1)
 * is a real non-FLOOR world cell or a flood-fill pocket; the client renders the real, untouched world terrain
 * everywhere a board cell is non-walkable, so there are no "holes" — just forest the tactical grid does not cover.
 *
 * PLAYABILITY GUARD: a FLOOR-starved window (anchored on a lone FLOOR cell amid water/forest) would carve too
 * few connected cells to seat two teams — never shippable. When the connected walkable count falls below the
 * area-scaled MIN_FIGHT_CELLS floor we deterministically force a MINIMAL centered CLEARING (a growing integer
 * disc, unioned with the real FLOOR) until the core is big enough (a "battle clearing", never the old ellipse).
 *
 * After stamping we (1) BFS flood-fill from the center and demote unreachable FLOOR pockets to obstacle (no
 * off-island spawns), then (2) team-split the connected region into disjoint spawn sets with the seeded PRNG
 * (the robust `split_teams_poles` so a lopsided terrain region never empties a team).
 *
 * PURE + deterministic: integer-only, seeded PRNG, no floats / Math.random / Date.now. Same
 * (world_seed, anchor, radius, rng_seed) → byte-identical Arena on every machine, so the server's carve
 * and the client's authoritative-cells render agree by construction.
 *
 * @param {number} world_seed  overworld terrain seed (WORLD_SEED) — the SAME seed the roam scene streams
 * @param {number} anchor_x    world cell x of the group's FIXED anchor (window center)
 * @param {number} anchor_y    world cell y of the group's FIXED anchor (window center)
 * @param {number} max_radius  MAX window half-extent (cells); the actual width/height are ROLLED INDEPENDENTLY
 *                             from `rng_seed` (width ∈ [10..18], height ∈ [7..24]), each clamped to 2*max_radius+1
 * @param {number} rng_seed    the per-fight seed: seeds BOTH the size roll AND the deterministic spawn-set split
 * @returns {Arena}
 */
export const carve_world_arena = (
  world_seed,
  anchor_x,
  anchor_y,
  max_radius,
  rng_seed,
) => {
  const ws = world_seed | 0
  // Deterministic-random, NON-SQUARE board size: roll width + height INDEPENDENTLY from the fight seed, so each
  // encounter gets a compact but REPLAYABLE rectangle. arena.width/.height carry the rolled size → the wire
  // (board_width + borders) + client + harness follow it (no fixed/square dimension anywhere).
  const { width, height } = roll_dims(rng_seed, ws, max_radius)
  const ax = anchor_x | 0
  const ay = anchor_y | 0
  const cx = width >> 1 // center column (floor(width/2))
  const cy = height >> 1 // center row (floor(height/2))
  const center = { x: cx, y: cy }
  const origin_x = ax - cx
  const origin_y = ay - cy

  // Stamp the real-terrain window at forced-clearing radius `clear` (clear=0 → pure terrain, the normal case),
  // then BFS flood-fill from center (demote unreachable pockets) and return the carved cells + the CONNECTED
  // walkable count. WALKABLE iff real FLOOR terrain OR inside the forced clearing disc (`clear>0` only — the
  // degenerate-window guard) OR the center (always forced so the flood-fill has a seed). The flood-fill count is
  // the true playable area. Integer-only (dx²+dy² ≤ clear²).
  const stamp_and_flood = clear => {
    const clear2 = clear * clear
    const cells = new Uint8Array(width * height).fill(OBSTACLE)
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const dx = x - cx
        const dy = y - cy
        const forced = clear > 0 && dx * dx + dy * dy <= clear2
        if (
          (dx === 0 && dy === 0) ||
          forced ||
          world_cell(ws, origin_x + x, origin_y + y) === CELL.FLOOR
        )
          cells[idx(width, x, y)] = WALKABLE
      }
    const reachable = new Uint8Array(width * height)
    reachable[idx(width, center.x, center.y)] = 1
    let frontier = [center]
    let count = 1
    while (frontier.length > 0) {
      const next = []
      for (const cell of frontier)
        for (const { x, y } of neighbors_4dir(cell)) {
          if (x < 0 || y < 0 || x >= width || y >= height) continue
          const i = idx(width, x, y)
          if (reachable[i] || cells[i] !== WALKABLE) continue
          reachable[i] = 1
          count++
          next.push({ x, y })
        }
      frontier = next
    }
    for (let i = 0; i < cells.length; i++)
      if (cells[i] === WALKABLE && !reachable[i]) cells[i] = OBSTACLE
    return { cells, count }
  }

  // PLAYABILITY GUARD: keep the pure real-terrain window when it has room (the common case); only a FLOOR-starved
  // window grows the forced clearing — the smallest centered disc that reaches the area-scaled floor, bounded by
  // the inscribed radius min(cx, cy) (which fully clears the short axis). Deterministic loop, best-effort: a spot
  // with too little FLOOR even at the full clearing takes what the clearing + real FLOOR give it.
  const min_cells = min_fight_cells(width, height)
  const max_clear = cx < cy ? cx : cy
  let carved = stamp_and_flood(0)
  for (let clear = 1; clear <= max_clear && carved.count < min_cells; clear++)
    carved = stamp_and_flood(clear)
  const { cells } = carved

  // team-split + spawn selection over the connected walkable region. The ROBUST pole-split (not the procedural
  // axis-split) so a lopsided organic+terrain region never empties a team's spawn set.
  const { spawns_a, spawns_b } = split_teams_poles(
    width,
    height,
    cells,
    rng_seed | 0,
  )

  return { width, height, radius: cx, center, cells, spawns_a, spawns_b }
}

/**
 * Collect every connected walkable cell (the carve already removed pockets), in row-major order.
 * @param {number} width
 * @param {number} height
 * @param {Uint8Array} cells
 * @returns {import('./cell.js').Cell[]}
 */
const walkable_cells = (width, height, cells) => {
  const result = []
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      if (cells[idx(width, x, y)] === WALKABLE) result.push({ x, y })
  return result
}

/**
 * Draw disjoint spawn sets per side via the seeded PRNG (replaces the donor's Alea + Math.floor float picks).
 * One rng thread is shared across both draws so the two sets are independent yet reproducible. Shared by both
 * splits (the procedural axis-split + the terrain pole-split) so spawn picks stay identical + deterministic.
 * @param {import('./cell.js').Cell[]} side_a @param {import('./cell.js').Cell[]} side_b @param {number} seed
 * @returns {{ spawns_a: import('./cell.js').Cell[], spawns_b: import('./cell.js').Cell[] }}
 */
const pick_spawn_sets = (side_a, side_b, seed) => {
  let rng = rng_seed(seed)
  const pick = pool => {
    const taken = []
    const remaining = pool.slice()
    const count = Math.min(SPAWNS_PER_TEAM, remaining.length)
    for (let n = 0; n < count; n++) {
      const draw = rng_int(rng, remaining.length)
      rng = draw.state
      taken.push(remaining[draw.value])
      // swap-remove so the same cell is never drawn twice (keeps each set internally disjoint)
      remaining[draw.value] = remaining[remaining.length - 1]
      remaining.pop()
    }
    return taken
  }
  return { spawns_a: pick(side_a), spawns_b: pick(side_b) }
}

/**
 * Robust team-split for the TERRAIN carve: partition the connected walkable region by its two extreme "poles"
 * so BOTH teams always get cells whenever ≥2 walkable cells exist. The terrain window's shape is FIXED (unlike
 * the procedural carve it cannot re-roll a lopsided region), so the axis-split — which can dump every cell on
 * one side when the center sits at the region's edge (the organic boundary makes lopsided regions common) — is
 * replaced here by a pole-split that cannot empty a side. Pole A = the walkable cell farthest from center;
 * pole B = the cell farthest from A (the two extremes); every cell joins its nearer pole (ties → A), so A
 * always contains pole A and B always contains pole B. Spawns are drawn per side with the SAME seeded picker
 * so picks stay deterministic + disjoint. Pure integer (squared distances; no floats).
 * @param {number} width @param {number} height @param {Uint8Array} cells @param {number} seed
 * @returns {{ spawns_a: import('./cell.js').Cell[], spawns_b: import('./cell.js').Cell[] }}
 */
const split_teams_poles = (width, height, cells, seed) => {
  const walkable = walkable_cells(width, height, cells)
  if (walkable.length < 2) return { spawns_a: walkable.slice(), spawns_b: [] }
  const cx = width >> 1 // center column (floor(width/2))
  const cy = height >> 1 // center row (floor(height/2))
  const d2 = (a, b) => {
    const dx = a.x - b.x
    const dy = a.y - b.y
    return dx * dx + dy * dy
  }
  const farthest = from => {
    let [best] = walkable
    let best_d2 = -1
    for (const cell of walkable) {
      const v = d2(cell, from)
      if (v > best_d2) {
        best_d2 = v
        best = cell
      }
    }
    return best
  }
  const pole_a = farthest({ x: cx, y: cy })
  const pole_b = farthest(pole_a)
  const side_a = []
  const side_b = []
  for (const cell of walkable)
    (d2(cell, pole_a) <= d2(cell, pole_b) ? side_a : side_b).push(cell)
  return pick_spawn_sets(side_a, side_b, seed)
}
