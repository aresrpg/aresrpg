// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// COMPASS STRIP — the pre-rewrite top-strip compass, carried over intact minus the coordinate
// chips (owner 2026-08-19: coordinates live on the minimap now). Cardinal ruler + fixed center
// forward caret, spawn pips (mob red / resource cyan) by bearing relative to the camera heading
// with the density pipeline (cap → cluster → label-thin), zone-boundary markers tinted by the
// neighbor's discovered state, the zone-state line, and the day-night progress line (the fps
// readout left for the top-left stats — owner 2026-08-19: one home per number).
// Self-gates on the pose feed (null in spectate / before the walker's first frame → nothing).

import { DAY_FRAC } from '@aresrpg/engine'
import { client_to_chain_coordinate, world_center } from '@aresrpg/immutable'
import { ZONE_RESEARCH_TTL_MS, ZONE_SIZE, zone_of } from '@aresrpg/protocol'
import { Building2 } from 'lucide-react'
import type { CSSProperties } from 'react'

import './compass_strip.css'
import { city_at_position, world_city_areas } from '../../content/worlds.ts'
import { titleize } from '../../content/catalog.ts'
import { copy_text, type AppCopy } from '../../i18n/copy.ts'
import { spawn_markers, zone_key } from '../../modules/world.ts'
import { useAppStore } from '../../store.ts'
import { useWorldPose } from '../core/pose_feed.ts'

import {
  CARDINALS,
  bearing_of,
  camera_heading,
  cap_nearest_pips,
  cluster_pips,
  compass_target,
  nearest_zone_edges,
  neighbor_zone_key,
  pip_tier,
  relative_bearing,
  strip_x,
  thin_pip_labels,
} from './compass_math.ts'

const ORIGIN_ZONE = zone_of(world_center, world_center)
export type CityCompassMarker = Readonly<{
  id: string
  label: string
  distance: number
  x: number
  dungeon: boolean
  show_label: boolean
}>

export const city_compass_markers = (
  world_name: string | null,
  pose: Readonly<{ x: number; z: number }>,
  heading: number
): readonly CityCompassMarker[] => {
  const current = city_at_position(world_name, pose.x, pose.z)?.id ?? null
  return Object.freeze(
    world_city_areas(world_name).map((city) => {
      const target = compass_target(pose, { x: city.anchor_x, z: city.anchor_z }, heading)
      return Object.freeze({
        id: city.id,
        label: titleize(city.id),
        distance: target.distance,
        x: target.x,
        dungeon: city.id === current,
        show_label: city.id !== current,
      })
    })
  )
}

const CityCompassMarkerView = ({ marker, city_label }: Readonly<{ marker: CityCompassMarker; city_label: string }>) => {
  const distance = Math.round(marker.distance)
  return (
    <span
      aria-label={`${city_label} · ${distance}m`}
      className="gw-compass__city"
      style={{ left: `${marker.x * 100}%` }}
      title={city_label}
    >
      <span aria-hidden="true" className="gw-compass__city-icons">
        <Building2 size={13} strokeWidth={1.8} />
        {marker.dungeon && <span className="gw-compass__city-dungeon">☠</span>}
      </span>
      {marker.show_label && (
        <span className="gw-compass__city-label">
          {marker.label} · {distance}m
        </span>
      )}
    </span>
  )
}

export const CompassStrip = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const pose = useWorldPose()
  const zones = useAppStore(({ world }) => world.zones)
  const world_state = useAppStore(({ world }) => world)
  const world_name = useAppStore(
    ({ session }) => session.characters.find(({ id }) => id === session.selected_character_id)?.world ?? null
  )
  const text = copy_text(copy.world_hud)
  if (!pose) return null

  const chain = { x: client_to_chain_coordinate(pose.x), z: client_to_chain_coordinate(pose.z) }
  const cell = chain.x >= 0 && chain.z >= 0 ? zone_of(chain.x, chain.z) : null
  const zone_row = cell && world_name ? (zones[zone_key(world_name, cell.zx, cell.zz)] ?? null) : null
  const discovered = zone_row !== null
  const searchable = Boolean(
    cell && world_name && (!zone_row || Date.now() >= zone_row.searched_at_ms + ZONE_RESEARCH_TTL_MS)
  )

  const heading = camera_heading(pose.yaw)
  const city_markers = city_compass_markers(world_name, pose, heading)
  const marks = CARDINALS.map((cardinal) => ({
    ...cardinal,
    x: strip_x(relative_bearing(cardinal.bearing, heading)),
  })).filter((mark) => mark.x !== null)

  // Pip pipeline: raw bearing/dist → cap → cluster → label-thin (pure, compass_math) BEFORE any
  // strip projection, so a merged/dropped pip never even reaches strip_x.
  const cell_spawns = cell
    ? spawn_markers(world_state, world_name).filter(({ zx, zz }) => zx === cell.zx && zz === cell.zz)
    : []
  const pip_candidates = cell_spawns.map((spawn) => {
    const dx = spawn.x - pose.x
    const dz = spawn.z - pose.z
    return {
      id: `${spawn.kind}:${spawn.spawn_id}`,
      kind: spawn.kind,
      bearing: bearing_of(dx, dz),
      dist: Math.round(Math.hypot(dx, dz)),
      title: spawn.kind === 'mob' ? text('mob_group', { size: spawn.size ?? 0 }) : text('resource'),
    }
  })
  const pips = thin_pip_labels(cluster_pips(cap_nearest_pips(pip_candidates)))
    .map((pip) => {
      const x = strip_x(relative_bearing(pip.bearing, heading))
      return x === null ? null : { ...pip, x, tier: pip_tier(pip.dist) }
    })
    .filter((pip) => pip !== null)

  // Edge markers — the nearest 1-2 boundaries of the CURRENT zone cell, tinted by the neighbor
  // zone's discovered flag (a free lookup against the same zones the strip already reads).
  const edge_markers = cell
    ? nearest_zone_edges(pose.x, pose.z, cell.zx, cell.zz, ZONE_SIZE, world_center)
        .map((edge) => {
          const x = strip_x(relative_bearing(edge.bearing, heading))
          if (x === null) return null
          const neighbor = neighbor_zone_key(cell.zx, cell.zz, edge.edge)
          const neighbor_discovered = world_name ? zone_key(world_name, neighbor.zx, neighbor.zz) in zones : false
          return { id: `edge:${edge.edge}`, x, dist: Math.round(edge.dist), discovered: neighbor_discovered }
        })
        .filter((edge) => edge !== null)
    : []

  const zone_state = !world_name || !cell ? '—' : discovered ? text('searched') : text('unsearched')
  const night = pose.time_of_day >= DAY_FRAC

  return (
    <div className="gw-compass-wrap" data-tutorial-target="compass">
      <div
        aria-label={text('compass_label')}
        className={`gw-compass${searchable ? ' gw-compass--searchable' : ''}`}
        data-compass-strip=""
      >
        <div aria-hidden="true" className="gw-compass__band">
          <div className="gw-compass__ruler" />
          {marks.map((mark) => (
            <span
              className={`gw-compass__card${mark.major ? ' gw-compass__card--major' : ''}`}
              key={mark.label}
              style={{ left: `${mark.x! * 100}%` }}
            >
              {mark.label}
            </span>
          ))}
          <div className="gw-compass__fwd">
            <span className="gw-compass__caret" />
            <span className="gw-compass__stem" />
          </div>
          {pips.map((pip) => (
            <span
              className={`gw-compass__pip gw-compass__pip--${pip.kind} gw-compass__pip--${pip.tier}`}
              key={pip.id}
              style={{ left: `${pip.x * 100}%` }}
              title={pip.count > 1 ? `${pip.title} · ${text('cluster_count', { extra: pip.count - 1 })}` : pip.title}
            >
              <span className="gw-compass__pip-dot-row">
                <span className="gw-compass__pip-dot" />
                {pip.count > 1 && <span className="gw-compass__pip-count">×{pip.count}</span>}
              </span>
              {pip.show_label && <span className="gw-compass__pip-dist">{pip.dist}m</span>}
            </span>
          ))}
          {city_markers.map((marker) => (
            <CityCompassMarkerView
              city_label={text('dungeon_city', { city: marker.label })}
              key={marker.id}
              marker={marker}
            />
          ))}
          {edge_markers.map((marker) => (
            <span
              className={`gw-compass__edge gw-compass__edge--${marker.discovered ? 'discovered' : 'undiscovered'}`}
              key={marker.id}
              style={{ left: `${marker.x * 100}%` }}
              title={text('zone_edge', { dist: `${marker.dist}m` })}
            >
              <span className="gw-compass__edge-tick" />
              <span className="gw-compass__edge-label">{text('zone_edge', { dist: `${marker.dist}m` })}</span>
            </span>
          ))}
        </div>
        <div className="gw-compass__info">
          <span className="gw-compass__zone">
            {/* the zone under the avatar, SIGNED display re-centred on the world origin (world
                (0,0) → ZONE 0·0); past the world's low edge → the honest OUT-OF-BOUNDS label */}
            {cell
              ? `${text('zone')} ${cell.zx - ORIGIN_ZONE.zx}·${cell.zz - ORIGIN_ZONE.zz}${zone_state ? ` · ${zone_state}` : ''}`
              : text('out_of_bounds')}
          </span>
        </div>
        <div
          className={`gw-compass__tod${night ? ' gw-compass__tod--night' : ''}`}
          style={{ '--gw-tod-split': `${DAY_FRAC * 100}%` } as CSSProperties}
        >
          <span className="gw-compass__tod-mark" style={{ left: `${pose.time_of_day * 100}%` }} />
        </div>
      </div>
    </div>
  )
}
