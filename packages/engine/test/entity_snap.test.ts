// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { Group, Scene } from 'three'
import { expect, test } from 'bun:test'

import { create_entity_layer } from '../src/entities.ts'

test('an authoritative snap cancels a rejected movement still in flight', async () => {
  const scene = new Scene()
  const root = new Group()
  const start = Object.freeze({
    id: 'rollback_walk',
    kind: 'mob' as const,
    model_url: '/bunny.glb',
    anchor: Object.freeze({ kind: 'fight_cell' as const, cell: 10 }),
    facing: Object.freeze({ kind: 'yaw' as const, yaw: 0 }),
  })
  const layer = create_entity_layer({
    scene,
    load_model: () => Promise.resolve({ root, clips: Object.freeze([]), min_y: 0, dispose: () => {} }),
  })
  layer.set_board({
    width: 2,
    height: 1,
    cell_size: 2,
    origin: { x: -3, y: 4, z: -1 },
    cells: [
      { cell: 10, x: 0, y: 0, kind: 'start_a' },
      { cell: 11, x: 1, y: 0, kind: 'floor' },
    ],
  })
  layer.set([start])
  await Promise.resolve()
  await Promise.resolve()

  const movement = layer.animate({ id: start.id, cells: [11], gait: 'walk' })
  expect(layer.snap(start.id, 10)).toBeTrue()
  expect(await movement).toBeFalse()
  layer.tick(Number.MAX_SAFE_INTEGER)
  expect(scene.getObjectByName(`entity:${start.id}`)?.position.x).toBe(-2)
  layer.dispose()
})
