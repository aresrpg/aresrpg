// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import {
  create_engine,
  compile_world_recipe,
  BIOME_SLOTS,
  create_terrain_planner,
  type EngineQuality,
} from '@aresrpg/engine'

import { create_chunk_manager } from '../../src/game/core/chunks.ts'

const fight = new URLSearchParams(location.search).has('fight')
const floor = new URLSearchParams(location.search).has('shore') ? 60 : 59
const world = compile_world_recipe({
  seed: 'water-regression',
  sea_level: 60,
  liquid: 'water',
  portal: false,
  atmosphere: 'clear',
  materials: { sand: { color: '#d5bc7f', preset: 'sand' }, water: { color: '#2e609e', preset: 'water' } },
  biome_slots: Object.fromEntries(BIOME_SLOTS.map((slot) => [slot, 'bed'])),
  biomes: [
    {
      name: 'bed',
      landscape: [
        { x: 0, y: floor, land: { surface: 'sand', subsurface: 'sand', filler: 'sand' } },
        { x: 1, y: floor },
      ],
    },
  ],
})
const canvas = document.querySelector('canvas')!
const engine = create_engine({ canvas, world, quality: 'high', render_distance: 2 })
const planner = create_terrain_planner(world.recipe)
const chunks = create_chunk_manager({
  engine,
  initial_quality: 'high',
  initial_render_distance: 2,
  plan_layers: planner.plan,
})
const probe = {
  ready: false,
  quality: (quality: EngineQuality) => {
    probe.ready = false
    engine.set_quality(quality, 2)
    chunks.set_quality(quality, 2)
  },
  phase: (time: number) => engine.set_time_of_day(time),
  camera: (origin: number, height: number, aim: number) => {
    probe.ready = false
    chunks.set_focus(origin, origin)
    engine.set_camera([origin, height, origin], [origin + 10, height + aim, origin + 10], { fov: 70 })
  },
  advance: async (milliseconds: number) => {
    const until = performance.now() + milliseconds
    do {
      await new Promise(requestAnimationFrame)
    } while (performance.now() < until)
  },
  dispose: () => {
    window.removeEventListener('pagehide', probe.dispose)
    chunks.dispose()
    planner.dispose()
    engine.dispose()
  },
}
chunks.set_focus(0, 0)
engine.set_clouds_visible(false)
engine.set_time_of_day(0.32)
engine.set_audio_volume(0)
engine.set_camera([5, 63, 0], [-5, 60, 0], { fov: 45 })
if (fight) {
  engine.set_fight_board({
    width: 8,
    height: 8,
    cell_size: 2,
    origin: { x: -8, y: 64, z: -8 },
    cells: Array.from({ length: 64 }, (_, cell) => ({
      cell,
      x: cell % 8,
      y: Math.floor(cell / 8),
      kind: cell % 8 === 0 || cell % 8 === 7 || cell < 8 || cell >= 56 ? 'floor' : 'hole',
    })),
  })
  engine.set_camera([16, 84, 16], [0, 64, 0], { ortho_blend: 1, ortho_height: 22 })
}
engine.start(() => {
  chunks.tick()
  const { resident, planning, queued, in_flight, evicting } = chunks.stats()
  probe.ready = resident > 0 && planning + queued + in_flight + evicting === 0 && engine.render_state().settled
})
declare global {
  interface Window {
    water_probe: typeof probe
  }
}
window.water_probe = probe
window.addEventListener('pagehide', probe.dispose, { once: true })
