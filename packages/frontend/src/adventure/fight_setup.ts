// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { simulator_board, initial_simulator_state, type SimulatorCharacter } from '../modules/simulator.ts'
import { mob_level_from_scalar } from '../content/mob_levels.ts'
import { simulator_fight_setup } from '../simulator/fight_setup.ts'

import {
  ADVENTURE_COMPANION_ITEMS,
  ADVENTURE_ENCOUNTERS,
  ADVENTURE_ITEMS,
  ADVENTURE_MOBS,
  ADVENTURE_PET_ITEM,
  adventure_group,
} from './content.ts'

export const adventure_fight_setup = (
  character: SimulatorCharacter,
  encounter: number,
  companion: SimulatorCharacter | null = null
) => {
  const state = { ...initial_simulator_state(), seed: 38n }
  const characters = companion ? [character, companion] : [character]
  const board = simulator_board(state)
  const { mob } = ADVENTURE_ENCOUNTERS[encounter]!
  const setup = simulator_fight_setup(
    {
      ...state,
      characters,
      character_placements: Object.fromEntries(
        characters.map((row, index) => [Number(board.start_cells_a[index]!), row.id])
      ),
      mob_placements: Object.fromEntries(
        board.start_cells_b.slice(0, ADVENTURE_ENCOUNTERS[encounter]!.count).map((cell, index) => [
          Number(cell),
          {
            mob_type: mob.mob_type,
            level: mob_level_from_scalar(
              mob.level_min,
              mob.level_max,
              adventure_group(encounter).members[index]!.level_scalar
            ),
          },
        ])
      ),
    },
    { items: [...ADVENTURE_ITEMS, ADVENTURE_PET_ITEM, ...ADVENTURE_COMPANION_ITEMS], mobs: ADVENTURE_MOBS }
  )
  return {
    ...setup,
    players: setup.players.map((player) => ({ ...player, ready: false })),
    fight_id: `adventure_${encounter}`,
  }
}
