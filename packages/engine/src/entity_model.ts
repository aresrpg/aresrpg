// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { AnimationClip, Object3D } from 'three'

import { create_character_model } from './character_model.ts'
import { create_mob_model } from './mob_model.ts'
import type { EntityRender } from './types.ts'

export type EntityModel = Readonly<{
  root: Object3D
  clips: readonly AnimationClip[]
  min_y: number
  dispose: () => void
}>

export const create_entity_model = (spec: EntityRender): Promise<EntityModel> =>
  spec.kind === 'mob' ? create_mob_model(spec.model_url, spec.id) : create_character_model(spec.appearance)
