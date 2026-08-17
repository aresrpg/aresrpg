// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test } from 'bun:test'
import type { Engine, RenderChunkRequest } from '@aresrpg/engine'

import { chunk_at, create_chunk_manager, desired_chunks } from '../src/game/core/chunks.ts'

const create_engine_spy = () => {
  const rendered: RenderChunkRequest[] = []
  const removed: string[] = []
  const engine: Engine = {
    start: () => {},
    stop: () => {},
    set_camera: () => {},
    set_quality: () => {},
    set_time_of_day: () => {},
    set_flatten_amount: () => {},
    set_fight_board: () => {},
    set_entities: () => {},
    animate_entity: () => Promise.resolve(false),
    play_fight_cue: () => Promise.resolve(false),
    project_entity: () => null,
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

    expect(desired[0]).toEqual({ coordinate: { x: 3, y: 0, z: -2 }, lod: 'near', distance: 0 })
    expect(new Set(desired.map(({ coordinate }) => `${coordinate.x}:${coordinate.y}:${coordinate.z}`)).size).toBe(361)
    expect(desired.filter(({ lod }) => lod === 'near')).toHaveLength(49)
    expect(desired.filter(({ lod }) => lod === 'mid')).toHaveLength(120)
    expect(desired.filter(({ lod }) => lod === 'far')).toHaveLength(192)
  })

  test('world-authored vertical layers expand the same horizontal residency ring', () => {
    const desired = desired_chunks({ x: 0, y: 0, z: 0 }, 'low', [-1, 0, 1])
    expect(desired).toHaveLength(147)
    expect(new Set(desired.map(({ coordinate }) => coordinate.y))).toEqual(new Set([-1, 0, 1]))
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

    chunks.set_quality('low')
    chunks.tick()

    expect(spy.removed.filter((key) => low_keys.has(key))).toEqual([])
  })

  test('crossing a detail-band boundary never rebuilds identical resident terrain', async () => {
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

    expect(new Set(spy.rendered.map(({ key }) => key)).size).toBe(spy.rendered.length)
  })
})
