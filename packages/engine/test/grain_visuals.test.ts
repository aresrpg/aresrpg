// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'
import { Color, InstancedMesh, Scene } from 'three'

import visuals from '../../../seed/content/grain_visuals.json'
import { gatherable_catalog } from '../../immutable/src/gathering.ts'
import { create_resource_node_layer } from '../src/resource_nodes.ts'

const grains = gatherable_catalog.filter(({ job }) => job === 'FARMER')

test('every canonical farmer grain has a complete icon-backed palette and valid cell mask', async () => {
  expect(Object.keys(visuals.grains).sort()).toEqual(grains.map(({ item_type }) => item_type).sort())
  for (const [item_type, visual] of Object.entries(visuals.grains)) {
    expect(await Bun.file(new URL(`../../../seed/icons/items/${item_type}_hd.png`, import.meta.url)).exists()).toBe(
      true
    )
    expect(visual.palette).toHaveLength(4)
    visual.palette.forEach((color) => expect(color).toMatch(/^#[0-9a-f]{6}$/))
    const pattern = visuals.patterns[visual.pattern as keyof typeof visuals.patterns]
    expect(pattern).toHaveLength(6)
    pattern.forEach((row) => {
      expect(row).toHaveLength(5)
      row.forEach((band) => expect([-1, 0, 1, 2, 3]).toContain(band))
    })
  }
})

test('world geometry uses the authored grain colors directly and retains one instanced draw per identity', () => {
  const scene = new Scene()
  const layer = create_resource_node_layer({ scene, wind: true })
  layer.set_markers(grains.map((grain, index) => ({ ...grain, id: grain.item_type, x: index * 3, y: 0, z: 0 })))
  const meshes = scene.children.filter((child): child is InstancedMesh => child instanceof InstancedMesh)
  expect(meshes).toHaveLength(grains.length)
  meshes.forEach((mesh) => {
    const item_type = mesh.name.slice('resource:'.length) as keyof typeof visuals.grains
    const palette = visuals.grains[item_type].palette.map((value) => new Color(value))
    const color = mesh.geometry.getAttribute('color')
    const used = new Set<number>()
    for (let i = 0; i < color.count; i++) {
      const band = palette.findIndex(
        (value) =>
          Math.abs(color.getX(i) - value.r) + Math.abs(color.getY(i) - value.g) + Math.abs(color.getZ(i) - value.b) <
          1e-6
      )
      expect(band).toBeGreaterThanOrEqual(0)
      used.add(band)
    }
    expect(used.has(0)).toBe(true)
    expect(used.has(1)).toBe(true)
    expect(used.has(2)).toBe(true)
    if (visuals.grains[item_type].pattern === 'checker') expect(used.has(3)).toBe(true)
    expect(mesh.geometry.getAttribute('sway').count).toBe(color.count)
  })
  layer.dispose()
})

test('Tanjirize has alternating dark and green squares below the purple tips', () => {
  const { checker } = visuals.patterns
  expect(checker[0]!.slice(0, 2)).toEqual([3, 1])
  expect(checker[1]!.slice(0, 2)).toEqual([1, 3])
  expect(checker[2]!.slice(0, 2)).toEqual([3, 1])
  expect(checker[3]!.slice(0, 2)).toEqual([1, 3])
  expect(
    checker
      .slice(4)
      .flat()
      .filter((band) => band >= 0)
      .every((band) => band === 2)
  ).toBe(true)
})
