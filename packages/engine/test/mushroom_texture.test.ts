// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'
import { Scene, type Mesh, type MeshStandardMaterial } from 'three'

import { mushroom_surface } from '../src/nature/mushroom_texture.ts'
import { create_nature_texture } from '../src/nature/surface_texture.ts'
import { mushroom } from '../src/nature/mushroom_cluster.ts'
import { rotate_y } from '../src/nature/sprite_kit.ts'
import { create_resource_node_layer } from '../src/resource_nodes.ts'

test('mushroom surfaces remain continuous around their seam and separate the cap, gills, and stem', () => {
  for (const v of [0.15, 0.45, 0.85]) {
    expect(mushroom_surface(0, v)).toBeCloseTo(mushroom_surface(1, v), 6)
    const samples = Array.from({ length: 64 }, (_, i) => mushroom_surface(i / 64, v))
    expect(Math.max(...samples) - Math.min(...samples)).toBeGreaterThan(0.08)
  }
  const vertices = mushroom(0, 0, 1, 0.6)
  expect(vertices.every((v) => v[5]! >= 0 && v[5]! <= 1 && v[6]! >= 0 && v[6]! <= 1)).toBeTrue()
  expect(rotate_y(vertices[0]!, 1).slice(5)).toEqual(vertices[0]!.slice(5))
})

test('the atlas is deterministic and opaque', () => {
  const a = create_nature_texture()
  const b = create_nature_texture()
  expect(a.image.data).toEqual(b.image.data)
  expect(a.image.width).toBe(128)
  expect(
    Array.from(a.image.data!)
      .filter((_, index) => index % 4 === 3)
      .every((alpha) => alpha === 255)
  ).toBeTrue()
  a.dispose()
  b.dispose()
})

test('different mushroom types share one texture across resource changes and release it once', () => {
  const scene = new Scene()
  const layer = create_resource_node_layer({ scene, wind: true })
  const markers = ['nightcap', 'arcaneshroom'].map((item_type, index) => ({
    id: item_type,
    item_type,
    x: index * 5,
    y: 72,
    z: 110,
    job: 'HERBALIST',
    tier: 4,
  }))
  layer.set_markers(markers)
  const meshes = scene.children as Mesh[]
  const first = meshes[0]!.material as MeshStandardMaterial
  const second = meshes[1]!.material as MeshStandardMaterial
  expect(first.map).not.toBeNull()
  expect(first.map).toBe(second.map)
  expect(first.bumpMap).toBe(first.map)
  expect(
    meshes.every(({ geometry }) => geometry.getAttribute('uv').count === geometry.getAttribute('position').count)
  ).toBeTrue()
  let disposed = 0
  first.map!.addEventListener('dispose', () => {
    disposed += 1
  })
  layer.set_markers(markers.slice(0, 1))
  expect(disposed).toBe(0)
  layer.dispose()
  expect(disposed).toBe(1)
})
