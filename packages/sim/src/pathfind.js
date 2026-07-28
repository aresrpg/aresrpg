// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// 4-directional movement over the tactical grid: shortest path + reachable cells.
//
// Unit step cost → BFS is optimal and simpler than A* (no priority heap, no float heuristic). Fight walks mirror
// Move's `combat_grid::bfs_path_cost` queue discipline: complete layer-FIFO frontiers, visited on enqueue, and the
// shared left/right/up/down neighbor order. Parent reconstruction therefore selects the same lexicographically
// first shortest route as `movement::next_shortest_step`. Terrain and live occupancy are separate inputs: Move's
// frozen wall mask is their union, and keeping both explicit prevents a caller from silently dropping body-blocking.

// THE ONE 4-DIRECTIONAL BFS (#1536 row 2). `bfs_4dir` below is the only 4-dir search in the tree: the {x,y}
// reducer/AI surface (`find_path_4dir` / `get_reachable_cells`) and the ENCODED board surface the client draws
// with (`bfs_path_cost` / `bfs_path` / `bfs_reachable`, re-exported by `@aresrpg/fight/los`) are both thin
// adapters over it. The board bounds enter through the walkability predicate rather than being baked into the
// core: a fight arena's dimensions are ROLLED per encounter (width 10..18, height 7..24 — arena.js), so a core
// hard-wired to the 20x19 dungeon board would silently clip world-mode routes on tall boards.

import { cell_key, neighbors_4dir, neighbors_8dir } from './cell.js'
import { GRID_CELLS, GRID_H, GRID_W, decode, encode, in_grid } from './combat_grid.js'

/**
 * Terrain walkability predicate.
 * @typedef {(cell: import('./cell.js').Cell) => boolean} IsWalkable
 */

/**
 * Whether another living fighter occupies a cell.
 * @typedef {(cell: import('./cell.js').Cell) => boolean} IsOccupied
 */

/**
 * A reachable cell and the MP cost to step onto it.
 * @typedef {{ cell: import('./cell.js').Cell, cost: number }} Reachable
 */

/**
 * Walk a `came_from` chain back from `goal` into an ordered path (start..goal inclusive).
 * @param {Map<string, import('./cell.js').Cell>} came_from
 * @param {import('./cell.js').Cell} goal
 * @returns {import('./cell.js').Cell[]}
 */
const reconstruct = (came_from, goal) => {
  const path = [goal]
  let key = cell_key(goal.x, goal.y)
  let prev = came_from.get(key)
  while (prev !== undefined) {
    path.push(prev)
    key = cell_key(prev.x, prev.y)
    prev = came_from.get(key)
  }
  return path.reverse()
}

/**
 * THE 4-directional BFS. Complete layer-FIFO frontiers, visited-on-enqueue, `neighbors_4dir` order — the
 * `combat_grid::bfs_path_cost` queue discipline, so parent reconstruction picks the same lexicographically first
 * shortest route as `movement::next_shortest_step`. Explores at most `max_mp` layers out of `start` and stops the
 * instant `goal_key` is enqueued. `start` itself is never tested for enterability (a mover always stands legally).
 * @param {import('./cell.js').Cell} start
 * @param {number} max_mp
 * @param {(cell: import('./cell.js').Cell) => boolean} can_enter
 * @param {string | null} goal_key stop as soon as this cell is reached
 * @returns {{ reached: boolean, came_from: Map<string, import('./cell.js').Cell>, order: Reachable[] }}
 */
const bfs_4dir = (start, max_mp, can_enter, goal_key = null) => {
  /** @type {Reachable[]} */
  const order = []
  const came_from = new Map()
  const visited = new Set([cell_key(start.x, start.y)])
  let frontier = [start]

  for (let cost = 1; cost <= max_mp && frontier.length > 0; cost++) {
    const next = []
    for (const cell of frontier) {
      for (const neighbor of neighbors_4dir(cell)) {
        const key = cell_key(neighbor.x, neighbor.y)
        if (visited.has(key) || !can_enter(neighbor)) continue
        visited.add(key)
        came_from.set(key, cell)
        order.push({ cell: neighbor, cost })
        if (key === goal_key) return { reached: true, came_from, order }
        next.push(neighbor)
      }
    }
    frontier = next
  }
  return { reached: false, came_from, order }
}

/** Terrain AND body: the one enterability predicate every 4-dir caller pairs its two masks into. */
const enterable = (is_walkable, is_occupied) => cell =>
  is_walkable(cell) && !is_occupied(cell)

/**
 * Shortest 4-directional path from `start` to `goal` within `max_mp` steps (BFS, unit cost).
 * Returns the path inclusive of start and goal, or `null` if unreachable within budget.
 * @param {import('./cell.js').Cell} start
 * @param {import('./cell.js').Cell} goal
 * @param {number} max_mp
 * @param {IsWalkable} is_walkable
 * @param {IsOccupied} is_occupied
 * @returns {import('./cell.js').Cell[] | null}
 */
export const find_path_4dir = (
  start,
  goal,
  max_mp,
  is_walkable,
  is_occupied,
) => {
  if (start.x === goal.x && start.y === goal.y) return [start]
  const can_enter = enterable(is_walkable, is_occupied)
  if (!can_enter(goal)) return null

  const goal_key = cell_key(goal.x, goal.y)
  const { reached, came_from } = bfs_4dir(start, max_mp, can_enter, goal_key)
  return reached ? reconstruct(came_from, goal) : null
}

/**
 * All cells reachable within `max_mp` (4-directional BFS by step cost). Includes start at cost 0.
 * @param {import('./cell.js').Cell} start
 * @param {number} max_mp
 * @param {IsWalkable} is_walkable
 * @param {IsOccupied} is_occupied
 * @returns {Reachable[]}
 */
export const get_reachable_cells = (
  start,
  max_mp,
  is_walkable,
  is_occupied,
) => [
  { cell: start, cost: 0 },
  ...bfs_4dir(start, max_mp, enterable(is_walkable, is_occupied)).order,
]

// ── the ENCODED board surface (the canonical GRID_W x GRID_H dungeon board) ──────────────────────
// The client draws and gates on encoded cells (`cell = y*GRID_W + x`) with a blocked SET rather than predicates.
// These three are the same `bfs_4dir` under an encode/decode skin — NOT a second search. `@aresrpg/fight/los`
// re-exports them under the camelCase names its call sites already use.

/** `blocked` may be a Set or an array of encoded cells; on-board and unblocked is the enterability rule. */
const encoded_enterable = blocked => {
  const is_blocked =
    blocked instanceof Set ? c => blocked.has(c) : c => blocked.includes(c)
  return ({ x, y }) =>
    x >= 0 &&
    y >= 0 &&
    x < GRID_W &&
    y < GRID_H &&
    !is_blocked(encode(x, y))
}

/**
 * The route as encoded cells excluding start, or `null` when there is none within budget — the one place the
 * encoded cost and the encoded path agree, so a sentinel can never drift from an empty route.
 * @param {number} start @param {number} target @param {Set<number>|number[]} blocked @param {number} max_steps
 * @returns {number[] | null}
 */
const bfs_encoded = (start, target, blocked, max_steps) => {
  if (start === target) return []
  if (!in_grid(start) || !in_grid(target)) return null
  const can_enter = encoded_enterable(blocked)
  if (!can_enter(decode(target))) return null
  const path = find_path_4dir(
    decode(start),
    decode(target),
    max_steps,
    can_enter,
    () => false,
  )
  return path && path.slice(1).map(({ x, y }) => encode(x, y))
}

/**
 * Shortest 4-connected step count from `start` to `target` around `blocked`, capped at `max_steps` — the exact
 * MP the contract charges, or `GRID_CELLS` (380, the unreachable sentinel, larger than any real cost).
 * @param {number} start @param {number} target @param {Set<number>|number[]} blocked @param {number} max_steps
 * @returns {number}
 */
export const bfs_path_cost = (start, target, blocked, max_steps) => {
  const route = bfs_encoded(start, target, blocked, max_steps)
  return route === null ? GRID_CELLS : route.length
}

/**
 * The concrete shortest route from `start` to `target` (encoded cells, EXCLUDING start); `[]` when start ==
 * target, blocked, or unreachable within budget. Its length is exactly `bfs_path_cost`.
 * @param {number} start @param {number} target @param {Set<number>|number[]} blocked @param {number} max_steps
 * @returns {number[]}
 */
export const bfs_path = (start, target, blocked, max_steps) =>
  bfs_encoded(start, target, blocked, max_steps) ?? []

/**
 * Every cell reachable from `start` within `max_steps` 4-connected steps around `blocked`, EXCLUDING start — the
 * move-range set the wash paints and the click gate accepts.
 * @param {number} start @param {number} max_steps @param {Set<number>|number[]} blocked @returns {number[]}
 */
export const bfs_reachable = (start, max_steps, blocked) => {
  if (!in_grid(start)) return []
  return get_reachable_cells(
    decode(start),
    max_steps,
    encoded_enterable(blocked),
    () => false,
  )
    .filter(({ cost }) => cost > 0)
    .map(({ cell }) => encode(cell.x, cell.y))
}

// ── 8-directional roam pathfinding (A*, octile cost) ─────────────────────────────
// Out of fights the player moves 8-directionally (diagonals allowed). Diagonal steps
// cost 14, cardinal 10 (the integer sqrt(2) ratio — no floats), so the path prefers
// genuine shortest routes and the client can time diagonals as the longer move
// ("beware of move speed"). Ported faithfully from the lineage A* at
// koshi-2d/.../shared/src/pathfinding.ts (octile heuristic + corner-cut prevention).

const MOVE_CARDINAL = 10
const MOVE_DIAGONAL = 14

// Hard bound on explored nodes: the world is infinite, so a click into a walled-off
// pocket must terminate. Generous enough for any on-screen click; null past it.
const MAX_NODES_8DIR = 8192

/** Octile heuristic: 10*max + 4*min — admissible for the 10/14 cost model. */
const heuristic_8dir = (a, b) => {
  const dx = Math.abs(a.x - b.x)
  const dy = Math.abs(a.y - b.y)
  return (
    MOVE_CARDINAL * Math.max(dx, dy) +
    (MOVE_DIAGONAL - MOVE_CARDINAL) * Math.min(dx, dy)
  )
}

// Tiny binary min-heap keyed on (priority, then h) — same ordering as the lineage.
class MinHeap {
  constructor() {
    /** @type {{ cell: import('./cell.js').Cell, priority: number, h: number }[]} */
    this.data = []
  }
  get size() {
    return this.data.length
  }
  push(node) {
    const d = this.data
    d.push(node)
    let i = d.length - 1
    while (i > 0) {
      const parent = (i - 1) >> 1
      if (this.#less(i, parent)) {
        this.#swap(i, parent)
        i = parent
      } else break
    }
  }
  pop() {
    const d = this.data
    if (d.length === 0) return null
    const [top] = d
    const last = d.pop()
    if (d.length > 0 && last !== undefined) {
      d[0] = last
      let i = 0
      for (;;) {
        const l = 2 * i + 1
        const r = 2 * i + 2
        let s = i
        if (l < d.length && this.#less(l, s)) s = l
        if (r < d.length && this.#less(r, s)) s = r
        if (s === i) break
        this.#swap(i, s)
        i = s
      }
    }
    return top ?? null
  }
  #less(i, j) {
    const a = this.data[i]
    const b = this.data[j]
    if (!a || !b) return false
    return (
      a.priority - b.priority < 0 ||
      (a.priority === b.priority && a.h - b.h < 0)
    )
  }
  #swap(i, j) {
    const t = this.data[i]
    this.data[i] = /** @type {any} */ (this.data[j])
    this.data[j] = /** @type {any} */ (t)
  }
}

/**
 * Shortest 8-directional path from `start` to `goal` (A*, octile 10/14 cost), avoiding
 * non-walkable cells and refusing to cut obstacle corners. Returns the path inclusive of
 * start and goal, or `null` if unreachable (or beyond the node budget).
 * @param {import('./cell.js').Cell} start
 * @param {import('./cell.js').Cell} goal
 * @param {IsWalkable} is_walkable
 * @returns {import('./cell.js').Cell[] | null}
 */
export const find_path_8dir = (start, goal, is_walkable) => {
  if (start.x === goal.x && start.y === goal.y) return [start]
  if (!is_walkable(goal)) return null

  const open = new MinHeap()
  const came_from = new Map()
  const g_score = new Map()
  const closed = new Set()

  const start_key = cell_key(start.x, start.y)
  const goal_key = cell_key(goal.x, goal.y)
  const start_h = heuristic_8dir(start, goal)

  g_score.set(start_key, 0)
  open.push({ cell: start, priority: start_h, h: start_h })

  while (open.size > 0) {
    const current = open.pop()
    if (!current) break
    const current_key = cell_key(current.cell.x, current.cell.y)

    if (current_key === goal_key) {
      const path = [goal]
      let key = goal_key
      while (came_from.has(key)) {
        const prev = came_from.get(key)
        path.push(prev)
        key = cell_key(prev.x, prev.y)
      }
      return path.reverse()
    }

    if (closed.has(current_key)) continue
    closed.add(current_key)
    if (closed.size > MAX_NODES_8DIR) return null

    for (const neighbor of neighbors_8dir(current.cell)) {
      const key = cell_key(neighbor.x, neighbor.y)
      if (closed.has(key) || !is_walkable(neighbor)) continue

      const dx = neighbor.x - current.cell.x
      const dy = neighbor.y - current.cell.y
      const is_diagonal = dx !== 0 && dy !== 0
      // No corner cutting: a diagonal step needs BOTH shared orthogonal cells open.
      if (
        is_diagonal &&
        (!is_walkable({ x: current.cell.x + dx, y: current.cell.y }) ||
          !is_walkable({ x: current.cell.x, y: current.cell.y + dy }))
      )
        continue

      const tentative_g =
        (g_score.get(current_key) ?? Infinity) +
        (is_diagonal ? MOVE_DIAGONAL : MOVE_CARDINAL)
      if (tentative_g < (g_score.get(key) ?? Infinity)) {
        came_from.set(key, current.cell)
        g_score.set(key, tentative_g)
        const h = heuristic_8dir(neighbor, goal)
        open.push({ cell: neighbor, priority: tentative_g + h, h })
      }
    }
  }
  return null
}
