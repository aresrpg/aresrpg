// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// board #13 (WS-C) — CLIENT-SIDE integer shadowcast, ported 1:1 from `combat_grid::line_of_sight` /
// `combat_grid::blocks` (packages/move/sources/combat/combat_grid.move) — the on-chain co-op dungeon LOS check
// (an EXACT integer adaptation of 1.29 reference shadow-casting, `ShadowCasting.getAccesibleCells`, proven
// verdict-equivalent over 166,983 triples; see that file's doc comment + workspace/cto/los_equivalence.py).
//
// cell = y*GRID_W + x, integer-only (no floats — cross-multiplied slope comparisons), GRID_W=20 (matches the
// Move board). This MUST stay verdict-identical to the contract so client range/LOS highlighting never
// disagrees with what commit_turn actually allows on-chain — do not "simplify" the branches below.

// D75-stride KEYSTONE: the client works in CANONICAL stride-20 everywhere — read_dungeon normalizes every
// inbound chain cell to encode(x,y)=y*20+x (train-3 stride-10 records re-encoded at the boundary), and the
// outbound tx sites translate back. These dims MUST match combat_grid.move's GRID_W=20/GRID_H=19 (its own
// doc: "fight-los.js GRID_W must match"). At 10 every canonical decode y-doubles = a scrambled board.
export const GRID_W = 20
export const GRID_H = 19
export const GRID_CELLS = GRID_W * GRID_H

const cx_ = (c) => c % GRID_W
const cy_ = (c) => (c / GRID_W) | 0
const absd = (a, b) => (a > b ? a - b : b - a)

/** cell index for a given (x,y) — inverse of cx_/cy_. */
export function encode(x, y) {
  return y * GRID_W + x
}

/** encoded cell (y*GRID_W+x) → arena-local {x,y} — the inverse of `encode`. The ONE decode, imported by every
 *  consumer (fight-overlay / dungeon_store / DungeonBoard) so the index↔(x,y) math never drifts across files. */
export function decode(cell) {
  return { x: cell % GRID_W, y: (cell / GRID_W) | 0 }
}

/** The ONE board cell→world mapper: arena-local (x,y) → roam world XZ, offset by the board origin, TILE units per
 *  cell. Every world placement (board floor stamp, fighter sprites, start rings, picks, VFX anchors) goes through
 *  THIS — no second copy of `(origin+cell)*TILE` anywhere, so the rendered board + entities can never disagree. */
export function cell_to_world(x, y, ox, oy, tile = 1) {
  return { x: (ox + x) * tile, z: (oy + y) * tile }
}

/** Does obstacle cell `b` occlude target cell `t` as seen from origin cell `o`? Ported from Move's `blocks`. */
export function losBlocks(o, b, t) {
  if (b === o || b === t) return false
  const ox = cx_(o),
    oy = cy_(o),
    bx = cx_(b),
    by = cy_(b),
    tx = cx_(t),
    ty = cy_(t)
  const ax = absd(bx, ox),
    ay = absd(by, oy),
    cx = absd(tx, ox),
    cy = absd(ty, oy)
  if (bx !== ox && bx >= ox !== tx >= ox) return false
  if (by !== oy && by >= oy !== ty >= oy) return false
  if (cx < ax || cy < ay) return false
  if (cx === ax && cy === ay) return false
  const s_gt_s1 = ax === 0 || cy === 0 ? true : cx * (2 * ay + 1) > (2 * ax - 1) * cy
  if (!s_gt_s1) return false
  if (ay === 0) return bx < ox ? true : cx > ax
  if (cy === 0) return false
  return cx * (2 * ay - 1) < (2 * ax + 1) * cy
}

/** True iff no obstacle in `obstacles` occludes the straight sight line from `from` to `to`. */
export function lineOfSight(from, to, obstacles) {
  return !obstacles.some((b) => losBlocks(from, b, to))
}

/**
 * Every cell within Chebyshev `range` of `viewer` that has line-of-sight to it — for a range/LOS highlight
 * overlay. O(range²), trivial at MVP board size (10x10). Excludes the viewer's own cell.
 */
export function visibleCellsInRange(viewer, range, obstacles) {
  const vx = cx_(viewer),
    vy = cy_(viewer)
  const out = []
  for (let y = Math.max(0, vy - range); y <= Math.min(GRID_H - 1, vy + range); y++) {
    for (let x = Math.max(0, vx - range); x <= Math.min(GRID_W - 1, vx + range); x++) {
      const cell = encode(x, y)
      if (cell === viewer) continue
      if (Math.max(absd(x, vx), absd(y, vy)) > range) continue
      if (lineOfSight(viewer, cell, obstacles)) out.push(cell)
    }
  }
  return out
}

// ╔════════════════ [ D41 PATHFINDING — the byte-identical twin of combat_grid::bfs_path_cost ] ═══════════════ ]
// 4-connected BFS over the 10×10 grid, treating every cell in `blocked` (obstacles ∪ holes ∪ out-of-bounds ∪
// occupied fighters — body-blocking) as a WALL. The client MUST match the contract cell-for-cell so the drawn
// path length == the MP the commit spends. `blocked` is a Set OR array of encoded cells.

const in_grid = (c) => c >= 0 && c < GRID_CELLS
const blocked_pred = (blocked) => (blocked instanceof Set ? (c) => blocked.has(c) : (c) => blocked.includes(c))

/** The 4-connected in-grid neighbours of `c` in Move's draw order (x-1, x+1, y-1, y+1). */
const neighbors4 = (c) => {
  const x = cx_(c),
    y = cy_(c)
  const out = []
  if (x > 0) out.push(c - 1)
  if (x + 1 < GRID_W) out.push(c + 1)
  if (y > 0) out.push(c - GRID_W)
  if (y + 1 < GRID_H) out.push(c + GRID_W)
  return out
}

/**
 * Shortest 4-connected step count from `start` to `target` around `blocked`, capped at `maxSteps`. Verbatim
 * port of `combat_grid::bfs_path_cost`: returns the exact MP cost if reachable within budget, else `GRID_CELLS`
 * (100 — the unreachable sentinel, larger than any real cost). start==target -> 0.
 * @param {number} start @param {number} target @param {Set<number>|number[]} blocked @param {number} maxSteps
 * @returns {number}
 */
export function bfsPathCost(start, target, blocked, maxSteps) {
  if (start === target) return 0
  const is_blocked = blocked_pred(blocked)
  if (!in_grid(start) || !in_grid(target) || is_blocked(target)) return GRID_CELLS
  const visited = new Array(GRID_CELLS).fill(false)
  visited[start] = true
  let frontier = [start]
  let steps = 0
  while (steps < maxSteps && frontier.length) {
    steps++
    const next = []
    for (const c of frontier)
      for (const n of neighbors4(c)) {
        if (!visited[n] && !is_blocked(n)) {
          if (n === target) return steps
          visited[n] = true
          next.push(n)
        }
      }
    frontier = next
  }
  return GRID_CELLS
}

/**
 * The concrete shortest route from `start` to `target` (encoded cells, EXCLUDING start) — a BFS with parent
 * pointers whose length is exactly `bfsPathCost(start, target, blocked, maxSteps)`. `[]` when start==target,
 * blocked, or unreachable within budget. This is the drawn path; its length == the contract's MP charge.
 * @param {number} start @param {number} target @param {Set<number>|number[]} blocked @param {number} maxSteps
 * @returns {number[]}
 */
export function bfsPath(start, target, blocked, maxSteps) {
  if (start === target) return []
  const is_blocked = blocked_pred(blocked)
  if (!in_grid(start) || !in_grid(target) || is_blocked(target)) return []
  const parent = new Array(GRID_CELLS).fill(-1)
  const visited = new Array(GRID_CELLS).fill(false)
  visited[start] = true
  let frontier = [start]
  let steps = 0
  while (steps < maxSteps && frontier.length) {
    steps++
    const next = []
    for (const c of frontier)
      for (const n of neighbors4(c)) {
        if (visited[n] || is_blocked(n)) continue
        visited[n] = true
        parent[n] = c
        if (n === target) {
          const path = []
          for (let cur = target; cur !== start; cur = parent[cur]) path.push(cur)
          return path.reverse()
        }
        next.push(n)
      }
    frontier = next
  }
  return []
}

/**
 * Every cell reachable from `start` within `maxSteps` 4-connected steps around `blocked`, EXCLUDING start — the
 * move-range set. A cell is in the result iff `bfsPathCost(start, cell, blocked, maxSteps)` ∈ [1, maxSteps], so
 * the reach wash == the click-gate == the contract's legal-move set.
 * @param {number} start @param {number} maxSteps @param {Set<number>|number[]} blocked @returns {number[]}
 */
export function bfsReachable(start, maxSteps, blocked) {
  const out = []
  if (!in_grid(start)) return out
  const is_blocked = blocked_pred(blocked)
  const visited = new Array(GRID_CELLS).fill(false)
  visited[start] = true
  let frontier = [start]
  let steps = 0
  while (steps < maxSteps && frontier.length) {
    steps++
    const next = []
    for (const c of frontier)
      for (const n of neighbors4(c)) {
        if (visited[n] || is_blocked(n)) continue
        visited[n] = true
        out.push(n)
        next.push(n)
      }
    frontier = next
  }
  return out
}
