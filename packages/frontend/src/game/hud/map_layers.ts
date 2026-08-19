// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// MAP LAYERS — the canvas painters the minimap lens and the full world map share: zone
// delimitation (unsearched veil + gold boundary + optional signed zone labels), spawn markers,
// live players, and the player arrow. One home for every overlay mark, whatever the map size.

import { chain_to_client_coordinate, client_to_chain_coordinate, world_center } from '@aresrpg/immutable'
import { ZONE_SIZE, zone_of } from '@aresrpg/protocol'

import type { spawn_markers } from '../../modules/world.ts'

import { to_canvas } from './minimap_render.ts'

const ORIGIN_ZONE = zone_of(world_center, world_center)

export type MapView = Readonly<{ center_x: number; center_z: number; size: number; radius: number }>

export const draw_zone_layer = (
  context: CanvasRenderingContext2D,
  view: MapView,
  discovered: (zx: number, zz: number) => boolean,
  labels = false
): void => {
  const { center_x, center_z, size, radius } = view
  const min_chain_x = client_to_chain_coordinate(center_x - radius)
  const min_chain_z = client_to_chain_coordinate(center_z - radius)
  const max_chain_x = client_to_chain_coordinate(center_x + radius)
  const max_chain_z = client_to_chain_coordinate(center_z + radius)
  const first = zone_of(Math.max(0, min_chain_x), Math.max(0, min_chain_z))
  const last = zone_of(Math.max(0, max_chain_x), Math.max(0, max_chain_z))
  for (let zx = first.zx; zx <= last.zx; zx += 1) {
    for (let zz = first.zz; zz <= last.zz; zz += 1) {
      const x0 = chain_to_client_coordinate(zx * ZONE_SIZE)
      const z0 = chain_to_client_coordinate(zz * ZONE_SIZE)
      const a = to_canvas(x0, z0, center_x, center_z, size, radius)
      const b = to_canvas(x0 + ZONE_SIZE, z0 + ZONE_SIZE, center_x, center_z, size, radius)
      if (!discovered(zx, zz)) {
        // the unsearched veil — the delimitation reads as territory, not just lines
        context.fillStyle = 'rgba(5, 5, 8, 0.42)'
        context.fillRect(a.px, a.pz, b.px - a.px, b.pz - a.pz)
      }
      context.strokeStyle = 'rgba(200, 150, 60, 0.38)'
      context.lineWidth = 1
      context.strokeRect(a.px + 0.5, a.pz + 0.5, b.px - a.px, b.pz - a.pz)
      if (labels) {
        // signed zone id, re-centred on the world origin — same convention as the compass line
        context.fillStyle = 'rgba(245, 208, 169, 0.55)'
        context.font = '500 11px var(--font-mono, monospace)'
        context.textAlign = 'left'
        context.textBaseline = 'top'
        context.fillText(`${zx - ORIGIN_ZONE.zx}·${zz - ORIGIN_ZONE.zz}`, a.px + 6, a.pz + 5)
      }
    }
  }
}

export const draw_spawn_markers = (
  context: CanvasRenderingContext2D,
  view: MapView,
  markers: ReturnType<typeof spawn_markers>
): void => {
  for (const marker of markers) {
    const { px, pz } = to_canvas(marker.x, marker.z, view.center_x, view.center_z, view.size, view.radius)
    if (px < 0 || pz < 0 || px > view.size || pz > view.size) continue
    if (marker.kind === 'mob') {
      context.save()
      context.translate(px, pz)
      context.rotate(Math.PI / 4)
      context.fillStyle = '#f87171'
      context.fillRect(-3, -3, 6, 6)
      context.restore()
    } else {
      context.fillStyle = '#c8963c'
      context.beginPath()
      context.arc(px, pz, 3, 0, Math.PI * 2)
      context.fill()
    }
  }
}

export const draw_players = (
  context: CanvasRenderingContext2D,
  view: MapView,
  players: readonly Readonly<{ x: number; z: number }>[]
): void => {
  for (const player of players) {
    const { px, pz } = to_canvas(
      chain_to_client_coordinate(player.x),
      chain_to_client_coordinate(player.z),
      view.center_x,
      view.center_z,
      view.size,
      view.radius
    )
    if (px < 0 || pz < 0 || px > view.size || pz > view.size) continue
    context.fillStyle = '#4a9eff'
    context.beginPath()
    context.arc(px, pz, 3.5, 0, Math.PI * 2)
    context.fill()
    context.strokeStyle = 'rgba(10, 10, 15, 0.8)'
    context.lineWidth = 1
    context.stroke()
  }
}

/** The player — a gold arrow rotated to the camera heading. */
export const draw_self_arrow = (
  context: CanvasRenderingContext2D,
  view: MapView,
  x: number,
  z: number,
  heading: number
): void => {
  const self = to_canvas(x, z, view.center_x, view.center_z, view.size, view.radius)
  context.save()
  context.translate(self.px, self.pz)
  context.rotate(heading)
  context.fillStyle = '#f5d0a9'
  context.strokeStyle = 'rgba(10, 10, 15, 0.9)'
  context.lineWidth = 1.5
  context.beginPath()
  context.moveTo(0, -7)
  context.lineTo(5, 6)
  context.lineTo(0, 3)
  context.lineTo(-5, 6)
  context.closePath()
  context.fill()
  context.stroke()
  context.restore()
}
