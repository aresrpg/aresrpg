// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/* eslint-disable fp-law/no-mutating-methods, functional/immutable-data, functional/prefer-immutable-types, no-param-reassign -- canvas rendering is an explicit effect boundary over its mutable drawing context. */
// MAP LAYERS — the canvas painters the minimap lens and the full world map share: zone
// delimitation (unsearched veil + gold boundary + optional signed zone labels), spawn markers,
// live players, and the player arrow. One home for every overlay mark, whatever the map size.

import { chain_to_client_coordinate, client_to_chain_coordinate, world_center } from '@aresrpg/immutable'
import { ZONE_SIZE, zone_of } from '@aresrpg/protocol'
import type { CityMapOverlay } from '@aresrpg/engine'

import type { spawn_markers } from '../../modules/world.ts'
import type { DungeonPortalMarker } from '../../modules/world_spawns.ts'

import { to_canvas } from './minimap_render.ts'

const ORIGIN_ZONE = zone_of(world_center, world_center)

export type MapView = Readonly<{ center_x: number; center_z: number; size: number; radius: number }>

const CITY_STRUCTURE_COLORS = Object.freeze([
  ['_road', 'rgba(185, 139, 85, 0.88)'],
  ['_field', 'rgba(137, 139, 63, 0.58)'],
  ['_garden', 'rgba(60, 125, 79, 0.68)'],
  ['_river', 'rgba(45, 122, 176, 0.82)'],
  ['_bridge', 'rgba(112, 76, 48, 0.9)'],
  ['_plaza', 'rgba(216, 200, 155, 0.92)'],
  ['_ruin', 'rgba(112, 119, 119, 0.86)'],
  ['_temple', 'rgba(47, 127, 134, 0.9)'],
  ['_gate', 'rgba(168, 95, 63, 0.9)'],
] as const)
const city_structure_color = (type: string): string =>
  CITY_STRUCTURE_COLORS.find(([suffix]) => type.endsWith(suffix))?.[1] ?? 'rgba(216, 200, 155, 0.78)'

const canvas_bounds = (
  view: MapView,
  bounds: Readonly<{ min_x: number; max_x: number; min_z: number; max_z: number }>
) => {
  const a = to_canvas(bounds.min_x, bounds.min_z, view.center_x, view.center_z, view.size, view.radius)
  const b = to_canvas(bounds.max_x + 1, bounds.max_z + 1, view.center_x, view.center_z, view.size, view.radius)
  return Object.freeze({ x: a.px, y: a.pz, width: b.px - a.px, height: b.pz - a.pz })
}

const visible_in_view = (
  view: MapView,
  bounds: Readonly<{ min_x: number; max_x: number; min_z: number; max_z: number }>
): boolean =>
  bounds.max_x >= view.center_x - view.radius &&
  bounds.min_x <= view.center_x + view.radius &&
  bounds.max_z >= view.center_z - view.radius &&
  bounds.min_z <= view.center_z + view.radius

export const draw_city_layer = (
  context: CanvasRenderingContext2D,
  view: MapView,
  cities: readonly CityMapOverlay[]
): void => {
  const pixels_per_block = view.size / (view.radius * 2)
  for (const city of cities) {
    const territory = canvas_bounds(view, city.bounds)
    context.save()
    context.fillStyle = 'rgba(200, 150, 60, 0.055)'
    context.fillRect(territory.x, territory.y, territory.width, territory.height)
    context.strokeStyle = 'rgba(245, 196, 92, 0.95)'
    context.lineWidth = 2
    context.shadowColor = 'rgba(245, 196, 92, 0.85)'
    context.shadowBlur = 8
    context.strokeRect(territory.x + 1, territory.y + 1, territory.width - 2, territory.height - 2)
    const core = canvas_bounds(view, city.core)
    context.shadowBlur = 0
    context.setLineDash([6, 4])
    context.strokeStyle = 'rgba(88, 255, 148, 0.72)'
    context.lineWidth = 1.5
    context.strokeRect(core.x + 0.5, core.y + 0.5, core.width - 1, core.height - 1)
    context.setLineDash([])
    if (pixels_per_block >= 0.12)
      for (const structure of city.structures) {
        if (!visible_in_view(view, structure.bounds)) continue
        const footprint = canvas_bounds(view, structure.bounds)
        context.fillStyle = city_structure_color(structure.type)
        context.fillRect(footprint.x, footprint.y, Math.max(1, footprint.width), Math.max(1, footprint.height))
      }
    context.restore()
  }
}

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

/** The active position run owns the selected zone highlight on the full map. */
export const draw_zone_selection = (
  context: CanvasRenderingContext2D,
  view: MapView,
  zone: Readonly<{ zx: number; zz: number }> | null
): void => {
  if (!zone) return
  const x = chain_to_client_coordinate(zone.zx * ZONE_SIZE)
  const z = chain_to_client_coordinate(zone.zz * ZONE_SIZE)
  const area = canvas_bounds(view, {
    min_x: x,
    max_x: x + ZONE_SIZE - 1,
    min_z: z,
    max_z: z + ZONE_SIZE - 1,
  })
  context.save()
  context.fillStyle = 'rgba(72, 207, 207, 0.18)'
  context.fillRect(area.x, area.y, area.width, area.height)
  context.strokeStyle = '#48cfcf'
  context.lineWidth = 2
  context.shadowColor = 'rgba(72, 207, 207, 0.9)'
  context.shadowBlur = 10
  context.strokeRect(area.x + 1, area.y + 1, Math.max(1, area.width - 2), Math.max(1, area.height - 2))
  context.restore()
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
      context.fillStyle = '#ff6b6b'
      context.beginPath()
      context.arc(px, pz, 4.5, 0, Math.PI * 2)
      context.fill()
    } else {
      context.fillStyle = '#c8963c'
      context.beginPath()
      context.arc(px, pz, 3, 0, Math.PI * 2)
      context.fill()
    }
  }
}

/** Dungeon entrances: dark-green core with a bright breathing ring, shared by both map lenses. */
export const draw_dungeon_portal_markers = (
  context: CanvasRenderingContext2D,
  view: MapView,
  markers: readonly DungeonPortalMarker[],
  now = Date.now(),
  city_label?: (city: string) => string
): void => {
  const pulse = 4.5 + (Math.sin(now * 0.006) + 1) * 1.25
  for (const marker of markers) {
    const { px, pz } = to_canvas(marker.x, marker.z, view.center_x, view.center_z, view.size, view.radius)
    if (px < 0 || pz < 0 || px > view.size || pz > view.size) continue
    context.save()
    context.shadowColor = '#45ff88'
    context.shadowBlur = 10
    context.strokeStyle = '#58ff94'
    context.lineWidth = 1.5
    context.beginPath()
    context.arc(px, pz, pulse, 0, Math.PI * 2)
    context.stroke()
    context.shadowBlur = 0
    context.fillStyle = '#063d24'
    context.beginPath()
    context.arc(px, pz, 3.5, 0, Math.PI * 2)
    context.fill()
    if (city_label) {
      const name = marker.city.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
      context.fillStyle = '#d8f9e4'
      context.font = '9px "JetBrains Mono", monospace'
      context.textAlign = 'center'
      context.fillText(city_label(name), px, pz - 10)
    }
    context.restore()
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
