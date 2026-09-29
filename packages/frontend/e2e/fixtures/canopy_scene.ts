// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { BIOME_SLOTS, create_engine, create_terrain_planner, compile_runtime_world_recipe } from '@aresrpg/engine'

import environment from '../../../../seed/content/adventure_environment.json'

const world = compile_runtime_world_recipe({
  seed: 'canopy-distance-review',
  sea_level: 0,
  materials: environment.materials,
  canopy: 'clusters',
  atmosphere: 'clear',
  biome_slots: Object.fromEntries(BIOME_SLOTS.map((slot) => [slot, 'review'])),
  biomes: [
    {
      name: 'review',
      landscape: [
        { x: 0, y: 64, land: { surface: 'moss', subsurface: 'rich_soil', filler: 'deep_stone' } },
        { x: 1, y: 64 },
      ],
    },
  ],
  fixed_structures: [
    { source: 'adventure_ancient_tree', origin: [-30, 64, 90], scale: 2, rotation: 0 },
    { source: 'adventure_ancient_tree', origin: [180, 64, 300], scale: 2, rotation: 0 },
  ],
})
const engine = create_engine({
  canvas: document.querySelector('canvas')!,
  world,
  quality: 'high',
  initial_focus: [0, 128],
})
const planner = create_terrain_planner(world.recipe)
engine.set_camera([0, 75, 0], [0, 94, 130], { fov: 80 })
engine.set_time_of_day(environment.time_of_day)
engine.set_audio_volume(0)
engine.start()
const columns = Array.from({ length: 11 * 12 }, (_, index) => ({ x: (index % 11) - 3, z: Math.floor(index / 11) }))
void planner
  .plan(columns)
  .then((plans) =>
    Promise.all(
      plans.flatMap(({ x, z, layers }) =>
        layers.map((y) =>
          engine.render_chunk({ key: `${x}:${y}:${z}`, coordinate: { x, y, z }, lod: z < 4 ? 'near' : 'far' })
        )
      )
    )
  )
  .then((outcomes) => {
    if (outcomes.some((outcome) => outcome !== 'rendered')) throw new Error('Canopy review chunks did not render')
    document.body.dataset.ready = 'true'
  })
  .catch((error: unknown) => console.error(error))
window.addEventListener(
  'pagehide',
  () => {
    planner.dispose()
    engine.dispose()
  },
  { once: true }
)
