// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import {
  CHUNK_EDGE,
  get_quality_profile,
  type ChunkCoordinate,
  type ChunkLod,
  type ChunkRenderOutcome,
  type Engine,
  type EngineQuality,
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
  vertical_chunks: readonly number[] = [0]
): readonly ChunkRequest[] => {
  const radii = get_quality_profile(quality).chunks
  const width = radii.far_radius * 2 + 1
  return Array.from({ length: width * width * vertical_chunks.length }, (_, index) => {
    const layer = Math.floor(index / (width * width))
    const plane_index = index % (width * width)
    const coordinate = {
      x: focus.x + (plane_index % width) - radii.far_radius,
      y: vertical_chunks[layer],
      z: focus.z + Math.floor(plane_index / width) - radii.far_radius,
    }
    const distance = Math.max(Math.abs(coordinate.x - focus.x), Math.abs(coordinate.z - focus.z))
    return { coordinate, lod: request_lod(distance, radii), distance }
  }).sort((left, right) => left.distance - right.distance)
}

export const create_chunk_manager = ({
  engine,
  initial_quality = 'medium',
  vertical_chunks = [0],
  now = () => performance.now(),
}: Readonly<{
  engine: Engine
  initial_quality?: EngineQuality
  vertical_chunks?: readonly number[]
  now?: () => number
}>) => {
  const resident = new Set<string>()
  const in_flight = new Set<string>()
  const wanted = new Map<string, ChunkRequest>()
  const retry_at = new Map<string, number>()
  const failures = new Map<string, number>()
  let completed: readonly Readonly<{ key: string; outcome: ChunkRenderOutcome }>[] = []
  let queued: readonly ChunkRequest[] = []
  let evicting: readonly string[] = []
  let focus: ChunkCoordinate | null = null
  let quality = initial_quality

  const schedule = (): void => {
    if (!focus) return
    const desired = desired_chunks(focus, quality, vertical_chunks)
    wanted.clear()
    desired.forEach((request) => wanted.set(chunk_key(request.coordinate), request))
    const wanted_keys = new Set(wanted.keys())
    queued = desired.filter(({ coordinate }) => {
      const key = chunk_key(coordinate)
      return !resident.has(key) && !in_flight.has(key)
    })
    evicting = [...resident].filter((key) => !wanted_keys.has(key))
    in_flight.forEach((key) => {
      if (wanted_keys.has(key)) return
      engine.remove_chunk(key)
      in_flight.delete(key)
    })
  }

  return Object.freeze({
    set_focus: (world_x: number, world_z: number) => {
      const next = { x: chunk_at(world_x), y: 0, z: chunk_at(world_z) }
      if (focus && chunk_key(next) === chunk_key(focus)) return
      focus = next
      schedule()
    },
    set_quality: (next: EngineQuality) => {
      if (quality === next) return
      quality = next
      schedule()
    },
    tick: () => {
      const profile = get_quality_profile(quality).chunks
      const settled = completed
      completed = []
      settled.forEach(({ key, outcome }) => {
        if (!in_flight.delete(key)) return
        if (outcome === 'rendered' && wanted.has(key)) {
          resident.add(key)
          retry_at.delete(key)
          failures.delete(key)
          return
        }
        if (outcome !== 'failed' || !wanted.has(key)) return
        const failure_count = (failures.get(key) ?? 0) + 1
        failures.set(key, failure_count)
        retry_at.set(key, now() + Math.min(5_000, 100 * 2 ** (failure_count - 1)))
        const request = wanted.get(key)
        if (request) queued = [...queued, request]
      })
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
        return wanted.has(key) && !resident.has(key) && !in_flight.has(key) && (retry_at.get(key) ?? 0) <= now()
      })
      const requested = eligible.slice(0, request_limit)
      const requested_keys = new Set(requested.map(({ coordinate }) => chunk_key(coordinate)))
      queued = queued.filter((request) => {
        const key = chunk_key(request.coordinate)
        return wanted.has(key) && !resident.has(key) && !in_flight.has(key) && !requested_keys.has(key)
      })
      requested.forEach((request) => {
        const { coordinate, lod } = request
        const key = chunk_key(coordinate)
        in_flight.add(key)
        void engine.render_chunk({ key, coordinate, lod }).then(
          (outcome) => {
            completed = [...completed, Object.freeze({ key, outcome })]
          },
          () => {
            completed = [...completed, Object.freeze({ key, outcome: 'failed' })]
          }
        )
      })
    },
    stats: () =>
      Object.freeze({
        resident: resident.size,
        queued: queued.length,
        in_flight: in_flight.size,
        evicting: evicting.length,
        failed: failures.size,
        quality,
      }),
    dispose: () => {
      resident.forEach(engine.remove_chunk)
      in_flight.forEach(engine.remove_chunk)
      resident.clear()
      in_flight.clear()
      wanted.clear()
      retry_at.clear()
      failures.clear()
      completed = []
      queued = []
      evicting = []
    },
  })
}
