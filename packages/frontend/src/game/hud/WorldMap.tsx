// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// WORLD MAP — the full map the minimap opens onto. Discrete relief LOD keeps one bounded sample
// budget while zooming from the player's 3×3-zone lens to the complete procedural world. Search
// delimitation and labels disappear as their projected cells become unreadable; stable markers and
// the player remain. Each LOD samples progressively in row bands and completed grids are cached.
// Closes on the backdrop or Escape.

import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { chain_to_client_coordinate, client_to_chain_coordinate } from '@aresrpg/immutable'
import { ZONE_SIZE, zone_of } from '@aresrpg/protocol'
import { city_map_overlays, type CompiledWorld } from '@aresrpg/engine'

import './world_map.css'
import { copy_text, type AppCopy } from '../../i18n/copy.ts'
import { dungeon_portal_markers, spawn_markers, zone_key } from '../../modules/world.ts'
import { dispatch_app, useAppStore } from '../../store.ts'
import { useWorldPose } from '../core/pose_feed.ts'

import { camera_heading } from './compass_math.ts'
import {
  draw_dungeon_portal_markers,
  draw_city_layer,
  draw_players,
  draw_self_arrow,
  draw_spawn_markers,
  draw_zone_layer,
  draw_zone_selection,
} from './map_layers.ts'
import { empty_relief_grid, fill_relief_rows, paint_relief, type ReliefGrid } from './minimap_render.ts'
import {
  step_world_map_lod,
  WORLD_MAP_LAST_LOD,
  world_map_lod,
  world_map_zone_lod,
  world_map_zone_target,
} from './world_map_lod.ts'

const MAP_SAMPLES = 192
const MAP_SIZE = 768
/** Sample rows per animation frame — big enough to finish in ~a dozen frames, small enough
 * to never hitch one. */
const ROWS_PER_FRAME = 16
const GRID_CACHE_LIMIT = 24
const WHEEL_STEP_MS = 120
export const WORLD_MAP_WHEEL_OPTIONS: AddEventListenerOptions = Object.freeze({ passive: false })

/** Finished grids by world + LOD view — the map re-opens instantly on familiar ground. */
const grid_cache = new Map<string, ReliefGrid>()

const retain_grid = (key: string, grid: ReliefGrid): void => {
  grid_cache.set(key, grid)
  if (grid_cache.size <= GRID_CACHE_LIMIT) return
  const oldest = grid_cache.keys().next().value
  if (oldest !== undefined) grid_cache.delete(oldest)
}

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
}: Readonly<{ compiled: CompiledWorld; copy: AppCopy; on_close: () => void }>) => {
  const pose = useWorldPose()
  const world_state = useAppStore(({ world }) => world)
  const world_name = useAppStore(
    ({ session }) => session.characters.find(({ id }) => id === session.selected_character_id)?.world ?? null
  )
  const run = useAppStore(({ run_to }) => run_to.run)
  const canvas_ref = useRef<HTMLCanvasElement | null>(null)
  const panel_ref = useRef<HTMLDivElement | null>(null)
  const wheel_at = useRef(-Infinity)
  const text = copy_text(copy.world_hud)
  // The lens frames the zone the player stood in when it opened — a static snapshot.
  const opened_at = useRef(opened_zone_center(pose?.x ?? 0, pose?.z ?? 0))
  const [lod_level, set_lod_level] = useState(0)
  const opened = opened_at.current
  const lod = world_map_lod(opened.x, opened.z, lod_level)
  const { center_x, center_z, radius } = lod
  const [grid, set_grid] = useState<ReliefGrid>(() => empty_relief_grid(center_x, center_z, radius, MAP_SAMPLES))
  const [sampled_rows, set_sampled_rows] = useState(0)
  const cities = useMemo(() => city_map_overlays(compiled), [compiled])
  const selected_zone = useMemo(
    () =>
      run?.status === 'running' && run.source === 'position' && run.world === world_name ? zone_of(run.x, run.z) : null,
    [run, world_name]
  )

  useEffect(() => {
    const cache_key = `${world_name ?? ''}:${center_x}:${center_z}:${radius}`
    const cached = grid_cache.get(cache_key)
    if (cached) {
      set_grid(cached)
      set_sampled_rows(MAP_SAMPLES)
      return
    }
    const fresh = empty_relief_grid(center_x, center_z, radius, MAP_SAMPLES)
    set_grid(fresh)
    set_sampled_rows(0)
    let row = 0
    let frame = 0
    const advance = (): void => {
      const next = Math.min(MAP_SAMPLES, row + ROWS_PER_FRAME)
      fill_relief_rows(compiled, fresh, row, next)
      row = next
      set_sampled_rows(next)
      if (next >= MAP_SAMPLES) {
        retain_grid(cache_key, fresh)
        return
      }
      frame = requestAnimationFrame(advance)
    }
    frame = requestAnimationFrame(advance)
    return () => cancelAnimationFrame(frame)
  }, [center_x, center_z, compiled, radius, world_name])

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
    const view = { center_x: grid.center_x, center_z: grid.center_z, size: MAP_SIZE, radius: grid.radius }
    paint_relief(context, grid, MAP_SIZE)
    if (sampled_rows < MAP_SAMPLES) return
    const zone_lod = world_map_zone_lod(grid.radius, MAP_SIZE)
    if (zone_lod.layer)
      draw_zone_layer(
        context,
        view,
        (zx, zz) => (world_name ? zone_key(world_name, zx, zz) in world_state.zones : false),
        zone_lod.labels
      )
    draw_city_layer(context, view, cities)
    draw_zone_selection(context, view, selected_zone)
    draw_spawn_markers(context, view, spawn_markers(world_state, world_name))
    draw_dungeon_portal_markers(context, view, dungeon_portal_markers(world_name), Date.now(), (city) =>
      copy_text(copy.world_hud)('dungeon_city', { city })
    )
    draw_players(context, view, Object.values(world_state.players))
    draw_self_arrow(context, view, pose.x, pose.z, camera_heading(pose.yaw))
  }, [cities, copy, grid, sampled_rows, pose, selected_zone, world_state, world_name])

  const change_lod = (direction: -1 | 1): void => set_lod_level((level) => step_world_map_lod(level, direction))
  const select_zone = (event: Readonly<MouseEvent<HTMLCanvasElement>>): void => {
    if (!world_name) return
    const bounds = event.currentTarget.getBoundingClientRect()
    const target = world_map_zone_target(
      lod,
      ((event.clientX - bounds.left) * MAP_SIZE) / bounds.width,
      ((event.clientY - bounds.top) * MAP_SIZE) / bounds.height,
      MAP_SIZE
    )
    dispatch_app({ type: 'run_to/position', world: world_name, x: target.x, z: target.z })
  }

  return (
    <div aria-label={text('world_map')} className="gw-worldmap" onClick={on_close} role="dialog">
      <div className="gw-worldmap__panel" onClick={(event) => event.stopPropagation()} ref={panel_ref}>
        <header className="gw-worldmap__header">
          <div className="gw-worldmap__title">{text('world_map')}</div>
          <div className="gw-worldmap__zoom">
            <button
              aria-label={text('world_map_zoom_out')}
              disabled={lod_level === WORLD_MAP_LAST_LOD}
              onClick={() => change_lod(1)}
              type="button"
            >
              −
            </button>
            <span>{text('world_map_extent', { blocks: Math.round(radius * 2).toLocaleString() })}</span>
            <button
              aria-label={text('world_map_zoom_in')}
              disabled={lod_level === 0}
              onClick={() => change_lod(-1)}
              type="button"
            >
              +
            </button>
          </div>
        </header>
        <div className="gw-worldmap__lens-wrap">
          <canvas
            aria-label={text('world_map')}
            className="gw-worldmap__lens"
            height={MAP_SIZE}
            onClick={select_zone}
            ref={canvas_ref}
            role="button"
            width={MAP_SIZE}
          />
          <div aria-hidden="true" className="gw-worldmap__scanlines" />
          <span aria-hidden="true" className="gw-worldmap__corner gw-worldmap__corner--tl" />
          <span aria-hidden="true" className="gw-worldmap__corner gw-worldmap__corner--tr" />
          <span aria-hidden="true" className="gw-worldmap__corner gw-worldmap__corner--bl" />
          <span aria-hidden="true" className="gw-worldmap__corner gw-worldmap__corner--br" />
        </div>
      </div>
    </div>
  )
}
