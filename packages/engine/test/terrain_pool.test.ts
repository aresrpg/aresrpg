// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import { Mesh, OrthographicCamera, Scene, type Material, type InstancedBufferGeometry } from 'three'

import { create_board_occlusion } from '../src/board_occlusion.ts'
import { create_clouds } from '../src/clouds.ts'
import { create_flatten_uniform } from '../src/flatten.ts'
import { create_sky_node } from '../src/sky/sky_node.ts'
import { create_terrain_pool } from '../src/terrain_pool.ts'
import { parse_world_recipe } from '../src/world_recipe.ts'
import { world_terrain } from '../src/world_catalog.ts'

for (const quality of ['low', 'medium', 'high'] as const)
  test(`${quality}: flat terrain hides all voxel draws and restores cached geometry`, () => {
    const scene = new Scene()
    const sky = create_sky_node()
    const clouds = create_clouds({ scene, sky, quality, seed: 'visibility' })
    const flatten = create_flatten_uniform()
    const pool = create_terrain_pool({
      scene,
      quality,
      flatten,
      world: parse_world_recipe(world_terrain('nauvis')),
      sun_direction: sky.sun_direction,
      clouds,
      board_occlusion: create_board_occlusion(),
    })
    const [terrain, shadow] = scene.children.slice(-2) as Mesh<InstancedBufferGeometry, Material>[]
    expect(terrain!.geometry.getAttribute('position').count).toBe(4)
    expect(Array.from(terrain!.geometry.getIndex()!.array)).toEqual([0, 1, 2, 2, 1, 3])
    const camera = new OrthographicCamera(-20, 20, 20, -20, 1, 100)
    camera.position.set(0, 40, 0)
    camera.up.set(0, 0, -1)
    camera.lookAt(0, 0, 0)
    for (const [index, chunk] of (
      [
        { origin: [0, 128, 0], lod: 'near', resolution: 32, cell_size: 1 },
        { origin: [1024, 128, 0], lod: 'near', resolution: 32, cell_size: 1 },
        { origin: [0, 128, 0], lod: 'mid', resolution: 32, cell_size: 1 },
      ] as const
    ).entries()) {
      const { origin } = chunk
      pool.upload(
        {
          key: String(index),
          ...chunk,
          coordinate: { x: origin[0]! / 32, y: 4, z: 0 },
        },
        { quads: new Uint32Array([0, 0]), quad_count: 1 }
      )
    }
    expect(Array.from(terrain!.geometry.indirect!.array.slice(0, 5))).toEqual([6, 1, 0, 0, 0])
    pool.set_view(camera, camera)
    expect(terrain!.geometry.indirectOffset).toEqual([])
    for (const amount of [0.8, 1, 0.8]) {
      flatten.set(amount)
      pool.sync_flatten()
      pool.set_view(camera, camera)
      // The elevated nearby chunk enters view as it flattens; the far chunk stays culled.
      expect(terrain!.geometry.indirectOffset).toEqual(amount === 1 ? [] : [0, 40])
      expect(shadow!.geometry.indirectOffset).toEqual(amount === 1 ? [] : [0, 40])
      // Projection uses the fade material; the endpoint submits no voxel draws.
      expect(terrain!.material.alphaTest).toBe(0.5)
      expect(shadow!.material.alphaTest).toBe(0.5)
    }
    expect(pool.count()).toBe(3) // Flat mode changes draws, not residency.
    flatten.set(0)
    pool.sync_flatten()
    pool.set_view(camera, camera)
    expect(terrain!.geometry.indirectOffset).toEqual([])
    pool.set_quality('medium')
    const ordinary = terrain!.material
    pool.set_occlusion_active(true)
    const occluded = terrain!.material
    flatten.set(0.8)
    pool.sync_flatten()
    const fading = terrain!.material
    let disposed = 0
    for (const material of [ordinary, occluded, fading])
      material.addEventListener('dispose', () => {
        disposed += 1
      })
    for (const tier of ['high', 'medium'] as const) {
      pool.set_quality(tier)
      expect(terrain!.material).toBe(fading)
      flatten.set(0)
      pool.sync_flatten()
      expect(terrain!.material).toBe(occluded)
      pool.set_occlusion_active(false)
      expect(terrain!.material).toBe(ordinary)
      pool.set_occlusion_active(true)
      flatten.set(0.8)
      pool.sync_flatten()
    }
    expect(disposed).toBe(0)
    pool.set_quality('low')
    expect(disposed).toBe(3)
    expect(shadow!.castShadow).toBe(false)
    pool.set_quality('high')
    expect(terrain!.material).not.toBe(fading)
    expect(shadow!.castShadow).toBe(true)
    pool.dispose()
    clouds.dispose()
  })
