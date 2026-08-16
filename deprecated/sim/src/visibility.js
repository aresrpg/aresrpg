// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Line of sight — THE one answer to "can A see B", integer-only.
//
// `blocks_sight` is the 1:1 port of `combat_grid::blocks` (packages/move/foundation/sources/combat_grid.move):
// an exact integer adaptation of the 1.29 reference shadow-casting (`ShadowCasting.getAccesibleCells`), proven
// verdict-equivalent to the contract over 166,983 triples. Cross-multiplied slope comparisons, no floats, no
// division — same verdict on every machine, and the same verdict the chain reaches.
//
// #1536 row 1 — this REPLACES the recursive float-slope shadowcast ported from koshi-2d that used to live here.
// That algorithm had no chain-equivalence proof yet gated every world-mode cast through
// `spell_targeting.can_target`, and it disagreed with the contract on 13,588 of 216,506 swept
// (origin, target, obstacle) triples: 6.3% of the board's sight lines were cells the client offered as castable
// and `commit_turn` would abort — burned gas, every time. The parity fingerprint that measured it is
// `packages/fight/test/los_parity.test.js`, and it stays in the suite.
//
// Symmetric by construction: `blocks_sight(o, b, t) == blocks_sight(t, b, o)`, so if A sees B then B sees A.

import { decode } from './combat_grid.js'

const abs_diff = (a, b) => (a > b ? a - b : b - a)

/**
 * Predicate: does this cell block line of sight? (obstacle terrain OR an interposing entity)
 * @typedef {(cell: import('./cell.js').Cell) => boolean} BlocksLos
 */

/**
 * Does the obstacle at `b` occlude `t` as seen from `o`? The endpoints never occlude themselves.
 * @param {import('./cell.js').Cell} o @param {import('./cell.js').Cell} b @param {import('./cell.js').Cell} t
 * @returns {boolean}
 */
export const blocks_sight = (o, b, t) => {
  if ((b.x === o.x && b.y === o.y) || (b.x === t.x && b.y === t.y)) return false
  const ax = abs_diff(b.x, o.x)
  const ay = abs_diff(b.y, o.y)
  const cx = abs_diff(t.x, o.x)
  const cy = abs_diff(t.y, o.y)
  // the obstacle must sit inside the o..t rectangle: same side on each axis, and no farther out than the target
  if (b.x !== o.x && b.x >= o.x !== t.x >= o.x) return false
  if (b.y !== o.y && b.y >= o.y !== t.y >= o.y) return false
  if (cx < ax || cy < ay) return false
  if (cx === ax && cy === ay) return false
  const steeper_than_near_edge =
    ax === 0 || cy === 0 ? true : cx * (2 * ay + 1) > (2 * ax - 1) * cy
  if (!steeper_than_near_edge) return false
  if (ay === 0) return b.x < o.x ? true : cx > ax
  if (cy === 0) return false
  return cx * (2 * ay - 1) < (2 * ax + 1) * cy
}

/**
 * Is `to` visible from `from`? A cell can only occlude the line if it lies inside the axis-aligned rectangle the
 * two endpoints span (every early return in `blocks_sight` above enforces that), so the sweep over that
 * rectangle is exhaustive — no octant recursion, no slope accumulation, no radius argument to get wrong.
 * @param {import('./cell.js').Cell} from
 * @param {import('./cell.js').Cell} to
 * @param {BlocksLos} blocks_los
 * @returns {boolean}
 */
export const has_line_of_sight = (from, to, blocks_los) => {
  if (from.x === to.x && from.y === to.y) return true
  for (let y = Math.min(from.y, to.y); y <= Math.max(from.y, to.y); y++)
    for (let x = Math.min(from.x, to.x); x <= Math.max(from.x, to.x); x++) {
      const cell = { x, y }
      if (blocks_los(cell) && blocks_sight(from, cell, to)) return false
    }
  return true
}

// ── the ENCODED board surface (re-exported by `@aresrpg/fight/los` under its long-standing names) ──

/**
 * Does encoded obstacle cell `b` occlude encoded target `t` as seen from encoded origin `o`?
 * @param {number} o @param {number} b @param {number} t @returns {boolean}
 */
export const los_blocks = (o, b, t) =>
  blocks_sight(decode(o), decode(b), decode(t))

/**
 * True iff no cell in `obstacles` (encoded) occludes the sight line from `from` to `to` (encoded).
 * @param {number} from @param {number} to @param {number[]} obstacles @returns {boolean}
 */
export const line_of_sight = (from, to, obstacles) =>
  !obstacles.some(b => los_blocks(from, b, to))
