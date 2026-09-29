// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/* eslint-disable functional/immutable-data, functional/prefer-immutable-types, no-param-reassign -- lifecycle-owned raster sampling and canvas painting mutate only disposable buffers and drawing contexts. */
import { useEffect, useState } from 'react'
import type { CompiledWorld } from '@aresrpg/engine'
import { world_size } from '@aresrpg/immutable'

import {
  empty_relief_grid,
  fill_relief_rows,
  paint_relief,
  sample_relief_grid,
  type ReliefGrid,
} from './minimap_render.ts'
import { relief_image_rect, relief_sample_view, type ReliefView } from './map_relief_view.ts'

const SAMPLES = 192
const ROWS_PER_BATCH = 2
const FRAME_BUDGET_MS = 6
const CACHE_LIMIT = 24
type Raster = Readonly<{ view: ReliefView; image: HTMLCanvasElement }>
export type MapRelief = Raster & Readonly<{ overview: Raster }>
const caches = new WeakMap<CompiledWorld, Readonly<{ overview: Raster; views: Map<string, MapRelief> }>>()

const rasterize = (grid: ReliefGrid): Raster | null => {
  const image = document.createElement('canvas')
  image.width = grid.samples
  image.height = grid.samples
  const context = image.getContext('2d')
  if (!context) return null
  paint_relief(context, grid, grid.samples)
  return { view: grid, image }
}

/** Only completed rasters enter presentation. Sampling never blanks a moving map. */
export const useMapRelief = (compiled: CompiledWorld, view: ReliefView): MapRelief | null => {
  const { center_x, center_z, radius } = relief_sample_view(view)
  const [ready, set_ready] = useState<Readonly<{ compiled: CompiledWorld; relief: MapRelief }> | null>(null)
  useEffect(() => {
    const known = caches.get(compiled)
    const overview = known?.overview ?? rasterize(sample_relief_grid(compiled, 0, 0, world_size / 2, 32))
    if (!overview) return
    const cache = known ?? { overview, views: new Map<string, MapRelief>() }
    caches.set(compiled, cache)
    set_ready((current) => (current?.compiled === compiled ? current : { compiled, relief: { ...overview, overview } }))
    const key = `${center_x}:${center_z}:${radius}`
    const cached = cache.views.get(key)
    if (cached) {
      set_ready({ compiled, relief: cached })
      return
    }
    const grid = empty_relief_grid(center_x, center_z, radius, SAMPLES)
    let row = 0
    let frame = 0
    const advance = () => {
      const deadline = performance.now() + FRAME_BUDGET_MS
      do {
        const end = Math.min(SAMPLES, row + ROWS_PER_BATCH)
        fill_relief_rows(compiled, grid, row, end)
        row = end
      } while (row < SAMPLES && performance.now() < deadline)
      if (row < SAMPLES) {
        frame = requestAnimationFrame(advance)
        return
      }
      const raster = rasterize(grid)
      if (!raster) return
      const relief = { ...raster, overview }
      cache.views.set(key, relief)
      if (cache.views.size > CACHE_LIMIT) cache.views.delete(cache.views.keys().next().value!)
      set_ready({ compiled, relief })
    }
    frame = requestAnimationFrame(advance)
    return () => cancelAnimationFrame(frame)
  }, [compiled, center_x, center_z, radius])
  return ready?.compiled === compiled ? ready.relief : null
}

const paint_raster = (context: CanvasRenderingContext2D, raster: Raster, view: ReliefView, size: number): void => {
  const rect = relief_image_rect(view, raster.view, size)
  context.drawImage(raster.image, rect.x, rect.y, rect.size, rect.size)
}
export const paint_map_relief = (
  context: CanvasRenderingContext2D,
  relief: MapRelief | null,
  view: ReliefView,
  size: number
): void => {
  context.fillStyle = '#202a2d'
  context.fillRect(0, 0, size, size)
  if (!relief) return
  context.imageSmoothingEnabled = false
  paint_raster(context, relief.overview, view, size)
  paint_raster(context, relief, view, size)
}
