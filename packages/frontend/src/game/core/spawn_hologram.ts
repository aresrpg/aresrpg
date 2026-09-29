// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/* eslint-disable functional/immutable-data -- this lifecycle owns a canvas raster; drawing state and text caches stay local. */
import { wrap_caption, type Vec3, type WorldPanel } from '@aresrpg/engine'

import source from '../../../../../seed/scenes/spawn_hologram.json'
import logo_url from '../../../../../seed/scenes/aresrpg_text_logo.png'
import { read_app_state } from '../../store.ts'

import type { CameraFrame } from './cameras.ts'

type Panels = Readonly<{ set_world_panel: (id: string, panel: WorldPanel | null) => void }>

const paint = (canvas: Readonly<HTMLCanvasElement>, image: Readonly<HTMLImageElement>, text: string) => {
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Hologram canvas is unavailable')
  context.clearRect(0, 0, canvas.width, canvas.height)
  context.shadowColor = '#46ddff'
  context.shadowBlur = 18
  context.drawImage(image, 32, 0, 960, 320)
  context.font = '500 38px "JetBrains Mono", monospace'
  context.textAlign = 'center'
  context.fillStyle = '#c4f7ff'
  wrap_caption(text, (line) => context.measureText(line).width, 900).forEach((line, i) =>
    context.fillText(line, 512, 365 + i * 42)
  )
  context.shadowBlur = 0
  context.globalCompositeOperation = 'destination-out'
  context.fillStyle = '#0005'
  for (let y = 0; y < 512; y += 5) context.fillRect(0, y, 1024, 1)
  context.globalCompositeOperation = 'source-over'
}

/** Raster updates only when copy changes; position and orientation belong to a fixed world plane. */
export const create_spawn_hologram = (panels: Panels, ground: number) => {
  const position: Vec3 = [source.offset[0]!, ground + source.offset[1]!, source.offset[2]!]
  const canvas = document.createElement('canvas')
  canvas.width = 1024
  canvas.height = 512
  const image = new Image()
  image.src = logo_url
  let previous_text: string | null = null
  let previous_visible = false
  return {
    update: (view: CameraFrame, active: boolean) => {
      const text = read_app_state().copy?.world_hud.spawn_welcome
      if (!image.complete || image.naturalWidth === 0 || !text) return
      const visible = active && Math.hypot(...position.map((value, i) => value - view.position[i]!)) < source.range
      if (text === previous_text && visible === previous_visible) return
      paint(canvas, image, text)
      panels.set_world_panel('spawn-hologram', {
        canvas,
        position,
        size: [source.width, source.width / 2],
        yaw: source.yaw,
        visible,
      })
      previous_text = text
      previous_visible = visible
    },
    dispose: () => panels.set_world_panel('spawn-hologram', null),
  }
}

export const hologram_city = source.city
