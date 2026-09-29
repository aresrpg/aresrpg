// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { HydratedFightCheckpoint } from '@aresrpg/fight'

import type { FightActionSelection } from './fight_projection.ts'
import type { FightHover } from './fight_hover.ts'

export type FightInteraction = Readonly<{
  action: FightActionSelection
  hover: FightHover
  review: Readonly<{ checkpoint: HydratedFightCheckpoint; cell: bigint }> | null
}>
export type FightInteractionInput =
  | Readonly<{ type: 'action'; action: FightActionSelection }>
  | Readonly<{ type: 'hover'; hover: FightHover }>
  | Readonly<{ type: 'target'; checkpoint: HydratedFightCheckpoint; cell: bigint }>
  | Readonly<{ type: 'cancel' }>

export const initial_fight_interaction: FightInteraction = Object.freeze({ action: null, hover: null, review: null })

export const reduce_fight_interaction = (state: FightInteraction, input: FightInteractionInput): FightInteraction => {
  switch (input.type) {
    case 'action':
      return { ...state, action: input.action, review: null }
    case 'hover':
      return state.review ? state : { ...state, hover: input.hover }
    case 'target':
      return {
        ...state,
        hover: { fight: input.checkpoint.contract.id, type: 'cell', cell: input.cell },
        review: { checkpoint: input.checkpoint, cell: input.cell },
      }
    case 'cancel':
      return { ...state, hover: null, review: null }
  }
}

/** A changed checkpoint invalidates the reviewed action before React effects can run. */
export const reviewed_cell = (
  state: FightInteraction,
  checkpoint: Readonly<HydratedFightCheckpoint> | null,
  locked: boolean
): bigint | null => (!locked && state.review?.checkpoint === checkpoint ? state.review.cell : null)
