// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { Color, DirectionalLight, HemisphereLight, Mesh, PerspectiveCamera, Scene } from 'three'
import { MeshStandardNodeMaterial, WebGPURenderer } from 'three/webgpu'
import { float } from 'three/tsl'

import { create_board_occlusion } from '../src/board_occlusion.ts'
import { create_clouds } from '../src/clouds.ts'
import { opaque_canopy_mesh } from '../src/opaque_canopy.ts'
import { create_sky_node } from '../src/sky/sky_node.ts'
import { create_upload_queue } from '../src/upload_queue.ts'
import { create_terrain_pool } from '../src/terrain_pool.ts'
import { compile_world_recipe } from '../src/world_recipe.ts'
import { world_terrain } from '../src/world_catalog.ts'

/** Real packed canopy under grazing sunlight, without fog, bloom, point lights or sun shafts. */
export const canopy_lighting_probe = async (canvas: HTMLCanvasElement) => {
  const renderer = new WebGPURenderer({ canvas, antialias: true })
  renderer.setSize(innerWidth, innerHeight)
  await renderer.init()
  const scene = new Scene()
  scene.background = new Color('#182332')
  const camera = new PerspectiveCamera(45, innerWidth / innerHeight, 0.1, 100)
  camera.position.set(12, -3, 15)
  camera.lookAt(4, 4, 4)
  const sun = new DirectionalLight('#ffe2b5', 2.2)
  sun.position.set(-8, 9, -11)
  scene.add(sun, new HemisphereLight('#b9ced8', '#584834', 0.8))
  const sky = create_sky_node()
  const clouds = create_clouds({ scene, sky, quality: 'high', seed: 'canopy-light-probe' })
  const world = compile_world_recipe(world_terrain('nauvis'))
  const foliage = world.materials.entries.findIndex(({ preset }) => preset === 'foliage')
  const words: number[] = []
  for (let x = 1; x < 8; x += 2)
    for (let y = 1; y < 8; y += 2)
      for (let z = 1; z < 8; z += 2) {
        if (Math.hypot(x - 4, y - 4, z - 4) > 4.5) continue
        words.push(x | (y << 6) | (z << 12) | (2 << 28), foliage | (0xff << 20))
      }
  const data = opaque_canopy_mesh(
    { quads: new Uint32Array(words), quad_count: words.length / 2 },
    world.materials,
    'near'
  )
  const pool = create_terrain_pool({
    scene,
    world,
    quality: 'high',
    uploads: create_upload_queue(),
    sun_direction: sky.sun_direction,
    clouds,
    board_occlusion: create_board_occlusion(),
  })
  pool.upload(
    { key: 'canopy', origin: [0, 0, 0], coordinate: { x: 0, y: 0, z: 0 }, lod: 'near', resolution: 32, cell_size: 1 },
    data
  )
  const materials: MeshStandardNodeMaterial[] = []
  scene.traverse((object) => {
    if (
      object instanceof Mesh &&
      object.material instanceof MeshStandardNodeMaterial &&
      !materials.includes(object.material)
    )
      materials.push(object.material)
  })
  renderer.setAnimationLoop(() => {
    pool.set_view(camera, null)
    renderer.render(scene, camera)
  })
  return {
    max_roughness: () =>
      materials.forEach((material) => {
        material.roughnessNode = float(1)
        material.needsUpdate = true
      }),
    snapshot: () => ({
      materials: materials.length,
      lights: scene.children.filter((object) => object.type.endsWith('Light')).map((object) => object.type),
    }),
    dispose: () => {
      renderer.setAnimationLoop(null)
      pool.dispose()
      clouds.dispose()
      renderer.dispose()
    },
  }
}
