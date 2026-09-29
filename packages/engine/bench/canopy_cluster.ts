// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { Color, DirectionalLight, HemisphereLight, PerspectiveCamera, Scene } from 'three'
import { WebGPURenderer } from 'three/webgpu'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'

import { create_board_occlusion } from '../src/board_occlusion.ts'
import { create_clouds } from '../src/clouds.ts'
import { opaque_canopy_mesh } from '../src/opaque_canopy.ts'
import { create_sky_node } from '../src/sky/sky_node.ts'
import { create_upload_queue } from '../src/upload_queue.ts'
import { create_terrain_pool } from '../src/terrain_pool.ts'
import { compile_world_recipe, parse_world_recipe } from '../src/world_recipe.ts'
import { world_terrain } from '../src/world_catalog.ts'

const start = async (): Promise<void> => {
  const renderer = new WebGPURenderer({ canvas: document.querySelector('canvas')!, antialias: true })
  renderer.setSize(innerWidth, innerHeight)
  await renderer.init()
  const scene = new Scene()
  scene.background = new Color('#bfc6cc')
  const camera = new PerspectiveCamera(40, innerWidth / innerHeight, 0.1, 100)
  const below = new URLSearchParams(location.search).get('view') === 'below'
  camera.position.set(11, below ? 1 : 8, 12)
  const controls = new OrbitControls(camera, renderer.domElement)
  controls.target.set(3, 3, 3)
  controls.update()
  const sun = new DirectionalLight('#fff3d6', 2.2)
  sun.position.set(8, 14, 9)
  scene.add(sun, new HemisphereLight('#d2e6fb', '#666344', 1.1))
  const sky = create_sky_node()
  const clouds = create_clouds({ scene, sky, quality: 'high', seed: 'cluster-review' })
  const compiled = compile_world_recipe({ ...parse_world_recipe(world_terrain('nauvis')), canopy: 'clusters' })
  const foliage = compiled.materials.entries.findIndex(({ preset }) => preset === 'foliage')
  const mesh = opaque_canopy_mesh(
    { quads: new Uint32Array([2 | (2 << 6) | (2 << 12) | (2 << 28), foliage | (0xff << 20)]), quad_count: 1 },
    compiled.materials,
    'near'
  )
  const pool = create_terrain_pool({
    uploads: create_upload_queue(),
    scene,
    quality: 'high',
    world: compiled,
    sun_direction: sky.sun_direction,
    clouds,
    board_occlusion: create_board_occlusion(),
  })
  pool.upload(
    { key: 'cluster', origin: [0, 0, 0], coordinate: { x: 0, y: 0, z: 0 }, lod: 'near', resolution: 32, cell_size: 1 },
    mesh
  )
  renderer.setAnimationLoop(() => {
    controls.update()
    pool.set_view(camera, null)
    renderer.render(scene, camera)
    document.body.dataset.ready = 'true'
  })
  window.addEventListener(
    'pagehide',
    () => {
      renderer.setAnimationLoop(null)
      controls.dispose()
      pool.dispose()
      clouds.dispose()
      renderer.dispose()
    },
    { once: true }
  )
}
void start().catch((error: unknown) => {
  console.error(error)
  document.body.textContent = String(error)
})
