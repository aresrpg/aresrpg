// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// One seed mob identity to the engine's shared entity contract. World and fight placement only choose an anchor.

import type { EntityAnchor, EntityFacing, MobEntityRender } from '@aresrpg/engine'

import { mob_model_url } from '../content/mob_models.ts'

export type MobRenderSource = Readonly<{
  id: string
  mob_type: string
  anchor: EntityAnchor
  facing: EntityFacing
}>

export const mob_entity = (source: MobRenderSource): MobEntityRender | null => {
  const model_url = mob_model_url(source.mob_type)
  if (!model_url) {
    console.error(`No authored model is available for mob ${source.mob_type}.`)
    return null
  }
  return Object.freeze({
    id: source.id,
    kind: 'mob',
    model_url,
    anchor: source.anchor,
    facing: source.facing,
  })
}

export const mob_entities = (sources: readonly MobRenderSource[]): readonly MobEntityRender[] =>
  Object.freeze(sources.map(mob_entity).filter((row): row is MobEntityRender => row !== null))
