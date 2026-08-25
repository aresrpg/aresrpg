// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'
import { Group, Scene } from 'three'

import { create_entity_layer, mob_entity_scale } from '../src/entities.ts'

test('mob models scale from 80% to 120% through the shared entity door', async () => {
  expect(mob_entity_scale(0)).toBeCloseTo(0.8)
  expect(mob_entity_scale(50)).toBeCloseTo(1)
  expect(mob_entity_scale(100)).toBeCloseTo(1.2)
  expect(mob_entity_scale(0, 'fight_cell')).toBeCloseTo(0.56)
  expect(mob_entity_scale(50, 'fight_cell')).toBeCloseTo(0.7)
  expect(mob_entity_scale(100, 'fight_cell')).toBeCloseTo(0.84)

  const scene = new Scene()
  const layer = create_entity_layer({
    scene,
    load_model: () => Promise.resolve({ root: new Group(), clips: Object.freeze([]), min_y: 0, dispose: () => {} }),
  })
  layer.set([
    Object.freeze({
      id: 'mob',
      kind: 'mob' as const,
      model_url: '/mob.glb',
      level_scalar: 100,
      anchor: Object.freeze({ kind: 'world' as const, position: Object.freeze([0, 0, 0] as const) }),
      facing: Object.freeze({ kind: 'yaw' as const, yaw: 0 }),
    }),
    Object.freeze({
      id: 'fight-mob',
      kind: 'mob' as const,
      model_url: '/mob.glb',
      level_scalar: 100,
      anchor: Object.freeze({ kind: 'fight_cell' as const, cell: 0 }),
      facing: Object.freeze({ kind: 'fight_opponents' as const, side: 'b' as const }),
    }),
  ])
  await Promise.resolve()
  await Promise.resolve()

  expect(scene.getObjectByName('entity:mob')?.scale.x).toBeCloseTo(1.2)
  expect(scene.getObjectByName('entity:fight-mob')?.scale.x).toBeCloseTo(0.84)
  layer.dispose()
})
