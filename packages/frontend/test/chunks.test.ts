// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test } from 'bun:test'
import { get_quality_profile, type Engine, type RenderChunkRequest } from '@aresrpg/engine'

import { chunk_at, create_chunk_manager, desired_chunks } from '../src/game/core/chunks.ts'

const create_engine_spy = () => {
  const rendered: RenderChunkRequest[] = []
  const removed: string[] = []
  const engine: Engine = {
    start: () => {},
    stop: () => {},
    set_camera: () => {},
    set_character_anchor: () => {},
    set_quality: () => {},
    set_time_of_day: () => {},
    set_flatten_amount: () => {},
    set_fight_board: () => {},
    set_entities: () => {},
    set_fight_swords: () => {},
    set_fight_sword_label: () => {},
    set_resource_nodes: () => {},
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
    center.resolve([{ x: 0, z: 0, layers: [3] }])
    await center.promise
    await Promise.resolve()
    chunks.tick()

    expect(spy.rendered[0]?.coordinate).toEqual({ x: 0, y: 3, z: 0 })
    expect(requests[1]).toHaveLength(8)
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
