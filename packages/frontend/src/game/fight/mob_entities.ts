// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Content-to-render projection for mobs. The engine remains the only model loader and scene owner.

import type { FightSide, MobEntityRender } from '@aresrpg/engine'

import { load_mob_model_url } from '../../content/mob_models.ts'

export type FightMobRenderSource = Readonly<{ id: string; mob_type: string; cell: number; side: FightSide }>

const resolved_mob_entity = async (source: FightMobRenderSource): Promise<MobEntityRender | null> => {
  const model_url = await load_mob_model_url(source.mob_type)
  if (!model_url) {
    console.error(`No authored model is available for fight mob ${source.mob_type}.`)
    return null
  }
  return Object.freeze({
    id: source.id,
    kind: 'mob',
    model_url,
    anchor: Object.freeze({ kind: 'fight_cell', cell: source.cell }),
    facing: Object.freeze({ kind: 'fight_opponents', side: source.side }),
  })
}

export const load_fight_mob_entities = async (
  sources: readonly FightMobRenderSource[]
): Promise<readonly MobEntityRender[]> => {
  const rows = await Promise.all(sources.map(resolved_mob_entity))
  return Object.freeze(rows.filter((row): row is MobEntityRender => row !== null))
}
