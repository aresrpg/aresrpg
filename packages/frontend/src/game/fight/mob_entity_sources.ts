// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { EntityVisualEffect, FightSide } from '@aresrpg/engine'
import type { HydratedFightCheckpoint } from '@aresrpg/fight'
import { EFFECT_KINDS } from '@aresrpg/fight/move_contract'

export type FightMobRenderSource = Readonly<{
  id: string
  mob_type: string
  cell: number
  side: FightSide
  visual_effect?: EntityVisualEffect
}>

export const fight_mob_entity_sources = (
  checkpoint: Readonly<HydratedFightCheckpoint>,
  viewer_team: bigint | null = null
): readonly FightMobRenderSource[] =>
  Object.freeze(
    checkpoint.contract.fighters.flatMap((fighter, seat) => {
      if (fighter.kind.type !== 'mob' || fighter.dead) return []
      const invisible = fighter.effects.some(({ kind }) => kind === EFFECT_KINDS.invis)
      if (invisible && viewer_team !== fighter.team) return []
      return [
        Object.freeze({
          id: `fight_mob_${seat}`,
          mob_type: fighter.kind.snapshot.mob_type,
          cell: Number(fighter.cell),
          side: fighter.team === 0n ? ('a' as const) : ('b' as const),
          ...(invisible ? { visual_effect: Object.freeze({ kind: 'invisibility' as const }) } : {}),
        }),
      ]
    })
  )
