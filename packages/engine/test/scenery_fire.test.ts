// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import { Scene } from 'three'

import { FIRE_COUNTS, scenery_fire } from '../src/scenery_fire.ts'
import { validate_scenery } from '../src/scenery_data.ts'
import { create_scenery } from '../src/scenery.ts'

test('fire emitters reject unbounded counts, scale and height', () => {
  const scenery = { waterfalls: [], spores: [], vines: [] }
  for (const fires of [
    Array(33).fill({ center: [0, 32, 0], scale: 1 }),
    [{ center: [0, 32, 0], scale: 4 }],
    [{ center: [0, 380, 0], scale: 1 }],
  ])
    expect(validate_scenery({ ...scenery, fires }).length).toBeGreaterThan(0)
  expect(validate_scenery({ ...scenery, fires: [{ center: [0, 32, 0], scale: 1 }] })).toEqual([])
})

test('fire and smoke share two bounded GPU-animated batches across all emitters', () => {
  expect(scenery_fire([]).meshes).toHaveLength(0)
  const fires = scenery_fire([
    { center: [0, 32, 0], scale: 1 },
    { center: [12, 32, 4], scale: 2 },
  ])!
  expect(fires.meshes).toHaveLength(2)
  for (const mesh of fires.meshes) {
    expect(mesh.geometry.getAttribute('position').count).toBe(4)
    expect(mesh.geometry.instanceCount).toBe(2 * FIRE_COUNTS.high)
    expect(mesh.material.positionNode).not.toBeNull()
    expect(mesh.material.opacityNode).not.toBeNull()
    expect(mesh.material.depthWrite).toBe(false)
    expect(mesh.geometry.boundingBox!.max.y).toBeGreaterThan(44)
  }
  fires.set_quality('low')
  for (const mesh of fires.meshes) {
    expect(mesh.geometry.instanceCount).toBe(2 * FIRE_COUNTS.low)
    mesh.geometry.dispose()
    mesh.material.dispose()
  }
})

test('fire participates in scenery visibility, quality and resource disposal', () => {
  const scene = new Scene()
  const scenery = create_scenery({
    scene,
    presentation: 'world',
    scenery: { waterfalls: [], spores: [], vines: [], fires: [{ center: [0, 32, 0], scale: 1 }] },
  })
  const batches = scene.children.filter(
    (mesh) => 'geometry' in mesh && (mesh.geometry as { instanceCount: number }).instanceCount === FIRE_COUNTS.high
  )
  expect(batches).toHaveLength(2)
  expect(batches.every((mesh) => !mesh.visible)).toBe(true)
  scenery.set_visible(true)
  expect(batches.every((mesh) => mesh.visible)).toBe(true)
  scenery.set_quality('low')
  expect(
    batches.every(
      (mesh) => 'geometry' in mesh && (mesh.geometry as { instanceCount: number }).instanceCount === FIRE_COUNTS.low
    )
  ).toBe(true)
  scenery.set_visible(false)
  expect(batches.every((mesh) => !mesh.visible)).toBe(true)
  scenery.dispose()
  expect(scene.children).toHaveLength(0)
})
