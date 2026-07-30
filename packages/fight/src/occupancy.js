// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//
// occupancy.js — THE ONE cell→occupant index (#1214/#1232, the #1070 class: "the resolver is single-homed, the
// candidate sets that feed it are not"). A corpse keeps its on-chain cell but never body-blocks, so a living
// fighter may legally share it; a plain `map.set` per row is therefore LAST-WRITE-WINS and lets a later-indexed
// corpse shadow a live occupant — which refuses a legal weapon cast, hides a live target from LOS, and mis-targets
// a prediction. Every builder resolves the SAME occupant `find_living_mob_at` (cast.move) and `find_entity_at`
// (sim fight_state.js) do: a living occupant claims its cell once and is never displaced.

import { encode } from './los.js'

/**
 * The cells a PROJECTED fight is VISIBLY holding — every living, non-invisible fighter's cell, ENCODED.
 *
 * #1741 rider 2: single-target damage refuses an UNOCCUPIED cell, and "unoccupied" may only ever mean "nothing
 * VISIBLE here". If that withhold read true chain occupancy, refusing the cast on a secretly-held cell would
 * announce the invisible entity — an information leak and a broken tactic. Reading the projection's own
 * `invisible` flag (project_views' one home, derived from the kind-27 status row) makes an invisibly-held cell
 * withhold EXACTLY like an empty one. Corpses are excluded for the same reason bodies stop blocking: there is
 * nothing there to hit.
 * @param {Map<string, {cell?: {x:number,y:number}|null, dead?: boolean, invisible?: boolean}>
 *   | Iterable<{cell?: {x:number,y:number}|null, dead?: boolean, invisible?: boolean}> | null | undefined} fighters
 *   the projected fighter book (engine_view.fighters) or any iterable of its rows
 * @returns {Set<number>} encoded cells
 */
export const visible_occupant_cells = (fighters) => {
  const rows = fighters instanceof Map ? fighters.values() : (fighters ?? [])
  const cells = new Set()
  for (const fighter of rows) {
    if (!fighter || fighter.dead || fighter.invisible || fighter.cell == null) continue
    cells.add(encode(fighter.cell.x, fighter.cell.y))
  }
  return cells
}

/**
 * Fold occupant rows into the cell-keyed index, living-wins and order-independent.
 * @param {Iterable<{cell: number|null|undefined, kind: 'player'|'mob', idx: number, alive: boolean}>} occupants
 * @returns {Map<number, {kind: 'player'|'mob', idx: number, alive: boolean}>}
 */
export const occupancy_of = (occupants) => {
  const map = new Map()
  for (const { cell, ...occupant } of occupants ?? []) {
    if (cell == null) continue
    const existing = map.get(cell)
    if (existing?.alive && !occupant.alive) continue // a corpse never displaces the living occupant already here
    map.set(cell, occupant)
  }
  return map
}
