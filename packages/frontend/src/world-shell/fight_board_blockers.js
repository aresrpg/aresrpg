// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { encode } from '@aresrpg/fight/los'

import { dungeon_grid_of, wallCells } from '../game/screens/dungeon-grid.js'

/**
 * Movement blockers for the board that is on screen now: static dungeon walls plus the current presentation
 * fighters. The dungeon snapshot can trail a death or displacement beat, so it must never contribute actor cells.
 *
 * A BODY BLOCKS, A CORPSE NEVER DOES — in EVERY projection (#2025, the re-report of #1806). Occupancy is
 * living-only on the sim (`find_entity_at` drops health<=0), on the chain (`displacement::add_living_bodies`)
 * and in the paint's own builder (`project.move_wash`'s wash_blocked, which reads the PRESENTED fold's
 * `alive`). Gating this set on `committed_dead` ALONE read a different liveness than the paint: MY kill is
 * predicted first and stays committed-alive until the receipt (`dead` true, `committed_dead` false — the window
 * fight/test/committed_liveness.test.js pins), so the wash painted the freed cell green while this set still
 * held it and the walk onto it silently did nothing. Dead in EITHER projection frees the cell: `dead` carries
 * the prediction (masked for the length of the killing beat, when movement is disarmed wholesale anyway) and
 * `committed_dead` carries a chain-acked death whose beat is still presenting. Once dead, never a blocker.
 *
 * @param {any} dungeon
 * @param {Map<string, {id?: string, dead?: boolean, committed_dead?: boolean, cell?: {x:number,y:number}}>|undefined|null} fighters
 * @param {string|null|undefined} exclude_id
 * @param {Set<number>|null} [also_vacated]
 * @returns {Set<number>}
 */
export function presentation_blocked_cells(dungeon, fighters, exclude_id, also_vacated = null) {
  const blocked = new Set(wallCells(dungeon_grid_of(dungeon)))
  for (const [key, fighter] of fighters ?? []) {
    const id = fighter.id ?? key
    if (fighter.dead || fighter.committed_dead || id === exclude_id || !fighter.cell) continue
    const cell = encode(fighter.cell.x, fighter.cell.y)
    if (!also_vacated?.has(cell)) blocked.add(cell)
  }
  return blocked
}
