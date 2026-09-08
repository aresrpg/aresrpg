// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { effective_render_distance } from './settings.ts'
import {
  CHUNK_EDGE,
  get_quality_profile,
  type ChunkCoordinate,
  type ChunkLod,
  type ChunkRenderOutcome,
  type Engine,
  type EngineQuality,
  type TerrainColumnCoordinate,
  type TerrainColumnPlan,
} from '@aresrpg/engine'

export type ChunkRequest = Readonly<{ coordinate: ChunkCoordinate; lod: ChunkLod; distance: number }>

const CHUNK_SIZE = CHUNK_EDGE

export const chunk_key = ({ x, y, z }: ChunkCoordinate): string => `${x}:${y}:${z}`

export const chunk_at = (value: number, chunk_size = CHUNK_SIZE): number => Math.floor(value / chunk_size)

const request_lod = (distance: number, radii: Readonly<{ near_radius: number; mid_radius: number }>): ChunkLod =>
  distance <= radii.near_radius ? 'near' : distance <= radii.mid_radius ? 'mid' : 'far'

export const desired_chunks = (
  focus: ChunkCoordinate,
  quality: EngineQuality,
  layers_for: (column: TerrainColumnCoordinate) => readonly number[] = () => [0],
  far_override: number | null = null
): readonly ChunkRequest[] => {
  const tier = get_quality_profile(quality).chunks
  const radii = { ...tier, far_radius: effective_render_distance(tier.far_radius, far_override) }
  const width = radii.far_radius * 2 + 1
  return Array.from({ length: width * width }, (_, index) => ({
    x: focus.x + (index % width) - radii.far_radius,
    z: focus.z + Math.floor(index / width) - radii.far_radius,
  }))
    .flatMap((column) =>
      layers_for(column)
        .toSorted((left, right) => right - left)
        .map((y) => {
          const coordinate = { ...column, y }
          const distance = Math.max(Math.abs(coordinate.x - focus.x), Math.abs(coordinate.z - focus.z))
          return { coordinate, lod: request_lod(distance, radii), distance }
        })
    )
    .toSorted((left, right) => left.distance - right.distance)
}

const desired_columns = (
  focus: ChunkCoordinate,
  quality: EngineQuality,
  far_override: number | null = null
): readonly TerrainColumnCoordinate[] => {
  const radius = effective_render_distance(get_quality_profile(quality).chunks.far_radius, far_override)
  const width = radius * 2 + 1
  return Array.from({ length: width * width }, (_, index) => {
    return {
      x: focus.x + (index % width) - radius,
      z: focus.z + Math.floor(index / width) - radius,
    }
  }).toSorted(
    (left, right) =>
      Math.max(Math.abs(left.x - focus.x), Math.abs(left.z - focus.z)) -
      Math.max(Math.abs(right.x - focus.x), Math.abs(right.z - focus.z))
  )
}

export const create_chunk_manager = ({
  engine,
  initial_quality = 'medium',
  initial_render_distance = null,
  plan_layers,
  now = () => performance.now(),
  on_failure = (error) => console.error('[game] terrain streaming failed.', error),
}: Readonly<{
  engine: Engine
  initial_quality?: EngineQuality
  initial_render_distance?: number | null
  plan_layers?: (columns: readonly TerrainColumnCoordinate[]) => Promise<readonly TerrainColumnPlan[]>
  now?: () => number
  on_failure?: (error: Readonly<Error>) => void
}>) => {
  // Residency remembers the LOD each chunk was rendered at — approaching a mid chunk must
  // re-render it as near (detail layers like ground scatter exist only at near).
  const resident = new Map<string, ChunkLod>()
  const in_flight = new Map<string, ChunkRequest>()
  const wanted = new Map<string, ChunkRequest>()
  const retry_at = new Map<string, number>()
  const failures = new Map<string, number>()
  const layer_cache = new Map<string, readonly number[]>()
  let completed: readonly Readonly<{ request: ChunkRequest; outcome: ChunkRenderOutcome }>[] = []
  let queued: readonly ChunkRequest[] = []
  let evicting: readonly string[] = []
  let focus: ChunkCoordinate | null = null
  let quality = initial_quality
  // Effective residency starts at the requested distance and contracts under GPU pressure.
  // An explicit quality/distance change starts a new request; focus movement retains the bound.
  let render_distance = initial_render_distance
  let plan_revision = 0
  let disposed = false

  const report_work_failure = (key: string, error: Readonly<Error>): boolean => {
    const count = (failures.get(key) ?? 0) + 1
    failures.set(key, count)
    if (count >= 3) {
      dispose()
      on_failure(error)
      return false
    }
    retry_at.set(key, now() + 250 * 2 ** (count - 1))
    return true
  }

  const apply_schedule = (): void => {
    if (!focus) return
    const desired = desired_chunks(
      focus,
      quality,
      ({ x, z }) => layer_cache.get(`${x}:${z}`) ?? (plan_layers ? [] : [0]),
      render_distance
    )
    wanted.clear()
    desired.forEach((request) => wanted.set(chunk_key(request.coordinate), request))
    const wanted_keys = new Set(wanted.keys())
    for (const metadata of [retry_at, failures])
      metadata.forEach((_, key) => {
        if (key !== 'terrain-plan' && !wanted_keys.has(key)) metadata.delete(key)
      })
    queued = desired.filter((request) => {
      const key = chunk_key(request.coordinate)
      return resident.get(key) !== request.lod && !in_flight.has(key)
    })
    evicting = [...resident.keys()].filter((key) => !wanted_keys.has(key))
    in_flight.forEach((_, key) => {
      if (wanted_keys.has(key)) return
      engine.remove_chunk(key)
      in_flight.delete(key)
    })
  }

  const plan_missing = async (
    revision: number,
    center: ChunkCoordinate,
    columns: readonly TerrainColumnCoordinate[]
  ): Promise<void> => {
    const radius = effective_render_distance(get_quality_profile(quality).chunks.far_radius, render_distance)
    for (let distance = 0; distance <= radius; distance += 1) {
      const ring = columns.filter(({ x, z }) => Math.max(Math.abs(x - center.x), Math.abs(z - center.z)) === distance)
      if (ring.length === 0) continue
      try {
        const plans = await plan_layers!(ring)
        if (revision !== plan_revision) return
        plans.forEach(({ x, z, layers }) => layer_cache.set(`${x}:${z}`, layers))
        failures.delete('terrain-plan')
        apply_schedule()
      } catch (error) {
        if (revision !== plan_revision) return
        report_work_failure('terrain-plan', new Error(String(error), { cause: error }))
        return
      }
    }
  }

  const schedule = (): void => {
    if (disposed) return
    plan_revision += 1
    if (!focus || !plan_layers) {
      apply_schedule()
      return
    }
    const columns = desired_columns(focus, quality, render_distance)
    const column_keys = new Set(columns.map(({ x, z }) => `${x}:${z}`))
    layer_cache.forEach((_, key) => {
      if (!column_keys.has(key)) layer_cache.delete(key)
    })
    const missing = columns.filter(({ x, z }) => !layer_cache.has(`${x}:${z}`))
    if (missing.length === 0) {
      apply_schedule()
      return
    }
    const revision = plan_revision
    void plan_missing(revision, focus, missing)
  }

  const set_quality = (next: EngineQuality, next_render_distance: number | null): void => {
    if (disposed) return
    if (quality === next && render_distance === next_render_distance) return
    quality = next
    render_distance = next_render_distance
    engine.set_quality(quality, render_distance)
    schedule()
  }

  const dispose = (): void => {
    disposed = true
    resident.forEach((_, key) => engine.remove_chunk(key))
    in_flight.forEach((_, key) => engine.remove_chunk(key))
    resident.clear()
    in_flight.clear()
    wanted.clear()
    retry_at.clear()
    failures.clear()
    layer_cache.clear()
    focus = null
    plan_revision += 1
    completed = []
    queued = []
    evicting = []
  }

  return Object.freeze({
    set_focus: (world_x: number, world_z: number) => {
      if (disposed) return
      if (engine.backend() === 'grid') {
        if (focus) dispose()
        return
      }
      const next = { x: chunk_at(world_x), y: 0, z: chunk_at(world_z) }
      if (focus && chunk_key(next) === chunk_key(focus)) return
      focus = next
      failures.delete('terrain-plan')
      retry_at.delete('terrain-plan')
      schedule()
    },
    set_quality,
    tick: () => {
      if (disposed) return
      const planning_retry = retry_at.get('terrain-plan')
      if (planning_retry !== undefined && planning_retry <= now()) {
        retry_at.delete('terrain-plan')
        schedule()
      }
      const profile = get_quality_profile(quality).chunks
      const radius = effective_render_distance(profile.far_radius, render_distance)
      if (radius > 0 && evicting.length === 0 && engine.render_state().uploads_blocked > 0)
        set_quality(quality, radius - 1)
      const settled = completed
      completed = []
      settled.forEach(({ request, outcome }) => {
        const key = chunk_key(request.coordinate)
        if (in_flight.get(key) !== request) return
        in_flight.delete(key)
        if (outcome === 'rendered' && wanted.has(key)) {
          resident.set(key, request.lod)
          retry_at.delete(key)
          failures.delete(key)
          return
        }
        if (outcome !== 'failed' || !wanted.has(key)) return
        if (!report_work_failure(key, new Error(`Terrain chunk ${key} could not be displayed`))) return
        const retry = wanted.get(key)
        if (retry) queued = [...queued, retry]
      })
      if (disposed) return
      const remove_now = evicting.slice(0, profile.evict_per_frame)
      evicting = evicting.slice(remove_now.length)
      remove_now.forEach((key) => {
        engine.remove_chunk(key)
        resident.delete(key)
      })

      const available = Math.max(0, profile.max_in_flight - in_flight.size)
      const request_limit = Math.min(profile.request_per_frame, available)
      const eligible = queued.filter((request) => {
        const key = chunk_key(request.coordinate)
        return (
          wanted.get(key)?.lod === request.lod &&
          resident.get(key) !== request.lod &&
          !in_flight.has(key) &&
          (retry_at.get(key) ?? 0) <= now()
        )
      })
      const requested = eligible.slice(0, request_limit)
      const requested_keys = new Set(requested.map(({ coordinate }) => chunk_key(coordinate)))
      queued = queued.filter((request) => {
        const key = chunk_key(request.coordinate)
        return (
          wanted.get(key)?.lod === request.lod &&
          resident.get(key) !== request.lod &&
          !in_flight.has(key) &&
          !requested_keys.has(key)
        )
      })
      requested.forEach((request) => {
        const { coordinate, lod } = request
        const key = chunk_key(coordinate)
        in_flight.set(key, request)
        void engine.render_chunk({ key, coordinate, lod }).then(
          (outcome) => {
            if (in_flight.get(key) !== request) return
            completed = [...completed, Object.freeze({ request, outcome })]
          },
          () => {
            if (in_flight.get(key) !== request) return
            completed = [...completed, Object.freeze({ request, outcome: 'failed' as const })]
          }
        )
      })
    },
    stats: () => {
      const radius = effective_render_distance(get_quality_profile(quality).chunks.far_radius, render_distance)
      return Object.freeze({
        resident: resident.size,
        queued: queued.length,
        in_flight: in_flight.size,
        evicting: evicting.length,
        failed: failures.size,
        quality,
        render_distance: radius,
        planning: plan_layers && focus ? (radius * 2 + 1) ** 2 - layer_cache.size : 0,
      })
    },
    dispose,
  })
}
