// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test } from 'bun:test'
import { InstancedMesh, Matrix4, Scene } from 'three'

import { grain_stalk } from '../src/nature/grain_stalk.ts'
import { create_resource_node_layer, resource_nodes_visible, resource_visual } from '../src/resource_nodes.ts'

describe('resource node visuals', () => {
  test('gathering reuses GPU meshes and materials; capacity growth releases only the old instance buffer', () => {
    const scene = new Scene()
    const layer = create_resource_node_layer({ scene, wind: true })
    const marker = { id: 'wheat', x: 4, y: 80, z: 9, item_type: 'wheat', job: 'FARMER', tier: 1 }
    const rows = Array.from({ length: 8 }, (_, index) => ({ ...marker, id: String(index), x: index }))
    layer.set_flatten(1)
    layer.set_markers(rows)
    const mesh = scene.children.find((child): child is InstancedMesh => child instanceof InstancedMesh)!
    expect(scene.children).toHaveLength(1)
    const { geometry, material } = mesh
    let disposed = 0
    mesh.addEventListener('dispose', () => {
      disposed += 1
    })
    layer.set_markers(rows.slice(1))
    expect(scene.children).toContain(mesh)
    expect(mesh.count).toBe(7)
    expect(mesh.geometry).toBe(geometry)
    expect(mesh.material).toBe(material)
    expect(disposed).toBe(0)
    const larger = Array.from({ length: 40 }, (_, index) => ({ ...marker, id: String(index), x: index }))
    layer.set_markers(larger)
    const grown = scene.children.find((child): child is InstancedMesh => child instanceof InstancedMesh)!
    expect(grown.count).toBe(40)
    expect(grown.geometry).toBe(geometry)
    expect(grown.material).toBe(material)
    expect(disposed).toBe(1)
    let released = 0
    grown.addEventListener('dispose', () => {
      released += 1
    })
    layer.set_markers([])
    expect(released).toBe(1)
    expect(scene.children).toHaveLength(0)
    layer.dispose()
  })

  test('world resources stay visible when flat and disappear for the entire fight-board lifetime', () => {
    expect(resource_nodes_visible({ terrain_presented: true, board_active: false })).toBeTrue()
    expect(resource_nodes_visible({ terrain_presented: true, board_active: true })).toBeFalse()
    expect(resource_nodes_visible({ terrain_presented: false, board_active: false })).toBeFalse()
  })

  test('resource geometry and labels follow flattening, arrivals, and restoration without rebuilding', () => {
    const scene = new Scene()
    const layer = create_resource_node_layer({ scene })
    const marker = { id: 'wheat', x: 4, y: 80, z: 9, item_type: 'wheat', job: 'FARMER', tier: 1 }
    layer.set_markers([marker])
    layer.set_visible(true)
    const mesh = scene.children.find((child): child is InstancedMesh => child instanceof InstancedMesh)!
    const { geometry } = mesh
    const matrix = new Matrix4()

    layer.set_flatten(0.6)
    mesh.getMatrixAt(0, matrix)
    expect(matrix.elements[13]).toBeCloseTo(40)
    expect(layer.label_anchor('wheat')?.y).toBeCloseTo(42.1)
    layer.set_flatten(1)
    mesh.getMatrixAt(0, matrix)
    expect(matrix.elements[13]).toBe(0)
    expect(mesh.visible).toBeTrue()
    expect(mesh.geometry).toBe(geometry)
    expect(mesh.boundingSphere!.center.y).toBeLessThan(5)
    expect(layer.label_anchor('wheat')?.y).toBeCloseTo(2.1)
    layer.set_flatten(0)
    mesh.getMatrixAt(0, matrix)
    expect(matrix.elements[13]).toBe(80)
    expect(layer.label_anchor('wheat')?.y).toBeCloseTo(82.1)

    layer.set_flatten(1)
    layer.set_markers([{ ...marker, id: 'new', y: 120 }])
    const arriving = scene.children.find((child): child is InstancedMesh => child instanceof InstancedMesh)!
    arriving.getMatrixAt(0, matrix)
    expect(matrix.elements[13]).toBe(0)
    expect(layer.label_anchor('wheat')).toBeNull()
    expect(layer.label_anchor('new')?.y).toBeCloseTo(2.1)
    layer.set_flatten(0)
    arriving.getMatrixAt(0, matrix)
    expect(matrix.elements[13]).toBe(120)
    layer.dispose()
    expect(scene.children).toHaveLength(0)
  })

  test('the three gathering jobs select distinct silhouettes', () => {
    expect(
      (
        [
          ['wheat', 'FARMER'],
          ['green_mushroom', 'HERBALIST'],
          ['quartz', 'MINER'],
        ] as const
      ).map(([item_type, job]) => resource_visual(item_type, job, 1).silhouette)
    ).toEqual(['grain', 'mushroom', 'ore'])
  })

  test('all 33 job-tier resources have a distinct family and palette rung', () => {
    const visuals = ['FARMER', 'HERBALIST', 'MINER'].flatMap((job) =>
      Array.from({ length: 11 }, (_, index) => resource_visual(`${job}:${index}`, job, index + 1))
    )
    expect(new Set(visuals.map(({ family, body }) => `${family}:${body.join(':')}`)).size).toBe(33)
  })

  test('tiers clamp to the authored 1..11 range', () => {
    expect(resource_visual('quartz', 'MINER', 0)).toEqual(resource_visual('quartz', 'MINER', 1))
    expect(resource_visual('diamond', 'MINER', 99)).toEqual(resource_visual('diamond', 'MINER', 11))
  })

  test('ivory shrooms use a bright mushroom identity instead of the generic herbalist plant', () => {
    const ivory = resource_visual('ivory_shrooms', 'HERBALIST', 3)
    const green = resource_visual('green_mushroom', 'HERBALIST', 1)

    expect(ivory.silhouette).toBe('mushroom')
    expect(Math.min(...ivory.accent)).toBeGreaterThan(0.65)
    expect(Math.max(...ivory.accent) - Math.min(...ivory.accent)).toBeLessThan(0.35)
    expect(green.silhouette).toBe('mushroom')
    expect(green.accent[1]).toBeGreaterThan(green.accent[0])
  })

  test('one farmer node is a dense wheat clump rather than one oversized stalk', () => {
    const recipe = grain_stalk(() => 0.5)

    expect(recipe.length).toBeGreaterThan(400)
    expect(Math.max(...recipe.map(([x]) => x)) - Math.min(...recipe.map(([x]) => x))).toBeGreaterThan(1)
  })

  test('living resource geometry carries the shared wind deformation while minerals stay rigid', () => {
    const scene = new Scene()
    const layer = create_resource_node_layer({ scene, wind: true })
    layer.set_markers([
      { id: 'wheat', x: 0, y: 0, z: 0, item_type: 'wheat', job: 'FARMER', tier: 1 },
      { id: 'iron', x: 2, y: 0, z: 0, item_type: 'iron', job: 'MINER', tier: 1 },
    ])
    const meshes = scene.children.filter((child): child is InstancedMesh => child instanceof InstancedMesh)
    const wheat = meshes.find((mesh) => mesh.geometry.getAttribute('sway') !== undefined)
    const iron = meshes.find((mesh) => mesh.geometry.getAttribute('sway') === undefined)

    expect(wheat).toBeDefined()
    expect((wheat?.material as { positionNode?: unknown }).positionNode).toBeDefined()
    expect(iron).toBeDefined()
    layer.dispose()
  })

  test('resource labels expose one stable world anchor to the shared per-frame label renderer', () => {
    const scene = new Scene()
    const layer = create_resource_node_layer({ scene })
    layer.set_markers([{ id: 'wheat', x: 4, y: 7, z: 9, item_type: 'wheat', job: 'FARMER', tier: 1 }])
    layer.set_visible(true)

    expect(layer.label_anchor('wheat')?.toArray()).toEqual([4, 9.1, 9])
    layer.set_visible(false)
    expect(layer.label_anchor('wheat')).toBeNull()
  })

  test('resource identity splits same-tier herbalists and ivory shrooms have grounded 3D caps', () => {
    const scene = new Scene()
    const layer = create_resource_node_layer({ scene, wind: true })
    layer.set_markers([
      { id: 'ivory', x: 0, y: 0, z: 0, item_type: 'ivory_shrooms', job: 'HERBALIST', tier: 3 },
      { id: 'orchid', x: 2, y: 0, z: 0, item_type: 'red_orchid', job: 'HERBALIST', tier: 3 },
    ])
    const meshes = scene.children.filter((child): child is InstancedMesh => child instanceof InstancedMesh)
    const ivory = meshes.find(({ name }) => name === 'resource:ivory_shrooms')

    expect(meshes).toHaveLength(2)
    expect(ivory).toBeDefined()
    expect(
      Array.from(ivory!.geometry.getAttribute('normal').array).some(
        (value, index) => index % 3 === 1 && Math.abs(value) > 0.9
      )
    ).toBeTrue()
    layer.dispose()
  })
})
