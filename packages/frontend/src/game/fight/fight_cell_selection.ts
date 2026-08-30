// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// One cell intent for board clicks and timeline targets. This module decides; the layer supplies effects.

import { fight_path_to, type FightInput, type HydratedFightCheckpoint } from '@aresrpg/fight'

import type { FightActionSelection } from './fight_projection.ts'
import { placement_available } from './PlacementGasWarning.tsx'

export type CellSelection =
  | Readonly<{ type: 'clear' }>
  | Readonly<{ type: 'place'; fighter: bigint; cell: bigint }>
  | Readonly<{ type: 'input'; input: FightInput }>
  | null

const selected_attack_input = (
  action: Exclude<FightActionSelection, null>,
  fighter: bigint,
  cell: bigint
): FightInput =>
  action.type === 'weapon'
    ? { type: 'weapon_strike', fighter, target_cell: cell }
    : { type: 'cast_spell', fighter, spell: action.name, target_cell: cell }

const active_cell_selection = (
  checkpoint: Readonly<HydratedFightCheckpoint>,
  fighter: bigint | null,
  action: FightActionSelection,
  targetable_cells: readonly bigint[],
  cell: bigint
): CellSelection => {
  if (fighter === null) return null
  if (action !== null)
    return targetable_cells.includes(cell)
      ? Object.freeze({ type: 'input', input: selected_attack_input(action, fighter, cell) })
      : Object.freeze({ type: 'clear' })
  const path = fight_path_to(checkpoint, fighter, cell)
  if (!path || path.length === 0) return null
  const input: FightInput = { type: 'move_to', fighter, path }
  return Object.freeze({ type: 'input', input })
}

export const fight_cell_selection = ({
  actions_locked,
  cell,
  checkpoint,
  owned_active_seat,
  owned_placement_seat,
  selected_action,
  targetable_cells,
}: Readonly<{
  actions_locked: boolean
  cell: bigint | null
  checkpoint: HydratedFightCheckpoint
  owned_active_seat: bigint | null
  owned_placement_seat: bigint | null
  selected_action: FightActionSelection
  targetable_cells: readonly bigint[]
}>): CellSelection => {
  if (actions_locked) return null
  if (cell === null) return selected_action === null ? null : Object.freeze({ type: 'clear' })
  if (owned_placement_seat !== null)
    return placement_available(checkpoint, owned_placement_seat, cell)
      ? Object.freeze({ type: 'place', fighter: owned_placement_seat, cell })
      : null
  return active_cell_selection(checkpoint, owned_active_seat, selected_action, targetable_cells, cell)
}

export const apply_cell_selection = (
  selection: CellSelection,
  handlers: Readonly<{
    clear: () => void
    input: (input: Readonly<FightInput>) => void
    place: (fighter: bigint, cell: bigint) => void
  }>
): void => {
  if (!selection) return
  if (selection.type === 'clear') return handlers.clear()
  if (selection.type === 'place') return handlers.place(selection.fighter, selection.cell)
  handlers.input(selection.input)
}
