// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { world_terrain } from '../src/world_catalog.ts'
import { parse_world_recipe } from '../src/world_recipe.ts'

test('real mesh and planner workers return a failed job ID and accept subsequent work', async () => {
  for (const name of ['mesh_worker', 'terrain_plan_worker']) {
    const worker = new Worker(new URL(`../src/${name}.ts`, import.meta.url), { type: 'module' })
    const requests = new Map<number, (value: { id: number; error?: string; result?: unknown }) => void>()
    worker.addEventListener('message', ({ data }) => requests.get(data.id)?.(data))
    const reply = (id: number, payload: unknown) =>
      new Promise<{ id: number; error?: string; result?: unknown }>((resolve) => {
        requests.set(id, resolve)
        worker.postMessage(payload)
      })
    try {
      worker.postMessage({ type: 'initialize', world: parse_world_recipe(world_terrain('nauvis')) })
      const bad = await reply(
        1,
        name === 'mesh_worker' ? { type: 'mesh', id: 1, chunk: null } : { type: 'plan', id: 1, columns: null }
      )
      expect(bad.id).toBe(1)
      expect(bad.error).toBeString()
      const good = await reply(
        2,
        name === 'mesh_worker'
          ? { type: 'mesh', id: 2, chunk: { key: 'recovered', coordinate: { x: 10_000, y: 0, z: 10_000 }, lod: 'far' } }
          : { type: 'plan', id: 2, columns: [{ x: 10_000, z: 10_000 }] }
      )
      expect(good.id).toBe(2)
      expect(good.error).toBeUndefined()
      expect(good.result).toBeDefined()
    } finally {
      worker.terminate()
    }
  }
})

test('the existing mesh worker prepares transferred flora buffers without a terrain request', async () => {
  const worker = new Worker(new URL('../src/mesh_worker.ts', import.meta.url), { type: 'module' })
  try {
    const result = new Promise<{ type: string; result: { position: Float32Array }; error?: string }>((resolve) => {
      worker.addEventListener('message', ({ data }) => resolve(data), { once: true })
    })
    worker.postMessage({
      type: 'flora',
      rows: [
        { kind: 'fern', center: [4, 7, -2], scale: 1.5, color: [0.2, 0.4, 0.6], accent: [0.6, 0.5, 0.4], glow: 0.3 },
      ],
    })
    const reply = await result
    expect(reply.type).toBe('flora')
    expect(reply.error).toBeUndefined()
    expect(reply.result.position).toBeInstanceOf(Float32Array)
    expect(reply.result.position.length).toBe(252 * 3)
    expect(reply.result.position.every(Number.isFinite)).toBe(true)
  } finally {
    worker.terminate()
  }
})
