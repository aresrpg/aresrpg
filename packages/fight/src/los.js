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
//
// #1536 row 3 — the dims + encode/decode/in_grid are NOT declared here: their ONE HOME is
// `@aresrpg/sim/combat_grid` (the deterministic core both packages already ride on). This module re-exports them
// so `@aresrpg/fight/los` stays the client's single import surface for board math.
import { GRID_CELLS, GRID_H, GRID_W, cell_x, cell_y, decode, encode } from '@aresrpg/sim/combat_grid'

export { GRID_W, GRID_H, GRID_CELLS, encode, decode }

const cx_ = cell_x
const cy_ = cell_y
const absd = (a, b) => (a > b ? a - b : b - a)

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
 * overlay. O(range²), trivial at board size (20x19). Excludes the viewer's own cell.
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
// 4-connected BFS over the 20×19 grid, treating every cell in `blocked` (obstacles ∪ holes ∪ out-of-bounds ∪
// occupied fighters — body-blocking) as a WALL. The client MUST match the contract cell-for-cell so the drawn
// path length == the MP the commit spends. `blocked` is a Set OR array of encoded cells.
//
// #1536 row 2 — there is exactly ONE such BFS in the tree and it lives in `@aresrpg/sim/pathfind` (the sim also
// pathfinds, on rolled arenas, and a package cannot import its own dependent). These three names are the client's
// long-standing import surface, kept as aliases so no call site had to churn.
export {
  bfs_path_cost as bfsPathCost,
  bfs_path as bfsPath,
  bfs_reachable as bfsReachable,
} from '@aresrpg/sim/pathfind'
