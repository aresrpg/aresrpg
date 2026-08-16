// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The shared fight-only render composition. It deliberately has no terrain streamer and no mode logic.
/* eslint-disable functional/immutable-data, functional/prefer-immutable-types, no-param-reassign -- HTMLCanvasElement is a mutable browser rendering boundary. */

import { create_engine, type EngineQuality, type FightBoardRender } from '@aresrpg/engine'

import { worlds_source } from '../../content/worlds.ts'
import { create_camera_director, create_fight_addon, type FightBoardFrame } from '../core/cameras.ts'

const EMPTY_FRAME: FightBoardFrame = Object.freeze({
  origin: Object.freeze({ x: 0, y: 0, z: 0 }),
  grid_w: 1,
  grid_h: 1,
  cell_size: 1,
})

export const create_fight_view = (canvas: HTMLCanvasElement, quality: EngineQuality) => {
  const world = worlds_source[0]
  if (!world?.terrain) throw new Error('The first world has no terrain recipe')
  const engine = create_engine({ canvas, quality, world: world.terrain })
  const unsubscribe_status = engine.subscribe_status((status) => {
    canvas.dataset.engineBackend = status.backend
    canvas.dataset.engineStatus = status.state
    if ('issue' in status && status.issue) canvas.dataset.engineIssue = status.issue.code
  })
  engine.set_flatten_amount(1)
  let frame = EMPTY_FRAME
  const camera = create_fight_addon({
    board: () => frame,
    viewport: () => Object.freeze([canvas.clientWidth, canvas.clientHeight]),
  })
  const director = create_camera_director(camera, canvas)

  engine.start(({ delta_seconds }) => {
    const view = director.frame(
      Object.freeze({
        x: frame.origin.x + (frame.grid_w * frame.cell_size) / 2,
        y: frame.origin.y,
        z: frame.origin.z + (frame.grid_h * frame.cell_size) / 2,
        eye_height: 0,
        speed: 0,
        on_ground: true,
      }),
      delta_seconds
    )
    engine.set_camera(view.position, view.target, {
      fov: view.fov,
      ortho_blend: view.ortho_blend,
      ortho_height: view.ortho_height,
    })
  })

  return Object.freeze({
    set_quality: engine.set_quality,
    set_entities: engine.set_entities,
    create_blob: engine.create_fight_blob,
    set_board: (board: FightBoardRender): void => {
      frame = Object.freeze({
        origin: board.origin,
        grid_w: board.width,
        grid_h: board.height,
        cell_size: board.cell_size,
      })
      camera.reset()
      engine.set_fight_board(board)
    },
    pick_cell: engine.pick_fight_cell,
    dispose: (): void => {
      unsubscribe_status()
      director.set_enabled(false)
      engine.dispose()
    },
  })
}
