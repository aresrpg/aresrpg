// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { PerspectiveCamera, Scene, SRGBColorSpace, WebGLRenderer } from 'three'

import { quality_pixel_ratio } from './quality.ts'
import { create_hack_presentation } from './hack_presentation.ts'
import { create_fight_board_layer } from './fight_board.ts'
import { create_entity_layer } from './entities.ts'
import type { EngineBackend } from './backend.ts'
import type { EnginePresentation, EngineQuality, Vec3 } from './types.ts'

export const create_grid_fallback = (
  canvas: HTMLCanvasElement,
  initial_quality: EngineQuality,
  presentation_mode: EnginePresentation = 'world'
): EngineBackend => {
  const renderer = new WebGLRenderer({ canvas, antialias: false, powerPreference: 'low-power' })
  renderer.outputColorSpace = SRGBColorSpace
  const scene = new Scene()
  const camera = new PerspectiveCamera(48, 1, 0.1, 3000)
  const fight_board = create_fight_board_layer({ scene, camera, canvas })
  const entities = create_entity_layer({ scene })
  const presentation = create_hack_presentation(scene)
  let quality = initial_quality
  let flattened = false
  let previous_frame = performance.now()
  let render_width = 0
  let render_height = 0
  let render_pixel_ratio = 0

  const draw = (now = performance.now()): void => {
    const delta_seconds = Math.min(0.1, Math.max(0, now - previous_frame) / 1000)
    previous_frame = now
    const width = Math.max(1, canvas.clientWidth)
    const height = Math.max(1, canvas.clientHeight)
    const pixel_ratio = quality_pixel_ratio({
      quality,
      css_width: width,
      css_height: height,
      device_pixel_ratio: devicePixelRatio,
      presentation: presentation_mode,
    })
    if (width !== render_width || height !== render_height || pixel_ratio !== render_pixel_ratio) {
      render_width = width
      render_height = height
      render_pixel_ratio = pixel_ratio
      renderer.setPixelRatio(pixel_ratio)
      renderer.setSize(width, height, false)
      camera.aspect = width / height
      camera.updateProjectionMatrix()
    }
    presentation.tick(delta_seconds, camera)
    fight_board.tick(now)
    entities.tick(now)
    renderer.render(scene, camera)
  }

  return Object.freeze({
    kind: 'grid',
    render: draw,
    set_camera: (position: Vec3, target: Vec3, _projection = {}) => {
      camera.position.set(...position)
      camera.lookAt(...target)
    },
    set_quality: (next: EngineQuality) => {
      quality = next
    },
    set_time_of_day: () => {},
    set_flatten_amount: (amount: number) => {
      flattened = amount >= 1
    },
    set_fight_board: (board) => {
      fight_board.set(board)
      entities.set_board(board)
    },
    set_entities: entities.set,
    upsert_fight_blob: fight_board.upsert_blob,
    remove_fight_blob: fight_board.remove_blob,
    pick_fight_cell: fight_board.pick,
    render_chunk: () => Promise.resolve('rendered' as const),
    remove_chunk: () => {},
    chunk_count: () => 0,
    render_state: () => ({
      settled: true,
      mesh_queued: 0,
      mesh_active: 0,
      uploads_pending: 0,
      uploads_blocked: 0,
      retries_pending: 0,
      failed_chunks: 0,
      far_ready: true,
      sky_ready: true,
    }),
    flattened: () => flattened,
    dispose: () => {
      fight_board.dispose()
      entities.dispose()
      presentation.dispose()
      renderer.dispose()
    },
  })
}
