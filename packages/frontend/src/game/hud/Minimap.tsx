// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// MINIMAP — the top-right 2D map. North-up (the real-map convention); only the centered player
// arrow rotates with the camera. Terrain is the analytic relief from minimap_render; the overlay
// marks (zone delimitation, spawns, players, arrow) are the shared map_layers painters. Labeled
// biome name and x/y/z chips read below the lens; clicking opens the full WorldMap over the canvas.
// Self-gates on the pose feed.

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  city_map_overlays,
  compile_world_recipe,
  parse_world_recipe,
  sample_world_column,
  type CompiledWorld,
} from '@aresrpg/engine'

import './minimap.css'
import { titleize } from '../../content/catalog.ts'
import { city_at_position, world_terrain } from '../../content/worlds.ts'
import { copy_text, type AppCopy } from '../../i18n/copy.ts'
import { dungeon_portal_markers, spawn_markers, zone_key } from '../../modules/world.ts'
import { useAppStore } from '../../store.ts'
import { useWorldPose } from '../core/pose_feed.ts'

import { camera_heading } from './compass_math.ts'
import {
  draw_dungeon_portal_markers,
  draw_city_layer,
  draw_players,
  draw_self_arrow,
  draw_spawn_markers,
  draw_zone_layer,
} from './map_layers.ts'
import {
  VIEW_RADIUS_BLOCKS,
  paint_relief,
  resample_key,
  sample_relief_grid,
  type ReliefGrid,
} from './minimap_render.ts'
import { WorldMap } from './WorldMap.tsx'

const SIZE = 288

const AXES = ['x', 'y', 'z'] as const
type Coordinates = Readonly<Record<(typeof AXES)[number], number>>

export const MinimapReadout = ({
  location_name,
  location_label,
  city,
  coordinates,
  coordinates_label,
}: Readonly<{
  location_name: string
  location_label: string
  city: boolean
  coordinates: Coordinates
  coordinates_label: string
}>) => (
  <div className="gw-minimap__readout">
    <span aria-label={location_label} className={`gw-minimap__biome${city ? ' gw-minimap__biome--city' : ''}`}>
      {location_name}
    </span>
    <div aria-label={coordinates_label} className="gw-minimap__coords">
      {AXES.map((axis) => (
        <span className="gw-minimap__coord" key={axis}>
          <span className="gw-minimap__axis">{axis}</span>
          {coordinates[axis]}
        </span>
      ))}
    </div>
  </div>
)

export const Minimap = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const pose = useWorldPose()
  const world_state = useAppStore(({ world }) => world)
  const world_name = useAppStore(
    ({ session }) => session.characters.find(({ id }) => id === session.selected_character_id)?.world ?? null
  )
  const canvas_ref = useRef<HTMLCanvasElement | null>(null)
  const grid_ref = useRef<Readonly<{ key: string; grid: ReliefGrid }> | null>(null)
  const [map_open, set_map_open] = useState(false)
  const text = copy_text(copy.world_hud)

  const compiled: CompiledWorld | null = useMemo(() => {
    const terrain = world_terrain(world_name)
    if (!terrain) return null
    try {
      return compile_world_recipe(parse_world_recipe(terrain))
    } catch (error) {
      console.error('The minimap could not compile the world recipe.', error)
      return null
    }
  }, [world_name])
  const cities = useMemo(() => (compiled ? city_map_overlays(compiled) : Object.freeze([])), [compiled])

  useEffect(() => {
    const canvas = canvas_ref.current
    if (!canvas || !pose || !compiled) return
    const context = canvas.getContext('2d')
    if (!context) return
    const key = resample_key(pose.x, pose.z)
    // eslint-disable-next-line functional/immutable-data -- React owns this component-local cache cell
    if (grid_ref.current?.key !== key) grid_ref.current = { key, grid: sample_relief_grid(compiled, pose.x, pose.z) }
    const { grid } = grid_ref.current
    const view = { center_x: grid.center_x, center_z: grid.center_z, size: SIZE, radius: VIEW_RADIUS_BLOCKS }
    paint_relief(context, grid, SIZE)
    draw_zone_layer(context, view, (zx, zz) => (world_name ? zone_key(world_name, zx, zz) in world_state.zones : false))
    draw_city_layer(context, view, cities)
    draw_spawn_markers(context, view, spawn_markers(world_state, world_name))
    draw_dungeon_portal_markers(context, view, dungeon_portal_markers(world_name))
    draw_players(context, view, Object.values(world_state.players))
    draw_self_arrow(context, view, pose.x, pose.z, camera_heading(pose.yaw))
  }, [cities, pose, compiled, world_state, world_name])

  if (!pose || !compiled) return null

  const coords = { x: Math.round(pose.x), y: Math.round(pose.y), z: Math.round(pose.z) }
  const city = city_at_position(world_name, coords.x, coords.z)
  const biome_name = titleize(sample_world_column(compiled, coords.x, coords.z).biome.name)
  const location_name = city ? text('dungeon_city', { city: titleize(city.id) }) : biome_name

  return (
    <div className="gw-minimap" data-minimap="">
      <div className="gw-minimap__frame">
        <button
          aria-label={text('world_map')}
          className="gw-minimap__open"
          onClick={() => set_map_open(true)}
          type="button"
        >
          <canvas className="gw-minimap__lens" height={SIZE} ref={canvas_ref} width={SIZE} />
          <span aria-hidden="true" className="gw-minimap__scanlines" />
        </button>
        <span aria-hidden="true" className="gw-minimap__corner gw-minimap__corner--tl" />
        <span aria-hidden="true" className="gw-minimap__corner gw-minimap__corner--tr" />
        <span aria-hidden="true" className="gw-minimap__corner gw-minimap__corner--bl" />
        <span aria-hidden="true" className="gw-minimap__corner gw-minimap__corner--br" />
        <span aria-hidden="true" className="gw-minimap__north">
          N
        </span>
      </div>
      <MinimapReadout
        city={city !== null}
        coordinates={coords}
        coordinates_label={text('coordinates')}
        location_label={city ? location_name : text('biome')}
        location_name={location_name}
      />
      {map_open && <WorldMap compiled={compiled} copy={copy} on_close={() => set_map_open(false)} />}
    </div>
  )
}
