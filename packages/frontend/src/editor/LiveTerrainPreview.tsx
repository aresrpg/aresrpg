// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The edited recipe rendered by the real engine: the same create_world the game runs, rebuilt
// (debounced) from the editor's current worlds.json value — spline edits reshape live voxels.

import { useEffect, useMemo, useState } from 'react'
import type { EngineStatus } from '@aresrpg/engine'

import { create_world } from '../game/core/world.ts'
import { useAppStore } from '../store.ts'

import type { JsonValue } from './seed_editor.ts'

const REBUILD_DEBOUNCE_MS = 600

export const LiveTerrainPreview = ({ terrain }: Readonly<{ terrain: JsonValue }>) => {
  const settings = useAppStore((state) => state.settings)
  const [canvas, set_canvas] = useState<HTMLCanvasElement | null>(null)
  const [status, set_status] = useState<EngineStatus>({ state: 'initializing', backend: 'none' })
  const [world_api, set_world_api] = useState<ReturnType<typeof create_world> | null>(null)
  // Identity by content: a knot drag produces a new JSON value every step — rebuild on settle.
  const terrain_json = useMemo(() => JSON.stringify(terrain), [terrain])

  useEffect(() => {
    if (!canvas) return undefined
    let created: ReturnType<typeof create_world> | null = null
    let unsubscribe: (() => void) | null = null
    const timer = setTimeout(() => {
      try {
        created = create_world({ canvas, world: JSON.parse(terrain_json), quality: settings.quality })
        unsubscribe = created.subscribe_status(set_status)
        created.set_active(true)
        created.set_interactive(true)
        set_world_api(created)
      } catch (error) {
        console.error('The live terrain preview could not build this recipe.', error)
      }
    }, REBUILD_DEBOUNCE_MS)
    return () => {
      clearTimeout(timer)
      unsubscribe?.()
      created?.dispose()
      set_world_api((current) => (current === created ? null : current))
    }
    // Quality updates ride the running world below; only content identity rebuilds it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvas, terrain_json])

  useEffect(() => {
    world_api?.set_quality(settings.quality, settings.render_distance)
  }, [settings.quality, settings.render_distance, world_api])

  return (
    <div className="relative size-full">
      <canvas className="absolute inset-0 size-full touch-none" ref={set_canvas} />
      <span className="pointer-events-none absolute bottom-3 left-3 text-[7px] tracking-[0.14em] text-[#6b7280] uppercase">
        {status.backend} · {status.state} · drag to pan · right-drag to orbit · wheel to zoom
      </span>
    </div>
  )
}
