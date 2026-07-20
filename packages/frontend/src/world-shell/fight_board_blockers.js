import { encode } from '@aresrpg/fight'

import { dungeon_grid_of, wallCells } from '../game/screens/dungeon-grid.js'

/**
 * Movement blockers for the board that is on screen now: static dungeon walls plus the current presentation
 * fighters. The dungeon snapshot can trail a death or displacement beat, so it must never contribute actor cells.
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
    if ((fighter.committed_dead ?? fighter.dead) || id === exclude_id || !fighter.cell) continue
    const cell = encode(fighter.cell.x, fighter.cell.y)
    if (!also_vacated?.has(cell)) blocked.add(cell)
  }
  return blocked
}
