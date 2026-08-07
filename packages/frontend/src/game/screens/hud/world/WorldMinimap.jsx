// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// In-world minimap (top-left). Reuses the SAME deterministic terrain SSOT the roam scene streams
// (@aresrpg/sim world_biome / world_cell + the shared biome palette) so the readout can never drift
// from the world; companion-token chrome. Redraws only when the player's cell, seed, or the visible
// mob-group set changes (never per-frame): player_cell is published by the imperative scene on cell
// change; mob anchors come from visible_mobs_group (server-authoritative). Player dot = companion
// cyan; mob-group anchors = red.

import { useEffect, useRef } from 'react'

import { CELL, WORLD_SEED, world_biome, world_cell } from '@aresrpg/sim/world'

import { BIOME_FILL, OBSTACLE_SHADE } from '../biome-colors.js'
import { useGameState, context } from '../../../store.js'

const GRID = 31 // cells across (odd → the player sits dead-center)
const PIXELS = 150 // canvas edge in CSS px (matches the mockup minimap body)
const HALF = (GRID - 1) / 2

/**
 * Paint the GRID×GRID terrain window centered on (cx, cy), then the red mob-group dots and the cyan
 * player dot at center.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} cx @param {number} cy @param {number} seed
 * @param {{ x: number, y: number }[]} mobs world-cell anchors of the visible groups
 * @returns {void}
 */
const draw = (ctx, cx, cy, seed, mobs) => {
  const paint_ctx = ctx
  const cell_px = PIXELS / GRID
  paint_ctx.clearRect(0, 0, PIXELS, PIXELS)
  for (let gy = 0; gy < GRID; gy++) {
    for (let gx = 0; gx < GRID; gx++) {
      const wx = cx + gx - HALF
      const wy = cy + gy - HALF
      const px = gx * cell_px
      const py = gy * cell_px
      // +1px overdraw closes the sub-pixel seams between cells (cell_px is fractional)
      Reflect.set(paint_ctx, 'fillStyle', BIOME_FILL[world_biome(seed, wx, wy)] ?? BIOME_FILL.plains)
      paint_ctx.fillRect(px, py, cell_px + 1, cell_px + 1)
      if (world_cell(seed, wx, wy) === CELL.OBSTACLE) {
        Reflect.set(paint_ctx, 'fillStyle', OBSTACLE_SHADE)
        paint_ctx.fillRect(px, py, cell_px + 1, cell_px + 1)
      }
    }
  }
  // red mob-group dots (skip any outside the window)
  for (const { x, y } of mobs) {
    const gx = x - cx + HALF
    const gy = y - cy + HALF
    if (gx < 0 || gx >= GRID || gy < 0 || gy >= GRID) continue
    paint_ctx.beginPath()
    paint_ctx.arc((gx + 0.5) * cell_px, (gy + 0.5) * cell_px, cell_px * 0.9, 0, Math.PI * 2)
    Reflect.set(paint_ctx, 'fillStyle', '#ff6b6b')
    paint_ctx.fill.call(paint_ctx)
  }
  // cyan player dot at the center cell (companion --color-cyan #4a9eff)
  const c = PIXELS / 2
  const r = cell_px * 0.9
  paint_ctx.beginPath()
  paint_ctx.arc(c, c, r * 2.1, 0, Math.PI * 2)
  Reflect.set(paint_ctx, 'fillStyle', 'rgba(74, 158, 255, 0.18)')
  paint_ctx.fill.call(paint_ctx)
  paint_ctx.beginPath()
  paint_ctx.arc(c, c, r, 0, Math.PI * 2)
  Reflect.set(paint_ctx, 'fillStyle', '#4a9eff')
  Reflect.set(paint_ctx, 'strokeStyle', 'rgba(7, 9, 13, 0.85)')
  Reflect.set(paint_ctx, 'lineWidth', 1)
  paint_ctx.fill.call(paint_ctx)
  paint_ctx.stroke()
}

/** @returns {import('react').ReactElement} */
export function WorldMinimap() {
  const player_cell = useGameState((s) => s.player_cell)
  // stable signal: a digest of the visible group ids (the Map ref never changes — see mob_groups.js)
  const mob_signal = useGameState((s) => {
    let sig = ''
    for (const id of s.visible_mobs_group.keys()) sig += `${id}|`
    return sig
  })
  const canvas_ref = useRef(/** @type {HTMLCanvasElement | null} */ (null))

  const cx = player_cell?.x ?? 0
  const cy = player_cell?.y ?? 0
  const seed = player_cell?.seed ?? WORLD_SEED

  useEffect(() => {
    const canvas = canvas_ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    // a mob group's FIXED anchor world position → cell (world_to_cell in roam.js: round(x), round(z))
    const mobs = Array.from(context.get_state().visible_mobs_group.values()).map((g) => ({
      x: Math.round(g.position.x),
      y: Math.round(g.position.z),
    }))
    draw(ctx, cx, cy, seed, mobs)
  }, [cx, cy, seed, mob_signal])

  return (
    <div className="gw-minimap gw-panel" aria-label="Minimap">
      <span className="gw-minimap__lbl">
        Whisperwood · {cx},{cy}
      </span>
      <div className="gw-minimap__map">
        <canvas ref={canvas_ref} width={PIXELS} height={PIXELS} />
      </div>
    </div>
  )
}
