// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Content-to-render projection for mobs. The engine remains the only model loader and scene owner.

import type { EntityVisualEffect, FightSide, MobEntityRender } from '@aresrpg/engine'

import { mob_entities } from '../mob_entities.ts'

export type FightMobRenderSource = Readonly<{
  id: string
  mob_type: string
  cell: number
  side: FightSide
  visual_effect?: EntityVisualEffect
}>

export const fight_mob_entities = (sources: readonly FightMobRenderSource[]): readonly MobEntityRender[] =>
  mob_entities(
    sources.map(({ id, mob_type, cell, side, visual_effect }) =>
      Object.freeze({
        id,
        mob_type,
        anchor: Object.freeze({ kind: 'fight_cell' as const, cell }),
        facing: Object.freeze({ kind: 'fight_opponents' as const, side }),
        ...(visual_effect ? { visual_effect } : {}),
      })
    )
  )
