// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import { InstancedMesh, MeshStandardMaterial, Scene } from 'three'

import visuals from '../../../seed/content/mineral_visuals.json'
import { gatherable_catalog } from '../../immutable/src/gathering.ts'
import { create_resource_node_layer } from '../src/resource_nodes.ts'
import { mineral_outcrop } from '../src/nature/mineral_outcrop.ts'
import { create_mineral_texture } from '../src/nature/mineral_texture.ts'

test('authored mineral pixels and geometry are valid, compact and grounded', () => {
  for (const visual of Object.values(visuals)) {
    const patterns = Object.values(visual.patterns)
    const width = patterns[0]![0]!.length
    const height = patterns[0]!.length
    for (const pattern of patterns) {
      expect(pattern.length).toBe(height)
      for (const row of pattern) {
        expect(row.length).toBe(width)
        expect([...row].every((band) => Number(band) < visual.palette.length)).toBeTrue()
      }
    }
    const vertices = mineral_outcrop(visual)
    expect(vertices.length / 3).toBeLessThan(75)
    expect(vertices.every((vertex) => vertex.every(Number.isFinite))).toBeTrue()
    expect(Math.min(...vertices.map((vertex) => vertex[1]))).toBe(0)
    expect(vertices.every((vertex) => vertex[5]! > 0 && vertex[5]! < 1 && vertex[6]! > 0 && vertex[6]! < 1)).toBeTrue()
    const texture = create_mineral_texture(visual)
    expect(texture.image.width).toBe(width + 2)
    expect(texture.image.height).toBe((height + 2) * patterns.length)
    texture.dispose()
  }
})

test('mineral identity textures survive harvest and capacity growth, then release with the layer', () => {
  const scene = new Scene()
  const layer = create_resource_node_layer({ scene })
  const marker = { id: 'q', item_type: 'quartz', job: 'MINER', tier: 1, x: 0, y: 0, z: 0 }
  layer.set_markers([marker])
  const mesh = scene.children[0] as InstancedMesh
  const texture = (mesh.material as MeshStandardMaterial).map!
  let releases = 0
  texture.addEventListener('dispose', () => {
    releases++
  })
  layer.set_markers(Array.from({ length: 8 }, (_, index) => ({ ...marker, id: String(index), x: index })))
  expect(((scene.children[0] as InstancedMesh).material as MeshStandardMaterial).map).toBe(texture)
  layer.set_markers([])
  expect(releases).toBe(0)
  layer.set_markers([marker])
  expect(((scene.children[0] as InstancedMesh).material as MeshStandardMaterial).map).toBe(texture)
  layer.dispose()
  expect(releases).toBe(1)
})

test('every mineable identity has distinct authored art and one instance batch', () => {
  const catalog = gatherable_catalog.filter(({ job }) => job === 'MINER')
  expect(Object.keys(visuals).sort()).toEqual(catalog.map(({ item_type }) => item_type).sort())
  expect(new Set(Object.values(visuals).map(({ patterns }) => JSON.stringify(patterns))).size).toBe(catalog.length)
  expect(new Set(Object.values(visuals).map(({ blocks }) => JSON.stringify(blocks))).size).toBe(catalog.length)
  const scene = new Scene()
  const layer = create_resource_node_layer({ scene })
  const markers = catalog.flatMap(({ item_type, job, tier }, index) =>
    [0, 1].map((ordinal) => ({ id: `${item_type}:${ordinal}`, item_type, job, tier, x: index, y: 0, z: ordinal }))
  )
  layer.set_markers(markers)
  expect(scene.children.length).toBe(catalog.length)
  for (const child of scene.children) {
    const mesh = child as InstancedMesh
    expect(mesh.count).toBe(2)
    expect(mesh.geometry.getAttribute('sway')).toBeUndefined()
    expect(mesh.geometry.getAttribute('position').count / 3).toBeLessThan(75)
  }
  layer.set_markers(markers.filter(({ z }) => z === 0))
  expect(scene.children.every((child) => (child as InstancedMesh).count === 1)).toBeTrue()
  layer.dispose()
  expect(scene.children.length).toBe(0)
})
