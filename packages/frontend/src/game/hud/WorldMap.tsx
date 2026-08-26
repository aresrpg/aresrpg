// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// WORLD MAP — the full map the minimap opens onto: a large centered lens over the canvas framing
// EXACTLY the 3×3 zones around the player's current zone, with the search delimitation (veil +
// gold boundaries + signed zone ids), spawn markers, live players, and the player arrow. The
// relief samples PROGRESSIVELY (row bands per frame — a zone-scale grid would freeze the main
// thread sampled in one go) and finished grids are cached per zone, so re-opening is instant.
// Closes on click anywhere or Escape.

import { useEffect, useRef, useState } from 'react'
import { chain_to_client_coordinate, client_to_chain_coordinate } from '@aresrpg/immutable'
import { ZONE_SIZE, zone_of } from '@aresrpg/protocol'
import type { CompiledWorld } from '@aresrpg/engine'

import './world_map.css'
import { copy_text, type AppCopy } from '../../i18n/copy.ts'
import { dungeon_portal_markers, spawn_markers, zone_key } from '../../modules/world.ts'
import { useAppStore } from '../../store.ts'
import { useWorldPose } from '../core/pose_feed.ts'

import { camera_heading } from './compass_math.ts'
import {
  draw_dungeon_portal_markers,
  draw_players,
  draw_self_arrow,
  draw_spawn_markers,
  draw_zone_layer,
} from './map_layers.ts'
import { empty_relief_grid, fill_relief_rows, paint_relief, type ReliefGrid } from './minimap_render.ts'

/** 3×3 zones exactly: the lens spans 1.5 zones from the CURRENT zone's center to each edge. */
const MAP_RADIUS = ZONE_SIZE * 1.5
const MAP_SAMPLES = 192
const MAP_SIZE = 768
/** Sample rows per animation frame — big enough to finish in ~a dozen frames, small enough
 * to never hitch one. */
const ROWS_PER_FRAME = 16

/** Finished grids by world + zone — the map re-opens instantly on familiar ground. */
const grid_cache = new Map<string, ReliefGrid>()

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
  const canvas_ref = useRef<HTMLCanvasElement | null>(null)
  const text = copy_text(copy.world_hud)
  // The lens frames the zone the player stood in when it opened — a static snapshot.
  const opened_at = useRef(pose ? { x: pose.x, z: pose.z } : null)
  const [grid, set_grid] = useState<ReliefGrid | null>(null)
  const [sampled_rows, set_sampled_rows] = useState(0)

  useEffect(() => {
    const center = opened_at.current
    if (!center) return
    const chain_x = Math.max(0, client_to_chain_coordinate(center.x))
    const chain_z = Math.max(0, client_to_chain_coordinate(center.z))
    const { zx, zz } = zone_of(chain_x, chain_z)
    const center_x = chain_to_client_coordinate((zx + 0.5) * ZONE_SIZE)
    const center_z = chain_to_client_coordinate((zz + 0.5) * ZONE_SIZE)
    const cache_key = `${world_name ?? ''}:${zx}:${zz}`
    const cached = grid_cache.get(cache_key)
    if (cached) {
      set_grid(cached)
      set_sampled_rows(MAP_SAMPLES)
      return
    }
    const fresh = empty_relief_grid(center_x, center_z, MAP_RADIUS, MAP_SAMPLES)
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
        grid_cache.set(cache_key, fresh)
        return
      }
      frame = requestAnimationFrame(advance)
    }
    frame = requestAnimationFrame(advance)
    return () => cancelAnimationFrame(frame)
  }, [compiled, world_name])

  useEffect(() => {
    const on_key = (event: Readonly<KeyboardEvent>): void => {
      if (event.key === 'Escape') on_close()
    }
    globalThis.addEventListener('keydown', on_key)
    return () => globalThis.removeEventListener('keydown', on_key)
  }, [on_close])

  useEffect(() => {
    const canvas = canvas_ref.current
    if (!canvas || !grid || !pose) return
    const context = canvas.getContext('2d')
    if (!context) return
    const view = { center_x: grid.center_x, center_z: grid.center_z, size: MAP_SIZE, radius: MAP_RADIUS }
    paint_relief(context, grid, MAP_SIZE)
    if (sampled_rows < MAP_SAMPLES) return
    draw_zone_layer(
      context,
      view,
      (zx, zz) => (world_name ? zone_key(world_name, zx, zz) in world_state.zones : false),
      true
    )
    draw_spawn_markers(context, view, spawn_markers(world_state, world_name))
    draw_dungeon_portal_markers(context, view, dungeon_portal_markers(world_state, world_name))
    draw_players(context, view, Object.values(world_state.players))
    draw_self_arrow(context, view, pose.x, pose.z, camera_heading(pose.yaw))
  }, [grid, sampled_rows, pose, world_state, world_name])

  if (!grid) return null

  return (
    <div aria-label={text('world_map')} className="gw-worldmap" onClick={on_close} role="dialog">
      <div className="gw-worldmap__panel" onClick={(event) => event.stopPropagation()}>
        <div className="gw-worldmap__title">{text('world_map')}</div>
        <div className="gw-worldmap__lens-wrap">
          <canvas className="gw-worldmap__lens" height={MAP_SIZE} ref={canvas_ref} width={MAP_SIZE} />
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
