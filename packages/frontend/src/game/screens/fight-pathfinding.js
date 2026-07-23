// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Fight movement geometry — the PURE steered-MP-path + reachability helpers shared by the tactical
// overlay's hover preview (fight-overlay.js) and the on-chain dungeon draft gate (DungeonBoard.jsx), so
// the highlighted path, the move-range wash, and what a click actually drafts NEVER drift apart.
//
// Both helpers are THIN adapters over @aresrpg/sim's 4-directional BFS (find_path_4dir / get_reachable_cells):
// unit-cost, deterministic, MP-capped, obstacle/occupied-aware via the injected `is_walkable` predicate —
// the SAME sim path the reducer + the server use. NO new pathfinding is invented here; this module only
// shapes the sim output for the two call sites (LoC law: keep the ~1600-line overlay from growing further,
// keep ONE home for the movement math so the preview == the committed route).

import { find_path_4dir, get_reachable_cells } from '@aresrpg/sim/pathfind'

/** @typedef {{ x: number, y: number }} Cell */
/** @typedef {(cell: Cell) => boolean} IsWalkable  walkable terrain AND unoccupied (the start cell is allowed) */
const unoccupied = () => false

/**
 * The STEERED MP PATH from `start` to `target` (the legacy signature): the shortest 4-directional route,
 * pathfound AROUND obstacles / occupied cells, capped at `mp` steps. Returns the ordered stepping-stone
 * cells to WALK — EXCLUDING the start cell — for the board highlight, or `[]` when the target is the start
 * cell, out of MP reach, or fully blocked (no route within budget).
 * @param {Cell} start @param {Cell} target @param {number} mp @param {IsWalkable} is_walkable
 * @returns {Cell[]}
 */
export function steered_path(start, target, mp, is_walkable) {
  if (start.x === target.x && start.y === target.y) return []
  // This legacy adapter receives the already-combined terrain+body predicate; the explicit empty second mask
  // acknowledges that contract at the canonical pathfinder boundary.
  const path = find_path_4dir(
    start,
    target,
    mp,
    is_walkable,
    unoccupied,
  )
  return path && path.length > 1 ? path.slice(1) : []
}

/**
 * Every cell reachable from `start` within `mp` 4-directional steps (obstacle / occupied-aware), EXCLUDING
 * the start cell — the move-range set. The move draft and the range wash both gate on this IDENTICAL set so
 * the preview and what a click commits stay in lockstep.
 * @param {Cell} start @param {number} mp @param {IsWalkable} is_walkable
 * @returns {Cell[]}
 */
export function reachable_cells(start, mp, is_walkable) {
  return get_reachable_cells(start, mp, is_walkable, unoccupied)
    .filter(r => r.cost > 0)
    .map(r => r.cell)
}
