// 4-directional movement over the tactical grid: shortest path + reachable cells.
//
// Unit step cost → BFS is optimal and simpler than A* (no priority heap, no float heuristic), and fully
// deterministic given the fixed neighbor order. Walkability is an injected predicate, so this layer is
// world-agnostic — the reducer ANDs terrain walkability with a fresh occupancy check (occupancy is NOT
// baked into the predicate).

import { cell_key, neighbors_4dir, neighbors_8dir } from './cell.js'

/**
 * Terrain walkability predicate (occupancy handled separately by the reducer).
 * @typedef {(cell: import('./cell.js').Cell) => boolean} IsWalkable
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
 * Shortest 4-directional path from `start` to `goal` within `max_mp` steps (BFS, unit cost).
 * Returns the path inclusive of start and goal, or `null` if unreachable within budget.
 * @param {import('./cell.js').Cell} start
 * @param {import('./cell.js').Cell} goal
 * @param {number} max_mp
 * @param {IsWalkable} is_walkable
 * @returns {import('./cell.js').Cell[] | null}
 */
export const find_path_4dir = (start, goal, max_mp, is_walkable) => {
  if (start.x === goal.x && start.y === goal.y) return [start]
  if (!is_walkable(goal)) return null

  const goal_key = cell_key(goal.x, goal.y)
  const came_from = new Map()
  const visited = new Set([cell_key(start.x, start.y)])
  let frontier = [start]

  for (let cost = 0; cost < max_mp && frontier.length > 0; cost++) {
    const next = []
    for (const cell of frontier) {
      for (const neighbor of neighbors_4dir(cell)) {
        const key = cell_key(neighbor.x, neighbor.y)
        if (visited.has(key) || !is_walkable(neighbor)) continue
        visited.add(key)
        came_from.set(key, cell)
        if (key === goal_key) return reconstruct(came_from, goal)
        next.push(neighbor)
      }
    }
    frontier = next
  }
  return null
}

/**
 * All cells reachable within `max_mp` (4-directional BFS by step cost). Includes start at cost 0.
 * @param {import('./cell.js').Cell} start
 * @param {number} max_mp
 * @param {IsWalkable} is_walkable
 * @returns {Reachable[]}
 */
export const get_reachable_cells = (start, max_mp, is_walkable) => {
  const result = [{ cell: start, cost: 0 }]
  const visited = new Set([cell_key(start.x, start.y)])
  let frontier = [start]

  for (let cost = 1; cost <= max_mp && frontier.length > 0; cost++) {
    const next = []
    for (const cell of frontier) {
      for (const neighbor of neighbors_4dir(cell)) {
        const key = cell_key(neighbor.x, neighbor.y)
        if (visited.has(key) || !is_walkable(neighbor)) continue
        visited.add(key)
        result.push({ cell: neighbor, cost })
        next.push(neighbor)
      }
    }
    frontier = next
  }
  return result
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
