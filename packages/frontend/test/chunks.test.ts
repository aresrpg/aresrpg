// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test } from 'bun:test'
import { get_quality_profile, type Engine, type RenderChunkRequest } from '@aresrpg/engine'

import { chunk_at, create_chunk_manager, desired_chunks } from '../src/game/core/chunks.ts'

const create_engine_spy = () => {
  const rendered: RenderChunkRequest[] = []
  const removed: string[] = []
  const engine: Engine = {
    fail: () => {},
    start: () => {},
    stop: () => {},
    set_camera: () => {},
    set_character_anchor: () => {},
    set_quality: () => {},
    set_audio_volume: () => {},
    set_time_of_day: () => {},
    set_clouds_visible: () => {},
    set_flatten_amount: () => {},
    set_fight_board: () => {},
    set_entities: () => {},
    set_fight_swords: () => {},
    set_fight_sword_label: () => {},
    set_resource_nodes: () => {},
    set_dungeon_portals: () => {},
    set_dungeon_stage: () => {},
    set_resource_node_label: () => {},
    set_portal_label: () => {},
    animate_entity: () => Promise.resolve(false),
    play_fight_cue: () => Promise.resolve(false),
    play_jump_puff: () => {},
    project_entity: () => null,
    set_entity_label: () => {},
    set_world_label: () => {},
    entity_height: () => null,
    create_fight_blob: () => 'test_blob',
    update_fight_blob: () => false,
    remove_fight_blob: () => {},
    pick_fight_cell: () => null,
    render_chunk: (chunk) => {
      rendered.push(chunk)
      return Promise.resolve('rendered')
    },
    remove_chunk: (key) => removed.push(key),
    chunk_count: () => rendered.length - removed.length,
    render_state: () => ({
      settled: true,
      mesh_queued: 0,
      mesh_active: 0,
      uploads_pending: 0,
      uploads_blocked: 0,
      retries_pending: 0,
      failed_chunks: 0,
      far_ready: true,
      sky_ready: true,
    }),
    quality: () => 'medium',
    flattened: () => false,
    backend: () => 'webgpu',
    status: () => ({ state: 'ready', backend: 'webgpu' }),
    subscribe_status: () => () => {},
    dispose: () => {},
  }
  return { engine, rendered, removed }
}

describe('game chunk planning', () => {
  test('negative world coordinates use floor-based chunk coordinates', () => {
    expect(chunk_at(-1, 16)).toBe(-1)
    expect(chunk_at(-16, 16)).toBe(-1)
    expect(chunk_at(-17, 16)).toBe(-2)
  })

  test('the high ring has one coordinate per near, mid, and far LOD', () => {
    const desired = desired_chunks({ x: 3, y: 0, z: -2 }, 'high')
    const { near_radius, mid_radius, far_radius } = get_quality_profile('high').chunks
    const square = (radius: number): number => (radius * 2 + 1) ** 2

    expect(desired[0]).toEqual({ coordinate: { x: 3, y: 0, z: -2 }, lod: 'near', distance: 0 })
    expect(new Set(desired.map(({ coordinate }) => `${coordinate.x}:${coordinate.y}:${coordinate.z}`)).size).toBe(
      square(far_radius)
    )
    expect(desired.filter(({ lod }) => lod === 'near')).toHaveLength(square(near_radius))
    expect(desired.filter(({ lod }) => lod === 'mid')).toHaveLength(square(mid_radius) - square(near_radius))
    expect(desired.filter(({ lod }) => lod === 'far')).toHaveLength(square(far_radius) - square(mid_radius))
  })

  test('derived surface layers expand the same horizontal residency ring', () => {
    const desired = desired_chunks({ x: 0, y: 0, z: 0 }, 'low', () => [-1, 0, 1])
    expect(desired).toHaveLength(147)
    expect(new Set(desired.map(({ coordinate }) => coordinate.y))).toEqual(new Set([-1, 0, 1]))
  })

  test('plans exact vertical surface layers top-first before submitting chunks', async () => {
    const spy = create_engine_spy()
    const chunks = create_chunk_manager({
      engine: spy.engine,
      initial_quality: 'low',
      plan_layers: (columns) =>
        Promise.resolve(columns.map(({ x, z }) => ({ x, z, layers: x === 0 && z === 0 ? [2, 3] : [2] }))),
    })

    chunks.set_focus(0, 0)
    await Promise.resolve()
    chunks.tick()

    expect(spy.rendered).toHaveLength(2)
    expect(spy.rendered.map(({ coordinate }) => coordinate.y)).toEqual([3, 2])
  })

  test('renders the focus column before planning outer residency rings', async () => {
    const spy = create_engine_spy()
    const center = Promise.withResolvers<readonly { x: number; z: number; layers: readonly number[] }[]>()
    const outer = Promise.withResolvers<readonly { x: number; z: number; layers: readonly number[] }[]>()
    const requests: Array<readonly { x: number; z: number }[]> = []
    const chunks = create_chunk_manager({
      engine: spy.engine,
      initial_quality: 'low',
      plan_layers: (columns) => {
        requests.push(columns)
        return requests.length === 1 ? center.promise : outer.promise
      },
    })

    chunks.set_focus(0, 0)
    expect(requests[0]).toEqual([{ x: 0, z: 0 }])
    expect(chunks.stats()).toMatchObject({ planning: 49, queued: 0, in_flight: 0 })
    center.resolve([{ x: 0, z: 0, layers: [3] }])
    await center.promise
    await Promise.resolve()
    chunks.tick()

    expect(spy.rendered[0]?.coordinate).toEqual({ x: 0, y: 3, z: 0 })
    expect(requests[1]).toHaveLength(8)
    expect(chunks.stats().planning).toBe(48)
    outer.resolve([])
  })

  test('a stale terrain plan cannot repopulate the cache after focus moves', async () => {
    const spy = create_engine_spy()
    const first = Promise.withResolvers<readonly { x: number; z: number; layers: readonly number[] }[]>()
    const latest = Promise.withResolvers<readonly { x: number; z: number; layers: readonly number[] }[]>()
    let request_count = 0
    const chunks = create_chunk_manager({
      engine: spy.engine,
      initial_quality: 'low',
      plan_layers: (columns) => {
        request_count += 1
        const plans = columns.map(({ x, z }) => ({ x, z, layers: [request_count === 1 ? 1 : 7] }))
        const request = request_count === 1 ? first : latest
        return request.promise.then(() => plans)
      },
    })

    chunks.set_focus(0, 0)
    chunks.set_focus(32, 0)
    latest.resolve([])
    await latest.promise
    await Promise.resolve()
    chunks.tick()

    first.resolve([])
    await first.promise
    await Promise.resolve()
    chunks.tick()

    expect(spy.rendered.length).toBeGreaterThan(0)
    expect(new Set(spy.rendered.map(({ coordinate }) => coordinate.y))).toEqual(new Set([7]))
  })

  test('streaming bounds submissions and records residency only after acknowledgement', async () => {
    const spy = create_engine_spy()
    const chunks = create_chunk_manager({ engine: spy.engine, initial_quality: 'low' })
    chunks.set_focus(0, 0)

    chunks.tick()
    expect(spy.rendered).toHaveLength(2)
    expect(chunks.stats()).toMatchObject({ resident: 0, in_flight: 2, queued: 47 })
    await Promise.resolve()
    chunks.tick()
    expect(chunks.stats().resident).toBe(2)
    expect(spy.rendered).toHaveLength(4)
  })

  test('quality changes retain matching resident chunks', async () => {
    const spy = create_engine_spy()
    const chunks = create_chunk_manager({ engine: spy.engine, initial_quality: 'medium' })
    chunks.set_focus(0, 0)
    while (chunks.stats().queued > 0 || chunks.stats().in_flight > 0) {
      chunks.tick()
      await Promise.resolve()
    }
    chunks.tick()
    const low_keys = new Set(
      desired_chunks({ x: 0, y: 0, z: 0 }, 'low').map(({ coordinate }) => `${coordinate.x}:0:${coordinate.z}`)
    )

    chunks.set_quality('low', null)
    chunks.tick()

    expect(spy.removed.filter((key) => low_keys.has(key))).toEqual([])
  })

  test('crossing a detail-band boundary re-renders only at a NEW lod, never the same one twice', async () => {
    // Residency is LOD-aware (2026-08-19, ground scatter exists only at near): a chunk that
    // changes bands on a focus move MUST re-render at its new lod, but a chunk that stays in
    // its band never rebuilds — the invariant is unique (key, lod) pairs, not unique keys.
    const spy = create_engine_spy()
    const chunks = create_chunk_manager({ engine: spy.engine, initial_quality: 'low' })
    chunks.set_focus(0, 0)
    while (chunks.stats().queued > 0 || chunks.stats().in_flight > 0) {
      chunks.tick()
      await Promise.resolve()
    }

    chunks.set_focus(32, 0)
    while (chunks.stats().queued > 0 || chunks.stats().in_flight > 0) {
      chunks.tick()
      await Promise.resolve()
    }

    const passes = spy.rendered.map(({ key, lod }) => `${key}@${lod}`)
    expect(new Set(passes).size).toBe(passes.length)
    // the crossing actually promoted/demoted some chunks — same key seen at two lods
    expect(new Set(spy.rendered.map(({ key }) => key)).size).toBeLessThan(spy.rendered.length)
  })
})

// A pool can be full even when every requested chunk is valid. Waiting for an eviction
// that the current residency plan never requests used to deadlock terrain permanently.
test('GPU pressure trims outer residency and the horizon together, then resumes uploads', async () => {
  const spy = create_engine_spy()
  let blocked = false
  const qualities: unknown[] = []
  const engine: Engine = {
    ...spy.engine,
    render_state: () => ({ ...spy.engine.render_state(), uploads_blocked: blocked ? 1 : 0 }),
    set_quality: (quality, distance) => {
      qualities.push([quality, distance])
    },
    remove_chunk: (key) => {
      blocked = false
      spy.engine.remove_chunk(key)
    },
  }
  const chunks = create_chunk_manager({ engine, initial_quality: 'low' })
  chunks.set_focus(0, 0)
  while (chunks.stats().queued || chunks.stats().in_flight) {
    chunks.tick()
    await Promise.resolve()
  }
  expect(chunks.stats().resident).toBe(49)
  blocked = true
  chunks.tick()
  expect(qualities).toEqual([['low', 2]])
  for (let frame = 0; frame < 20; frame += 1) {
    chunks.tick()
    await Promise.resolve()
  }
  expect(chunks.stats()).toMatchObject({ resident: 25, queued: 0, in_flight: 0, evicting: 0 })
  expect(spy.removed).toHaveLength(24)
  chunks.set_quality('medium', null)
  expect(qualities.at(-1)).toEqual(['medium', null])
  chunks.dispose()
})

test('shrinking to cached terrain invalidates an outstanding outer plan', async () => {
  const spy = create_engine_spy()
  const outer = Promise.withResolvers<void>()
  const chunks = create_chunk_manager({
    engine: spy.engine,
    initial_quality: 'low',
    plan_layers: async (columns) => {
      if (columns.length > 1) await outer.promise
      return columns.map(({ x, z }) => ({ x, z, layers: [0] }))
    },
  })
  chunks.set_focus(0, 0)
  await Promise.resolve()
  expect(chunks.stats().planning).toBe(48)
  chunks.set_quality('low', 0)
  expect(chunks.stats().planning).toBe(0)
  outer.resolve()
  await outer.promise
  await Promise.resolve()
  expect(chunks.stats().planning).toBe(0)
  chunks.dispose()
})

test('a removed request cannot consume the completion of a newer request for the same chunk', async () => {
  const spy = create_engine_spy()
  const requests: ReturnType<typeof Promise.withResolvers<'rendered' | 'removed'>>[] = []
  const chunks = create_chunk_manager({
    engine: {
      ...spy.engine,
      render_chunk: () => {
        const request = Promise.withResolvers<'rendered' | 'removed'>()
        requests.push(request)
        return request.promise
      },
    },
    initial_quality: 'low',
    initial_render_distance: 0,
  })
  for (const x of [0, 32, 0]) {
    chunks.set_focus(x, 0)
    chunks.tick()
  }
  expect(requests).toHaveLength(3)
  requests[0]!.resolve('removed')
  await requests[0]!.promise
  chunks.tick()
  expect(chunks.stats().in_flight).toBe(1)
  requests[2]!.resolve('rendered')
  await requests[2]!.promise
  chunks.tick()
  expect(chunks.stats().resident).toBe(1)
  requests[1]!.resolve('removed')
  await requests[1]!.promise
  chunks.dispose()
})

test('the grid backend stops terrain work and discards pending voxel plans', async () => {
  const spy = create_engine_spy()
  const pending = Promise.withResolvers<readonly { x: number; z: number; layers: readonly number[] }[]>()
  let backend: 'webgpu' | 'grid' = 'webgpu'
  let plans = 0
  const chunks = create_chunk_manager({
    engine: { ...spy.engine, backend: () => backend },
    initial_quality: 'low',
    plan_layers: () => {
      plans += 1
      return pending.promise
    },
  })
  chunks.set_focus(0, 0)
  expect(plans).toBe(1)
  backend = 'grid'
  chunks.set_focus(32, 0)
  chunks.tick()
  pending.resolve([{ x: 0, z: 0, layers: [0] }])
  await pending.promise
  chunks.set_quality('high', null)
  chunks.set_focus(64, 0)
  chunks.tick()
  expect(plans).toBe(1)
  expect(spy.rendered).toHaveLength(0)
  expect(chunks.stats()).toMatchObject({ resident: 0, planning: 0, queued: 0, in_flight: 0 })
  chunks.dispose()
})

test('a failed terrain plan retries the same stationary focus, then stops honestly after exhaustion', async () => {
  const { engine } = create_engine_spy()
  let time = 0
  let attempts = 0
  const errors: Error[] = []
  const manager = create_chunk_manager({
    engine,
    initial_quality: 'low',
    initial_render_distance: 0,
    now: () => time,
    on_failure: (error) => errors.push(error),
    plan_layers: async () => {
      attempts++
      throw new Error('interrupted city download')
    },
  })
  manager.set_focus(0, 0)
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(attempts).toBe(1)
  time = 10_000
  manager.tick()
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(attempts).toBe(2)
  time = 20_000
  manager.tick()
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(attempts).toBe(3)
  expect(errors).toHaveLength(1)
  time = 30_000
  manager.tick()
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(attempts).toBe(3)
  manager.dispose()
})

test('restored planning recovers stationary terrain and disposal never retries later', async () => {
  const { engine } = create_engine_spy()
  let time = 0
  let attempts = 0
  const manager = create_chunk_manager({
    engine,
    initial_quality: 'low',
    initial_render_distance: 0,
    now: () => time,
    plan_layers: async (columns) => {
      attempts++
      if (attempts === 1) throw new Error('offline')
      return columns.map((column) => ({ ...column, layers: [0] }))
    },
  })
  manager.set_focus(0, 0)
  await new Promise((resolve) => setTimeout(resolve, 0))
  time = 10_000
  manager.tick()
  await new Promise((resolve) => setTimeout(resolve, 0))
  manager.tick()
  await Promise.resolve()
  manager.tick()
  expect(attempts).toBe(2)
  expect(manager.stats()).toMatchObject({ failed: 0, resident: 1 })
  manager.dispose()
  time = 20_000
  manager.tick()
  expect(attempts).toBe(2)

  let disposed_attempts = 0
  const disposed = create_chunk_manager({
    engine,
    now: () => time,
    plan_layers: async () => {
      disposed_attempts++
      throw new Error('offline')
    },
  })
  disposed.set_focus(0, 0)
  await new Promise((resolve) => setTimeout(resolve, 0))
  disposed.dispose()
  time = 30_000
  disposed.tick()
  expect(disposed_attempts).toBe(1)
})

test('abandoned chunk failures leave no retry metadata in the next focus', async () => {
  const spy = create_engine_spy()
  const manager = create_chunk_manager({
    engine: { ...spy.engine, render_chunk: async () => 'failed' },
    initial_quality: 'low',
    initial_render_distance: 0,
  })
  manager.set_focus(0, 0)
  manager.tick()
  await Promise.resolve()
  manager.tick()
  expect(manager.stats().failed).toBe(1)
  manager.set_focus(32, 0)
  expect(manager.stats().failed).toBe(0)
  manager.dispose()
})
