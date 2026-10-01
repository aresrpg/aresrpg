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

const ROWS_PER_BATCH = 2
const FRAME_BUDGET_MS = 1
const CACHE_LIMIT = 24
type Raster = Readonly<{ view: ReliefView; image: HTMLCanvasElement }>
export type MapRelief = Raster & Readonly<{ overview: Raster }>
const caches = new WeakMap<CompiledWorld, Readonly<{ overview: Raster; views: Map<string, MapRelief> }>>()

const create_raster = (view: ReliefView, size: number) => {
  const image = document.createElement('canvas')
  image.width = size
  image.height = size
  const context = image.getContext('2d')
  if (!context) return null
  return { view, image, context }
}

const rasterize_relief = (grid: ReliefGrid): Raster | null => {
  const raster = create_raster(grid, grid.samples)
  if (!raster) return null
  paint_relief(raster.context, grid, grid.samples)
  return raster
}

/** Only completed rasters enter presentation. Sampling never blanks a moving map. */
export const useMapRelief = (
  compiled: CompiledWorld | null,
  view: ReliefView,
  { samples = 128, image_size = samples }: Readonly<{ samples?: number; image_size?: number }> = {}
): MapRelief | null => {
  const { center_x, center_z, radius } = relief_sample_view(view)
  // Resolution describes the visible view; overscan retains the same world-units-per-sample.
  const sample_count = Math.round((samples * radius) / view.radius)
  const raster_size = Math.round((image_size * radius) / view.radius)
  const [ready, set_ready] = useState<Readonly<{ compiled: CompiledWorld; relief: MapRelief }> | null>(null)
  useEffect(() => {
    if (!compiled) return
    const known = caches.get(compiled)
    const overview = known?.overview ?? rasterize_relief(sample_relief_grid(compiled, 0, 0, world_size / 2, 32))
    if (!overview) return
    const cache = known ?? { overview, views: new Map<string, MapRelief>() }
    caches.set(compiled, cache)
    set_ready((current) => (current?.compiled === compiled ? current : { compiled, relief: { ...overview, overview } }))
    const key = `${center_x}:${center_z}:${radius}:${sample_count}:${raster_size}`
    const cached = cache.views.get(key)
    if (cached) {
      set_ready({ compiled, relief: cached })
      return
    }
    const raster = create_raster({ center_x, center_z, radius }, raster_size)
    if (!raster) return
    const grid = empty_relief_grid(center_x, center_z, radius, sample_count)
    let row = 0
    let frame = 0
    const advance = () => {
      const deadline = performance.now() + FRAME_BUDGET_MS
      do {
        const end = Math.min(sample_count, row + ROWS_PER_BATCH)
        fill_relief_rows(compiled, grid, row, end)
        paint_relief(raster.context, grid, raster_size, row, end)
        row = end
      } while (row < sample_count && performance.now() < deadline)
      if (row < sample_count) {
        frame = requestAnimationFrame(advance)
        return
      }
      const relief = { view: raster.view, image: raster.image, overview }
      cache.views.set(key, relief)
      if (cache.views.size > CACHE_LIMIT) cache.views.delete(cache.views.keys().next().value!)
      set_ready({ compiled, relief })
    }
    frame = requestAnimationFrame(advance)
    return () => cancelAnimationFrame(frame)
  }, [compiled, center_x, center_z, radius, sample_count, raster_size])
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
