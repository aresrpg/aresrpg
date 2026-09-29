// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import { Mesh, OrthographicCamera, Scene, type Material, type InstancedBufferGeometry } from 'three'

import { create_board_occlusion } from '../src/board_occlusion.ts'
import { create_clouds } from '../src/clouds.ts'
import { create_sky_node } from '../src/sky/sky_node.ts'
import { create_upload_queue } from '../src/upload_queue.ts'
import { create_terrain_pool } from '../src/terrain_pool.ts'
import { parse_world_recipe, compile_runtime_world_recipe } from '../src/world_recipe.ts'
import { world_terrain } from '../src/world_catalog.ts'

for (const { quality, canopy } of (['low', 'medium', 'high'] as const).flatMap((quality) =>
  (['voxels', 'clusters'] as const).map((canopy) => ({ quality, canopy }))
))
  test(`${quality}/${canopy}: terrain culls source bounds and reuses lit materials across quality changes`, () => {
    const scene = new Scene()
    const sky = create_sky_node()
    const clouds = create_clouds({ scene, sky, quality, seed: 'visibility' })

    const pool = create_terrain_pool({
      uploads: create_upload_queue(),
      scene,
      quality,

      world: compile_runtime_world_recipe({ ...parse_world_recipe(world_terrain('nauvis')), canopy }),
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
    pool.set_quality('medium')
    const ordinary = terrain!.material
    pool.set_occlusion_active(true)
    const occluded = terrain!.material
    let disposed = 0
    for (const material of [ordinary, occluded])
      material.addEventListener('dispose', () => {
        disposed += 1
      })
    for (const tier of ['high', 'medium'] as const) {
      pool.set_quality(tier)

      expect(terrain!.material).toBe(occluded)
      pool.set_occlusion_active(false)
      expect(terrain!.material).toBe(ordinary)
      pool.set_occlusion_active(true)
    }
    expect(disposed).toBe(0)
    pool.set_quality('low')
    expect(disposed).toBe(2)
    expect(shadow!.castShadow).toBe(false)
    pool.set_quality('high')
    expect(terrain!.material).not.toBe(ordinary)
    expect(shadow!.castShadow).toBe(true)
    pool.dispose()
    clouds.dispose()
  })
