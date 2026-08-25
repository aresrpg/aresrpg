// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Content-to-render projection for mobs. The engine remains the only model loader and scene owner.

import type { MobEntityRender } from '@aresrpg/engine'

import { mob_entities } from '../mob_entities.ts'
import type { FightMobRenderSource } from './mob_entity_sources.ts'

export const fight_mob_entities = (sources: readonly FightMobRenderSource[]): readonly MobEntityRender[] =>
  mob_entities(
    sources.map(({ id, mob_type, cell, side, level_scalar, visual_effect }) =>
      Object.freeze({
        id,
        mob_type,
        anchor: Object.freeze({ kind: 'fight_cell' as const, cell }),
        facing: Object.freeze({ kind: 'fight_opponents' as const, side }),
        level_scalar,
        ...(visual_effect ? { visual_effect } : {}),
      })
    )
  )
