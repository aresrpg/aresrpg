// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Grid coordinate primitive + distance/neighbor helpers for the tactical fight.
// Pure integer math — the spatial foundation the reducer and arena are built on.

/**
 * A grid coordinate. Integer `x`/`y`.
 * @typedef {{ x: number, y: number }} Cell
 */

/**
 * Stable string key for a cell, for Set/Map membership.
 * @param {number} x
 * @param {number} y
 * @returns {string}
 */
export const cell_key = (x, y) => `${x},${y}`

// Compatibility name only; the implementation lives with the encoded stride in combat_grid (#1536).
export { manhattan as manhattan_distance } from './combat_grid.js'

/**
 * Chebyshev (king-move) distance between two cells.
 * @param {Cell} a
 * @param {Cell} b
 * @returns {number}
 */
export const chebyshev_distance = (a, b) =>
  Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y))

/**
 * The four cardinal neighbors in Move's canonical fight-walk order: left, right, up, down.
 * `combat_grid::bfs_path_cost` enqueues in this order and `movement::next_shortest_step` uses the same order to
 * break ties between equal shortest routes. Keep every 4-dir sim consumer on this one ordering primitive.
 * @param {Cell} cell
 * @returns {Cell[]}
 */
export const neighbors_4dir = ({ x, y }) => [
  { x: x - 1, y },
  { x: x + 1, y },
  { x, y: y - 1 },
  { x, y: y + 1 },
]

/**
 * The eight neighbors (NW, N, NE, W, E, SW, S, SE) — out-of-fight roam movement is
 * 8-directional (diagonals allowed). Order mirrors the lineage pathfinder for stable
 * tie-breaking.
 * @param {Cell} cell
 * @returns {Cell[]}
 */
export const neighbors_8dir = ({ x, y }) => [
  { x: x - 1, y: y - 1 },
  { x, y: y - 1 },
  { x: x + 1, y: y - 1 },
  { x: x - 1, y },
  { x: x + 1, y },
  { x: x - 1, y: y + 1 },
  { x, y: y + 1 },
  { x: x + 1, y: y + 1 },
]
