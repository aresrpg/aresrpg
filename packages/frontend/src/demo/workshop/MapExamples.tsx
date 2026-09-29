// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { useEffect, useMemo, useRef, useState } from 'react'
import { MapView, MinimapView, MapInteraction } from '@aresrpg/ui'
import { Map as MapIcon } from 'lucide-react'
import { city_map_overlays, compile_runtime_world_recipe, parse_world_recipe } from '@aresrpg/engine'
import { world_size } from '@aresrpg/immutable'
import { chain_to_client_coordinate } from '@aresrpg/immutable'

import { world_terrain } from '../../content/worlds.ts'
import { world_map_position_target } from '../../game/hud/world_map_lod.ts'
import { world_card_rows } from '../../content/world_cards.ts'
import { copy_text, type AppCopy } from '../../i18n/copy.ts'
import { useMapRelief, paint_map_relief } from '../../game/hud/useMapRelief.ts'
import { draw_city_layer, draw_self_arrow, draw_position_target } from '../../game/hud/map_layers.ts'

import { WorkshopSurface } from './shared.tsx'

/** The workshop uses the production relief painter and recipe sampler, without a 3D scene. */
const PreviewMap = ({
  world,
  radius,
  center = { x: 0, z: 0 },
  target,
}: Readonly<{
  world: string
  radius: number
  center?: Readonly<{ x: number; z: number }>
  target?: Readonly<{ x: number; z: number }> | null
}>) => {
  const canvas = useRef<HTMLCanvasElement>(null)
  const compiled = useMemo(() => compile_runtime_world_recipe(world_terrain(world)), [world])
  const relief = useMapRelief(compiled, { center_x: center.x, center_z: center.z, radius })
  useEffect(() => {
    const context = canvas.current?.getContext('2d')
    if (!context) return
    const view = { center_x: center.x, center_z: center.z, size: 512, radius }
    paint_map_relief(context, relief, view, 512)
    draw_city_layer(context, view, city_map_overlays(compiled))
    draw_self_arrow(context, view, 0, 0, 0)
    draw_position_target(context, view, target ?? null)
  }, [compiled, relief, radius, center.x, center.z, target])
  return <canvas ref={canvas} width={512} height={512} />
}

export const WorldMapExample = ({
  copy,
  on_close,
  initial_world = 'nauvis',
}: Readonly<{ copy: AppCopy; on_close?: () => void; initial_world?: string }>) => {
  const text = copy_text(copy.world_hud)
  const worlds = world_card_rows()
    .slice(0, 4)
    .map((world) => ({ id: world.id, name: world.label, image: world.art ?? undefined }))
  const [world] = useState(initial_world)
  const [radius, set_radius] = useState(512)
  const [center, set_center] = useState({ x: 0, z: 0 })
  const [target, set_target] = useState<Readonly<{ x: number; z: number }> | null>(null)
  return (
    <WorkshopSurface on_close={on_close} copy={copy} title={text('world_map')} icon={<MapIcon />}>
      {(header) => (
        <MapView
          header={header}
          map={
            <MapInteraction
              label={text('world_map')}
              pan={(x, y) =>
                set_center((current) => {
                  const limit = world_size / 2 - radius
                  return {
                    x: Math.max(-limit, Math.min(limit, current.x + x * radius * 2)),
                    z: Math.max(-limit, Math.min(limit, current.z + y * radius * 2)),
                  }
                })
              }
              select={(x, y) => {
                const point = world_map_position_target({ center_x: center.x, center_z: center.z, radius }, x, y, 1)
                set_target({ x: chain_to_client_coordinate(point.x), z: chain_to_client_coordinate(point.z) })
              }}
            >
              <PreviewMap world={world} radius={radius} center={center} target={target} />
            </MapInteraction>
          }
          world={worlds.find((row) => row.id === world)?.name ?? world}
          coordinates={`${Math.round(center.x)}, ${Math.round(center.z)}`}
          legend={
            <>
              <span>◆ {copy.party_panel.title}</span>
              <span>·</span>
              <span>{text('world_map_extent', { blocks: radius * 2 })}</span>
              {target && (
                <span data-map-destination="">
                  {copy.party_panel.run_to_position}: {target.x}, {target.z}
                </span>
              )}
            </>
          }
          zoom_in={() => set_radius(Math.max(64, radius / 2))}
          zoom_out={() => set_radius(Math.min(8192, radius * 2))}
          labels={{
            zoom_in: text('world_map_zoom_in'),
            zoom_out: text('world_map_zoom_out'),
          }}
        />
      )}
    </WorkshopSurface>
  )
}

export const MinimapExample = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const [open, set_open] = useState(false)
  return (
    <>
      <MinimapView
        title="Nauvis"
        coordinates="0, 0"
        map={<PreviewMap world="nauvis" radius={224} />}
        open_label={copy.world_hud.world_map}
        open={() => set_open(true)}
      />
      {open && <WorldMapExample copy={copy} on_close={() => set_open(false)} />}
    </>
  )
}
