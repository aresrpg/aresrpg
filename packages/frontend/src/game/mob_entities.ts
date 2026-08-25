// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// One seed mob identity to the engine's shared entity contract. World and fight placement only choose an anchor.

import { preload_mob_model, type EntityAnchor, type EntityFacing, type MobEntityRender } from '@aresrpg/engine'

import { mob_model_render } from '../content/mob_models.ts'
import { encyclopedia_catalog } from '../content/catalog.ts'
import { mob_level_from_scalar, mob_scalar_from_level } from '../content/mob_levels.ts'

export type MobRenderSource = Readonly<{
  id: string
  mob_type: string
  anchor: EntityAnchor
  facing: EntityFacing
  level_scalar?: number
}>

export const mob_model_scalar_for_level = (mob_type: string, level: number): number => {
  const mob = encyclopedia_catalog.mobs.find((row) => row.mob_type === mob_type)
  return mob ? mob_scalar_from_level(mob.level_min, mob.level_max, level) : 50
}

export const mob_model_scalar_for_roll = (mob_type: string, level_scalar: number): number => {
  const mob = encyclopedia_catalog.mobs.find((row) => row.mob_type === mob_type)
  if (!mob) return 50
  const level = mob_level_from_scalar(mob.level_min, mob.level_max, level_scalar)
  return mob_scalar_from_level(mob.level_min, mob.level_max, level)
}

export const mob_entity = (source: MobRenderSource): MobEntityRender | null => {
  const model = mob_model_render(source.mob_type)
  // Asset parity is build-gated. This projection runs on every wander frame, so logging a
  // broken build here floods the main thread and starves terrain scheduling.
  if (!model) return null
  return Object.freeze({
    id: source.id,
    kind: 'mob',
    model_url: model.model_url,
    variant: model.variant,
    ...(source.level_scalar === undefined ? {} : { level_scalar: source.level_scalar }),
    anchor: source.anchor,
    facing: source.facing,
  })
}

export const mob_entities = (sources: readonly MobRenderSource[]): readonly MobEntityRender[] =>
  Object.freeze(sources.map(mob_entity).filter((row): row is MobEntityRender => row !== null))

export const preload_mob_type = (mob_type: string): void => {
  const model = mob_model_render(mob_type)
  if (model) preload_mob_model(model.model_url)
}

export const preload_world_mobs = (
  mobs: readonly Readonly<{ mob_type: string }>[],
  preload: (mob_type: string) => void = preload_mob_type
): void => new Set(mobs.map(({ mob_type }) => mob_type)).forEach(preload)
