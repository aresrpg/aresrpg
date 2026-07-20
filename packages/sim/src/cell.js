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

/**
 * Manhattan (4-directional) distance between two cells.
 * @param {Cell} a
 * @param {Cell} b
 * @returns {number}
 */
export const manhattan_distance = (a, b) =>
  Math.abs(a.x - b.x) + Math.abs(a.y - b.y)

/**
 * Chebyshev (king-move) distance between two cells.
 * @param {Cell} a
 * @param {Cell} b
 * @returns {number}
 */
export const chebyshev_distance = (a, b) =>
  Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y))

/**
 * The four cardinal neighbors (N, W, E, S) — fight movement is 4-directional.
 * @param {Cell} cell
 * @returns {Cell[]}
 */
export const neighbors_4dir = ({ x, y }) => [
  { x, y: y - 1 },
  { x: x - 1, y },
  { x: x + 1, y },
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
