// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { PerspectiveCamera, Scene, SRGBColorSpace, Vector3, WebGLRenderer } from 'three'

import { quality_pixel_ratio } from './quality.ts'
import { create_hack_presentation } from './hack_presentation.ts'
import { create_fight_board_layer } from './fight_board.ts'
import { create_fight_sword_layer, fight_swords_visible } from './fight_swords.ts'
import { create_entity_layer } from './entities.ts'
import { create_entity_label_layer } from './entity_labels.ts'
import { create_resource_node_layer, resource_nodes_visible } from './resource_nodes.ts'
import { create_fight_presentation } from './fight_presentation.ts'
import { create_transient_effects } from './transient_effects.ts'
import { project_screen_anchor } from './screen_projection.ts'
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
  const camera = new PerspectiveCamera(70, 1, 0.1, 3000)
  const fight_board = create_fight_board_layer({ scene, camera, canvas })
  const entities = create_entity_layer({ scene })
  const entity_labels = create_entity_label_layer({ canvas, scene, camera, entities })
  const resource_nodes = create_resource_node_layer({ scene })
  const effects = create_transient_effects({ scene, entities })
  const fight_presentation = create_fight_presentation({ entities, vfx: effects })
  const presentation = create_hack_presentation(scene)
  let fight_swords: ReturnType<typeof create_fight_sword_layer> | null = null
  let quality = initial_quality
  let flattened = false
  let board_active = false
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
      entity_labels.resize(width, height)
      camera.aspect = width / height
      camera.updateProjectionMatrix()
    }
    presentation.tick(delta_seconds, camera)
    fight_board.tick(now)
    entities.tick(now)
    effects.tick(now)
    fight_swords?.tick(now)
    renderer.render(scene, camera)
    entity_labels.render()
  }

  return Object.freeze({
    kind: 'grid',
    render: draw,
    set_camera: (position: Vec3, target: Vec3, _projection = {}) => {
      camera.position.set(...position)
      camera.lookAt(...target)
    },
    set_character_anchor: () => {},
    set_quality: (next: EngineQuality) => {
      quality = next
    },
    set_time_of_day: () => {},
    set_flatten_amount: (amount: number) => {
      flattened = amount >= 1
      resource_nodes.set_visible(resource_nodes_visible({ terrain_presented: true, flattened, board_active }))
    },
    set_fight_board: (board) => {
      board_active = board !== null
      resource_nodes.set_visible(resource_nodes_visible({ terrain_presented: true, flattened, board_active }))
      fight_swords?.set_visible(fight_swords_visible(board_active))
      fight_board.set(board)
      entities.set_board(board)
    },
    set_entities: (next) => {
      const ground_y = next.find(({ anchor }) => anchor.kind === 'world')?.anchor
      if (ground_y?.kind === 'world') presentation.set_ground_y(ground_y.position[1])
      entities.set(next)
    },
    set_fight_swords: (url, impact_sound_url, markers) => {
      fight_swords ??= create_fight_sword_layer({
        scene,
        url,
        impact_sound_url,
        impact: effects.play_sword_impact,
      })
      fight_swords.set_visible(fight_swords_visible(board_active))
      fight_swords.set_markers(markers)
    },
    set_fight_sword_label: (id, element) => fight_swords?.set_label(id, element),
    set_resource_nodes: resource_nodes.set_markers,
    set_resource_node_label: resource_nodes.set_label,
    // the retrowave fallback has no world dressing — there is no gate to label
    set_portal_label: () => {},
    set_dungeon_portals: () => {},
    set_dungeon_stage: () => {},
    animate_entity: entities.animate,
    play_fight_cue: fight_presentation.play,
    play_jump_puff: effects.play_jump_puff,
    project_entity: (id) => {
      const anchor = entities.world_anchor(id)
      return anchor ? project_screen_anchor(anchor, camera, canvas.getBoundingClientRect()) : null
    },
    set_entity_label: entity_labels.set,
    set_world_label: (id, element, position) =>
      entity_labels.set_static(id, element, new Vector3(...(position ?? [0, 0, 0]))),
    entity_height: entities.entity_height,
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
      entity_labels.dispose()
      fight_board.dispose()
      effects.dispose()
      resource_nodes.dispose()
      entities.dispose()
      presentation.dispose()
      renderer.dispose()
    },
  })
}
