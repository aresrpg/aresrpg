// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { IconButton, MinimapView } from '@aresrpg/ui'
import { Map } from 'lucide-react'
// MINIMAP — the top-right 2D map. North-up (the real-map convention); only the centered player
// arrow rotates with the camera. Terrain is the analytic relief from minimap_render; the overlay
// marks (zone delimitation, spawns, players, arrow) are the shared map_layers painters. Labeled
// biome name and x/y/z chips read below the lens; clicking opens the full WorldMap over the canvas.
// Self-gates on the pose feed.

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  city_map_overlays,
  compile_runtime_world_recipe,
  parse_world_recipe,
  sample_world_column,
  type CompiledWorld,
} from '@aresrpg/engine'

import './minimap.css'
import { titleize } from '../../content/catalog.ts'
import { city_at_position, world_terrain } from '../../content/worlds.ts'
import { copy_text, type AppCopy } from '../../i18n/copy.ts'
import { dungeon_portal_markers, spawn_markers, zone_key } from '../../modules/world.ts'
import { dispatch_app, read_app_state, useAppStore } from '../../store.ts'
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
import { VIEW_RADIUS_BLOCKS, SAMPLE_N } from './minimap_render.ts'
import { useMapRelief, paint_map_relief } from './useMapRelief.ts'
import { create_map_resource_icons } from './map_resource_icons.ts'
import { WorldMap } from './WorldMap.tsx'

const SIZE = 288

export const toggles_world_map = (event: Readonly<Pick<KeyboardEvent, 'code' | 'repeat' | 'target'>>): boolean => {
  const target = event.target as Readonly<{ isContentEditable?: boolean; tagName?: string }> | null
  return (
    event.code === 'KeyM' &&
    !event.repeat &&
    !target?.isContentEditable &&
    !['INPUT', 'TEXTAREA'].includes(target?.tagName ?? '')
  )
}

export const Minimap = ({ copy, terrain: supplied_terrain }: Readonly<{ copy: AppCopy; terrain?: unknown }>) => {
  const pose = useWorldPose()
  const world_state = useAppStore(({ world }) => world)
  const world_name = useAppStore(
    ({ session }) => session.characters.find(({ id }) => id === session.selected_character_id)?.world ?? null
  )
  const canvas_ref = useRef<HTMLCanvasElement | null>(null)
  const [resource_icons] = useState(create_map_resource_icons)
  const map_open = useAppStore(({ navigation }) => navigation.dialog === 'world_map')
  const set_map_open = (open: boolean): void => dispatch_app({ type: 'dialog/open', dialog: open ? 'world_map' : null })
  const text = copy_text(copy.world_hud)

  useEffect(() => {
    const toggle = (event: Readonly<KeyboardEvent>): void => {
      if (!toggles_world_map(event)) return
      event.preventDefault()
      dispatch_app({
        type: 'dialog/open',
        dialog: read_app_state().navigation.dialog === 'world_map' ? null : 'world_map',
      })
    }
    globalThis.addEventListener('keydown', toggle)
    return () => globalThis.removeEventListener('keydown', toggle)
  }, [])

  const compiled: CompiledWorld | null = useMemo(() => {
    const terrain = supplied_terrain ?? world_terrain(world_name)
    if (!terrain) return null
    try {
      return compile_runtime_world_recipe(terrain)
    } catch (error) {
      console.error('The minimap could not compile the world recipe.', error)
      return null
    }
  }, [supplied_terrain, world_name])
  const cities = useMemo(() => (compiled ? city_map_overlays(compiled) : Object.freeze([])), [compiled])
  const position = pose ?? { x: 0, z: 0 }
  const view = { center_x: position.x, center_z: position.z, radius: VIEW_RADIUS_BLOCKS, size: SIZE }
  const relief = useMapRelief(pose && compiled, view, { samples: SAMPLE_N, image_size: SIZE })

  useEffect(() => {
    if (!pose || !compiled) return
    const context = canvas_ref.current!.getContext('2d')
    if (!context) return
    const view = { center_x: pose.x, center_z: pose.z, radius: VIEW_RADIUS_BLOCKS, size: SIZE }
    const paint = (): void => {
      context.save()
      paint_map_relief(context, relief, view, SIZE)
      context.restore()
      draw_zone_layer(context, view, (zx, zz) =>
        world_name ? zone_key(world_name, zx, zz) in world_state.zones : false
      )
      draw_city_layer(context, view, cities)
      draw_spawn_markers(context, view, spawn_markers(world_state, world_name), icons.image)
      draw_dungeon_portal_markers(context, view, dungeon_portal_markers(world_name))
      draw_players(context, view, Object.values(world_state.players))
      draw_self_arrow(context, view, pose.x, pose.z, camera_heading(pose.yaw))
    }
    const icons = resource_icons(pose, paint)
    paint()
    return icons.dispose
  }, [cities, pose, compiled, relief, world_state, world_name, resource_icons])

  if (!pose || !compiled) return null

  const coords = { x: Math.round(pose.x), y: Math.round(pose.y), z: Math.round(pose.z) }
  const city = city_at_position(world_name, coords.x, coords.z)
  const biome_name = titleize(sample_world_column(compiled, coords.x, coords.z).biome.name)
  const location_name = city ? text('dungeon_city', { city: titleize(city.id) }) : biome_name

  return (
    <div className="gw-minimap" data-minimap="">
      <IconButton
        className="world-map-trigger world-utility-button"
        label={text('world_map')}
        onClick={() => set_map_open(true)}
        icon={<Map size={22} />}
      />
      <MinimapView
        title={location_name}
        coordinates={`${coords.x}, ${coords.z}`}
        open_label={text('world_map')}
        open={() => set_map_open(true)}
        map={<canvas height={SIZE} ref={canvas_ref} width={SIZE} />}
      />
      {map_open && (
        <WorldMap
          compiled={compiled}
          copy={copy}
          resource_icons={resource_icons}
          on_close={() => set_map_open(false)}
        />
      )}
    </div>
  )
}
