// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { useNumbers } from '../../i18n/useNumbers.ts'
// WORLD MAP — the full map the minimap opens onto. Discrete relief LOD keeps one bounded sample
// budget while zooming from the player's 3×3-zone lens to the complete procedural world. Search
// delimitation and labels disappear as their projected cells become unreadable; stable markers and
// the player remain. Each LOD samples progressively in row bands and completed grids are cached.
// Closes on the backdrop or Escape.

import { useEffect, useMemo, useRef, useState } from 'react'
import { MapView, MapInteraction } from '@aresrpg/ui'
import { chain_to_client_coordinate, client_to_chain_coordinate, world_size } from '@aresrpg/immutable'
import { ZONE_SIZE, zone_of } from '@aresrpg/protocol'
import { city_map_overlays, type CompiledWorld } from '@aresrpg/engine'

import './world_map.css'
import { copy_text, type AppCopy } from '../../i18n/copy.ts'
import { dungeon_portal_markers, spawn_markers, zone_key } from '../../modules/world.ts'
import { dispatch_app, useAppStore } from '../../store.ts'
import { useWorldPose } from '../core/pose_feed.ts'
import { useMapPlayers } from './useMapPlayers.ts'

import type { MapResourceIcons } from './map_resource_icons.ts'
import { camera_heading } from './compass_math.ts'
import {
  draw_dungeon_portal_markers,
  draw_city_layer,
  draw_players,
  draw_self_arrow,
  draw_spawn_markers,
  draw_zone_layer,
  draw_position_target,
} from './map_layers.ts'
import { useMapRelief, paint_map_relief } from './useMapRelief.ts'
import { step_world_map_lod, world_map_lod, world_map_zone_lod, world_map_position_target } from './world_map_lod.ts'

const MAP_SIZE = 768
const WHEEL_STEP_MS = 120
export const WORLD_MAP_WHEEL_OPTIONS: AddEventListenerOptions = Object.freeze({ passive: false })

const opened_zone_center = (x: number, z: number): Readonly<{ x: number; z: number }> => {
  const chain_x = Math.max(0, client_to_chain_coordinate(x))
  const chain_z = Math.max(0, client_to_chain_coordinate(z))
  const { zx, zz } = zone_of(chain_x, chain_z)
  return Object.freeze({
    x: chain_to_client_coordinate((zx + 0.5) * ZONE_SIZE),
    z: chain_to_client_coordinate((zz + 0.5) * ZONE_SIZE),
  })
}

const wheel_lod_direction = (event: Readonly<WheelEvent>, previous_at: number): -1 | 0 | 1 => {
  if (event.deltaY === 0 || event.timeStamp - previous_at < WHEEL_STEP_MS) return 0
  return event.deltaY > 0 ? 1 : -1
}

export const WorldMap = ({
  compiled,
  copy,
  on_close,
  resource_icons,
}: Readonly<{ compiled: CompiledWorld; copy: AppCopy; on_close: () => void; resource_icons: MapResourceIcons }>) => {
  const pose = useWorldPose()
  const players = useMapPlayers()
  const world_state = useAppStore(({ world }) => world)
  const world_name = useAppStore(
    ({ session }) => session.characters.find(({ id }) => id === session.selected_character_id)?.world ?? null
  )
  const run = useAppStore(({ run_to }) => run_to.run)
  const canvas_ref = useRef<HTMLCanvasElement | null>(null)
  const panel_ref = useRef<HTMLDivElement | null>(null)
  const wheel_at = useRef(-Infinity)
  const numbers = useNumbers()
  const text = copy_text(copy.world_hud)
  // The lens frames the zone the player stood in when it opened — a static snapshot.
  const opened_at = useRef(opened_zone_center(pose?.x ?? 0, pose?.z ?? 0))
  const [lod_level, set_lod_level] = useState(0)
  const [opened, set_opened] = useState(opened_at.current)
  const lod = world_map_lod(opened.x, opened.z, lod_level)
  const { center_x, center_z, radius } = lod
  const relief = useMapRelief(compiled, lod)
  const cities = useMemo(() => city_map_overlays(compiled), [compiled])
  const selected_position = useMemo(
    () =>
      run?.status === 'running' && ['position', 'map'].includes(run.source) && run.world === world_name
        ? { x: chain_to_client_coordinate(run.x), z: chain_to_client_coordinate(run.z) }
        : null,
    [run, world_name]
  )

  useEffect(() => {
    const on_key = (event: Readonly<KeyboardEvent>): void => {
      if (event.key === 'Escape') on_close()
    }
    globalThis.addEventListener('keydown', on_key)
    return () => globalThis.removeEventListener('keydown', on_key)
  }, [on_close])

  useEffect(() => {
    const panel = panel_ref.current
    if (!panel) return
    const on_wheel = (event: Readonly<WheelEvent>): void => {
      event.preventDefault()
      const direction = wheel_lod_direction(event, wheel_at.current)
      if (direction === 0) return
      // eslint-disable-next-line functional/immutable-data -- React owns this interaction-local throttle cell
      wheel_at.current = event.timeStamp
      set_lod_level((level) => step_world_map_lod(level, direction))
    }
    panel.addEventListener('wheel', on_wheel, WORLD_MAP_WHEEL_OPTIONS)
    return () => panel.removeEventListener('wheel', on_wheel)
  }, [])

  useEffect(() => {
    const canvas = canvas_ref.current
    if (!canvas || !pose) return
    const context = canvas.getContext('2d')
    if (!context) return
    const view = { center_x, center_z, size: MAP_SIZE, radius }
    const paint = (): void => {
      paint_map_relief(context, relief, view, MAP_SIZE)
      const zone_lod = world_map_zone_lod(radius, MAP_SIZE)
      if (zone_lod.layer)
        draw_zone_layer(
          context,
          view,
          (zx, zz) => (world_name ? zone_key(world_name, zx, zz) in world_state.zones : false),
          zone_lod.labels
        )
      draw_city_layer(context, view, cities)
      draw_position_target(context, view, selected_position)
      draw_spawn_markers(context, view, spawn_markers(world_state, world_name), icons.image)
      draw_dungeon_portal_markers(context, view, dungeon_portal_markers(world_name), Date.now(), (city) =>
        copy_text(copy.world_hud)('dungeon_city', { city })
      )
      draw_players(context, view, players)
      draw_self_arrow(context, view, pose.x, pose.z, camera_heading(pose.yaw))
    }
    const icons = resource_icons(pose, paint)
    paint()
    return icons.dispose
  }, [
    cities,
    copy,
    relief,
    center_x,
    center_z,
    radius,
    pose,
    players,
    selected_position,
    world_state,
    world_name,
    resource_icons,
  ])

  const change_lod = (direction: -1 | 1): void => set_lod_level((level) => step_world_map_lod(level, direction))
  const select_position = (x: number, y: number): void => {
    if (!world_name) return
    const target = world_map_position_target(lod, x * MAP_SIZE, y * MAP_SIZE, MAP_SIZE)
    dispatch_app({ type: 'run_to/position', world: world_name, x: target.x, z: target.z, source: 'map' })
  }

  return (
    <MapView
      header={{ title: text('world_map'), close: on_close, close_label: copy.wallet_close }}
      world={world_name ?? ''}
      coordinates={`${Math.round(center_x)}, ${Math.round(center_z)}`}
      zoom_in={() => change_lod(-1)}
      zoom_out={() => change_lod(1)}
      labels={{ zoom_in: text('world_map_zoom_in'), zoom_out: text('world_map_zoom_out') }}
      legend={
        <>
          <span>{text('world_map_extent', { blocks: numbers.number(Math.round(radius * 2)) })}</span>
          <span>{text('map_party_legend')}</span>
          {selected_position && (
            <span data-map-destination="">
              {copy.party_panel.run_to_position}: {selected_position.x}, {selected_position.z}
            </span>
          )}
        </>
      }
      map={
        <div ref={panel_ref} style={{ width: '100%', height: '100%' }}>
          <MapInteraction
            label={text('world_map')}
            pan={(x, y) => {
              if (radius === world_size / 2) return
              set_opened((current) => {
                const before = world_map_lod(current.x, current.z, lod_level)
                const next = world_map_lod(
                  before.center_x + x * radius * 2,
                  before.center_z + y * radius * 2,
                  lod_level
                )
                return { x: next.center_x, z: next.center_z }
              })
            }}
            select={select_position}
          >
            <canvas aria-label={text('world_map')} height={MAP_SIZE} width={MAP_SIZE} ref={canvas_ref} />
          </MapInteraction>
        </div>
      }
    />
  )
}
