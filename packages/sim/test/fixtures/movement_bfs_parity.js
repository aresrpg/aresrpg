// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

// TEST-ONLY Move oracle. `combat_grid::bfs_path_cost` processes a FIFO frontier one complete layer at a time,
// marks cells visited when enqueued, and draws neighbours left, right, up, down
// (`packages/move/foundation/sources/combat_grid.move:40-75`). `movement::walk` first obtains that shortest cost,
// then enters the first left/right/up/down neighbour whose remaining BFS cost is exactly one less
// (`packages/move/engine/sources/movement.move:31-39,60-76`). Keep this independent of sim/pathfind.js: it is the
// parity oracle, not another production pathfinding home.
const chain_directions = [
  { x: -1, y: 0 },
  { x: 1, y: 0 },
  { x: 0, y: -1 },
  { x: 0, y: 1 },
]

const same_cell = (a, b) => a.x === b.x && a.y === b.y
const cell_key = cell => `${cell.x},${cell.y}`
const step = (cell, direction) => ({
  x: cell.x + direction.x,
  y: cell.y + direction.y,
})

const chain_bfs_cost = (start, target, max_steps, is_walkable) => {
  if (same_cell(start, target)) return 0
  if (!is_walkable(target)) return null

  const visited = new Set([cell_key(start)])
  let frontier = [start]
  let steps = 0
  while (steps < max_steps && frontier.length > 0) {
    steps += 1
    const next = []
    for (const cell of frontier) {
      for (const direction of chain_directions) {
        const neighbor = step(cell, direction)
        const key = cell_key(neighbor)
        if (visited.has(key) || !is_walkable(neighbor)) continue
        if (same_cell(neighbor, target)) return steps
        visited.add(key)
        next.push(neighbor)
      }
    }
    frontier = next
  }
  return null
}

export const chain_walk_path = (start, target, max_steps, is_walkable) => {
  const cost = chain_bfs_cost(start, target, max_steps, is_walkable)
  if (cost === null) return null

  const path = [start]
  let current = start
  let remaining = cost
  while (remaining > 0) {
    let selected = null
    for (const direction of chain_directions) {
      const candidate = step(current, direction)
      if (
        is_walkable(candidate) &&
        chain_bfs_cost(candidate, target, remaining - 1, is_walkable) === remaining - 1
      ) {
        selected = candidate
        break
      }
    }
    if (!selected) throw new Error('Move oracle could not reconstruct its shortest path')
    path.push(selected)
    current = selected
    remaining -= 1
  }
  return path
}

export const walk_parity_scenarios = [
  {
    meta: {
      id: 'mob_skirts_chain_trap',
      symptom: 'mob rendered above the blocker while the chain walked left through the trap',
    },
    board: { width: 7, height: 7, obstacles: [{ x: 3, y: 3 }] },
    mover: { id: 'm0', is_player: false, start: { x: 4, y: 4 } },
    opponent: { id: 'p0', is_player: true, cell: { x: 6, y: 0 } },
    bodies: [],
    destination: { x: 2, y: 2 },
    budget: 4,
    trap: { source_id: 'p0', cell: { x: 3, y: 4 } },
    expected_path: [
      { x: 4, y: 4 },
      { x: 3, y: 4 },
      { x: 2, y: 4 },
      { x: 2, y: 3 },
      { x: 2, y: 2 },
    ],
    expected_trigger: true,
  },
  {
    meta: {
      id: 'player_crosses_own_trap_visual_only',
      symptom: 'player rendered across its own trap although the chain chose right before up',
    },
    board: { width: 7, height: 7, obstacles: [] },
    mover: { id: 'p0', is_player: true, start: { x: 2, y: 3 } },
    opponent: { id: 'm0', is_player: false, cell: { x: 6, y: 6 } },
    bodies: [],
    destination: { x: 3, y: 2 },
    budget: 2,
    trap: { source_id: 'p0', cell: { x: 2, y: 2 } },
    expected_path: [
      { x: 2, y: 3 },
      { x: 3, y: 3 },
      { x: 3, y: 2 },
    ],
    expected_trigger: false,
  },
  {
    meta: {
      id: 'trap_kit_board_correction',
      symptom: 'prediction skipped the owner trap around a living body and reconciled every turn',
    },
    board: { width: 7, height: 7, obstacles: [] },
    mover: { id: 'p0', is_player: true, start: { x: 4, y: 3 } },
    opponent: { id: 'm0', is_player: false, cell: { x: 6, y: 6 } },
    bodies: [{ id: 'p1', is_player: true, cell: { x: 3, y: 2 } }],
    destination: { x: 2, y: 1 },
    budget: 4,
    trap: { source_id: 'p0', cell: { x: 3, y: 3 } },
    expected_path: [
      { x: 4, y: 3 },
      { x: 3, y: 3 },
      { x: 2, y: 3 },
      { x: 2, y: 2 },
      { x: 2, y: 1 },
    ],
    expected_trigger: true,
  },
]

export const scenario_walkable = scenario => {
  const blocked = new Set(
    [...scenario.board.obstacles, ...scenario.bodies, scenario.opponent].map(item =>
      cell_key(item.cell ?? item),
    ),
  )
  return cell =>
    cell.x >= 0 &&
    cell.y >= 0 &&
    cell.x < scenario.board.width &&
    cell.y < scenario.board.height &&
    !blocked.has(cell_key(cell))
}
