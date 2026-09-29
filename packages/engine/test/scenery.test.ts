// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'
import { Scene, type Mesh } from 'three'

import environment from '../../../seed/content/adventure_environment.json'
import { create_scenery } from '../src/scenery.ts'
import { SCENERY_BUDGET, validate_scenery, type WorldScenery } from '../src/scenery_data.ts'

const scenery: WorldScenery = {
  waterfalls: [{ top: [64, 100, 200], bottom_y: 20, width: 12, yaw: 0 }],
  spores: [{ center: [128, 78, 108], size: [20, 8, 20] }],
  vines: [{ top: [120, 90, 128], length: 8, yaw: 0 }],
}

test('authored scenery accepts the demo and refuses unbounded or malformed effects', () => {
  expect(validate_scenery(environment.scenery)).toEqual([])
  expect(validate_scenery(undefined)).toEqual([])
  for (const invalid of [
    null,
    {},
    { ...scenery, waterfalls: Array(13).fill(scenery.waterfalls[0]) },
    { ...scenery, spores: [{ center: [0, NaN, 0], size: [1, 1, 1] }] },
    { ...scenery, waterfalls: [{ ...scenery.waterfalls[0], bottom_y: 100 }] },
    { ...scenery, vines: [{ ...scenery.vines[0], length: 100 }] },
  ]) {
    expect(validate_scenery(invalid).length).toBeGreaterThan(0)
  }
})

test('scenery stays within four draws and reuses GPU buffers across quality changes', () => {
  const scene = new Scene()

  const layer = create_scenery({ scene, scenery, presentation: 'world' })
  const meshes = [...scene.children] as Mesh[]
  expect(meshes).toHaveLength(4)
  expect(meshes.every(({ visible }) => !visible)).toBeTrue()
  const geometries = meshes.map(({ geometry }) => geometry)
  layer.set_quality('low')
  expect(Reflect.get(meshes[1]!.geometry, 'instanceCount')).toBe(SCENERY_BUDGET.low.mist_per_volume)
  expect(Reflect.get(meshes[2]!.geometry, 'instanceCount')).toBe(SCENERY_BUDGET.low.spores_per_volume)
  layer.set_quality('high')
  expect(meshes.map(({ geometry }) => geometry)).toEqual(geometries)
  layer.set_visible(true)
  expect(meshes.every(({ visible }) => visible)).toBeTrue()
  layer.set_visible(false)
  expect(meshes.every(({ visible }) => !visible)).toBeTrue()
  const disposed: string[] = []
  meshes.forEach(({ geometry, material }, index) => {
    geometry.addEventListener('dispose', () => disposed.push(`geometry:${index}`))
    if (!Array.isArray(material)) material.addEventListener('dispose', () => disposed.push(`material:${index}`))
  })
  layer.dispose()
  expect(scene.children).toHaveLength(0)
  expect(disposed).toHaveLength(8)
})

test('ordinary worlds and fight-only renderers allocate no scenery resources', () => {
  const scene = new Scene()

  for (const layer of [
    create_scenery({ scene, presentation: 'world' }),
    create_scenery({ scene, scenery, presentation: 'fight' }),
  ]) {
    layer.set_visible(true)
    layer.set_quality('high')
    layer.dispose()
  }
  expect(scene.children).toHaveLength(0)
})

test('seasonal effects keep bounded buffers and dispose with the world', () => {
  const seasonal: WorldScenery = {
    waterfalls: [],
    spores: [],
    vines: [],
    snow: [{ center: [0, 30, 0], size: [60, 40, 60] }],
    glows: [{ center: [2, 4, 6], size: 2, color: [2, 1, 0.2] }],
  }
  expect(validate_scenery(seasonal)).toEqual([])
  for (const invalid of [
    { ...seasonal, snow: Array(5).fill(seasonal.snow![0]) },
    { ...seasonal, snow: null },
    { ...seasonal, glows: [{ center: [0, 0, 0], size: 9, color: [1, 1, 1] }] },
    { ...seasonal, glows: [{ center: [0, 0, 0], size: 2, color: [Infinity, 1, 1] }] },
  ])
    expect(validate_scenery(invalid).length).toBeGreaterThan(0)
  const scene = new Scene()
  const layer = create_scenery({ scene, scenery: seasonal, presentation: 'world' })
  const meshes = scene.children as Mesh[]
  const snow = meshes.at(-2)!
  const { geometry } = snow
  layer.set_quality('low')
  expect(Reflect.get(geometry, 'instanceCount')).toBe(96)
  layer.set_quality('high')
  expect(snow.geometry).toBe(geometry)
  expect(Reflect.get(geometry, 'instanceCount')).toBe(768)
  let disposed = false
  geometry.addEventListener('dispose', () => {
    disposed = true
  })
  layer.dispose()
  expect(disposed).toBe(true)
  expect(scene.children).toHaveLength(0)
})
