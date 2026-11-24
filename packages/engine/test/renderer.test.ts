// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, mock, test } from 'bun:test'

import {
  compile_runtime_world_recipe,
  create_authored_spell_source,
  parse_world_recipe,
  QUALITY_OPTIONS,
  QUALITY_PROFILES,
  spell_effect_timing,
  SPELL_EFFECT_CLASSES,
  world_terrain,
} from '../src/data.ts'
import type { EngineBackend } from '../src/backend.ts'
import { create_mesh_pool } from '../src/mesh_pool.ts'
import { quality_pixel_ratio, spell_effect_size, uses_world_post_processing } from '../src/quality.ts'
import { create_terrain_planner } from '../src/terrain_planner.ts'
import type { Engine, EngineIssue, EngineStatus, RenderChunkRequest } from '../src/types.ts'
import { create_upload_queue } from '../src/upload_queue.ts'

const chunk = (key: string): RenderChunkRequest => ({ key, coordinate: { x: 0, y: 0, z: 0 }, lod: 'near' })
const fake_worker = () => {
  const listeners = new Map<string, (event: unknown) => void>()
  const sent: { id?: number; type?: string }[] = []
  return {
    addEventListener: ((type: string, listener: (event: unknown) => void) =>
      listeners.set(type, listener)) as Worker['addEventListener'],
    postMessage: (message: { id?: number; type?: string }) => void sent.push(message),
    terminate: () => undefined,
    emit: (type: string, data: unknown) => listeners.get(type)?.(type === 'message' ? { data } : data),
    sent,
  }
}
const rejection = (promise: Promise<unknown>) => promise.then(String, (error: Error) => error.message)

test('one upload budget covers voxel and detail jobs; cancelled jobs never upload and capacity blocks retries', () => {
  let clock = 0
  const queue = create_upload_queue(() => clock)
  const applied: string[] = []
  const job = (key: string, bytes = 80, upload = () => (applied.push(key), true)) =>
    queue.add({ key, origin: [0, 0, 0], bytes, upload })
  ;['terrain:a', 'detail:a', 'detail:b'].forEach((key) => job(key))
  expect(queue.drain([0, 0, 0], 100, 1)).toBe(80)
  queue.remove('detail:a')
  queue.drain([0, 0, 0], 100, 1)
  expect([applied, queue.size()]).toEqual([['terrain:a', 'detail:b'], 0])
  let capacity = false
  let attempts = 0
  job('terrain', 8, () => {
    attempts++
    if (capacity) job('detail', 10, () => true)
    return capacity
  })
  queue.drain([0, 0, 0], 100, 1)
  queue.drain([0, 0, 0], 100, 1)
  expect([attempts, queue.blocked_count()]).toEqual([1, 1])
  capacity = true
  queue.release()
  queue.drain([0, 0, 0], 100, 1)
  expect([queue.size(), queue.drain([0, 0, 0], 100, 1)]).toEqual([1, 10])
  job('slow', 0, () => ((clock = 2), true))
  job('newest', 8, () => (applied.push('old'), true))
  job('newest', 8, () => (applied.push('new'), true))
  queue.drain([0, 0, 0], 100, 1)
  expect(applied.slice(2)).toEqual([])
  queue.drain([0, 0, 0], 100, 1)
  expect(applied.slice(2)).toEqual(['new'])
  queue.dispose()
  expect(queue.size()).toBe(0)
})

test('mesh jobs: superseded and cancelled jobs reject, stale replies free nothing, a worker fault is terminal', async () => {
  const workers: ReturnType<typeof fake_worker>[] = []
  const factory = () => {
    const worker = fake_worker()
    workers.push(worker)
    return worker
  }
  const pool = create_mesh_pool({ scenery: { plants: [] } } as never, factory)
  const flora = pool.prepare_flora()
  expect(pool.prepare_flora()).toBe(flora)
  workers[0]!.emit('message', { type: 'flora', result: null })
  expect(await flora).toBeNull()
  const active = workers.map((_, index) => rejection(pool.mesh(chunk(`active-${index}`), index)))
  const superseded = rejection(pool.mesh(chunk('same'), 10))
  const newest = pool.mesh(chunk('same'), 10)
  expect(await superseded).toContain('superseded')
  const worker = workers.at(-1)!
  const request = worker.sent.at(-1)!
  worker.emit('message', { id: request.id, error: 'download interrupted' })
  expect(await active[0]).toBe('download interrupted')
  const replacement = worker.sent.at(-1)!
  const busy = pool.state().active
  worker.emit('message', { id: request.id, error: 'late' })
  expect(pool.state().active).toBe(busy)
  worker.emit('message', { id: replacement.id, result: 'new mesh' })
  expect(await newest).toBe('new mesh' as never)
  const cancelled = rejection(pool.mesh(chunk('cancelled'), 0))
  pool.cancel('cancelled')
  expect(await cancelled).toContain('cancelled')
  const queued = Array.from({ length: workers.length + 1 }, (_, index) =>
    rejection(pool.mesh(chunk(`fault-${index}`), index))
  )
  workers[1]!.emit('error', { message: 'worker initialization failed' })
  expect(new Set(await Promise.all([...active.slice(1), ...queued]))).toEqual(new Set(['worker initialization failed']))
  expect(pool.state()).toEqual({ active: 0, queued: 0 })
  expect(await rejection(pool.mesh(chunk('future'), 0))).toBe('worker initialization failed')
  expect(await rejection(pool.prepare_flora())).toBe('worker initialization failed')
  pool.dispose()
  const disposed = create_mesh_pool({} as never, fake_worker)
  const pending_flora = rejection(disposed.prepare_flora())
  disposed.dispose()
  expect(await pending_flora).toContain('disposed')
})

test('terrain planning keeps one active and the latest queued focus, then ends on a fault or disposal', async () => {
  const world = parse_world_recipe(world_terrain('nauvis'))
  const worker = fake_worker()
  const planner = create_terrain_planner(world, () => worker)
  const first = planner.plan([{ x: 0, z: 0 }])
  const superseded = rejection(planner.plan([{ x: 1, z: 0 }]))
  const latest = planner.plan([{ x: 2, z: 0 }])
  expect(worker.sent.map(({ type, id }) => [type, id])).toEqual([
    ['initialize', undefined],
    ['plan', 1],
  ])
  expect(await superseded).toBe('terrain plan was superseded by a newer focus')
  worker.emit('message', { id: 1, result: [] })
  await first
  expect(worker.sent.at(-1)).toMatchObject({ type: 'plan', id: 3, columns: [{ x: 2, z: 0 }] })
  worker.emit('message', { id: 3, result: [] })
  await latest
  expect(await planner.plan([])).toEqual([])
  const pending = rejection(planner.plan([{ x: 4, z: 0 }]))
  worker.emit('messageerror', {})
  expect(await pending).toBe('terrain planner reply could not be decoded')
  expect(await rejection(planner.plan([{ x: 5, z: 0 }]))).toBe('terrain planner reply could not be decoded')
  planner.dispose()
  const disposed = create_terrain_planner(world, fake_worker)
  disposed.dispose()
  expect(await rejection(disposed.plan([{ x: 0, z: 0 }]))).toBe('terrain planner is disposed')
})

type WorkerReplyData = { id: number; error?: string; result?: { position?: Float32Array } }
// Drives one real worker: a malformed job must fail by id, then the next job and flora must succeed.
const exercise_worker = async (name: string, jobs: readonly unknown[]): Promise<readonly WorkerReplyData[]> => {
  const worker = new Worker(new URL(`../src/${name}.ts`, import.meta.url), { type: 'module' })
  const replies: WorkerReplyData[] = []
  try {
    worker.postMessage({ type: 'initialize', world: parse_world_recipe(world_terrain('nauvis')) })
    for (const job of jobs) {
      const reply = new Promise<WorkerReplyData>((resolve) =>
        worker.addEventListener('message', ({ data }) => resolve(data), { once: true })
      )
      worker.postMessage(job)
      replies.push(await reply)
    }
    return replies
  } finally {
    worker.terminate()
  }
}

test('real mesh and planner workers return a failed job id, then accept work and flora', async () => {
  const far = { x: 10_000, y: 0, z: 10_000 }
  const fern = {
    kind: 'fern',
    center: [4, 7, -2],
    scale: 1.5,
    color: [0.2, 0.4, 0.6],
    accent: [0.6, 0.5, 0.4],
    glow: 0.3,
  }
  const [bad_mesh, mesh, flora] = await exercise_worker('mesh_worker', [
    { type: 'mesh', id: 1, chunk: null },
    { type: 'mesh', id: 2, chunk: { key: 'recovered', coordinate: far, lod: 'far' } },
    { type: 'flora', rows: [fern] },
  ])
  const [bad_plan, plan] = await exercise_worker('terrain_plan_worker', [
    { type: 'plan', id: 1, columns: null },
    { type: 'plan', id: 2, columns: [{ x: 10_000, z: 10_000 }] },
  ])
  for (const bad of [bad_mesh!, bad_plan!]) expect([bad.id, typeof bad.error]).toEqual([1, 'string'])
  for (const good of [mesh!, plan!])
    expect([good.id, good.error, good.result === undefined]).toEqual([2, undefined, false])
  const positions = flora!.result!.position!
  expect([positions.length, positions.every(Number.isFinite)]).toEqual([252 * 3, true])
}, 30_000)

const backend_calls: string[] = []
const boot = { report: (_issue?: EngineIssue) => {}, fail: null as Error | null, render_error: false, disposed: 0 }
const backend = new Proxy({} as EngineBackend, {
  get: (_target, key) => {
    if (key === 'then') return undefined
    if (key === 'render_chunk') return () => new Promise(() => undefined)
    if (key === 'play_fight_cue') return async () => true
    if (key === 'dispose') return () => void boot.disposed++
    if (key === 'render')
      return () => {
        if (boot.render_error) throw new Error('GPU submission failed')
        backend_calls.push('render')
      }
    return (...args: unknown[]) => void backend_calls.push(`${String(key)}:${JSON.stringify(args[0] ?? null)}`)
  },
})
void mock.module('../src/webgpu_backend.ts', () => ({
  create_webgpu_backend: async (_canvas: unknown, _quality: unknown, _world: unknown, report: typeof boot.report) => {
    if (boot.fail) throw boot.fail
    boot.report = report
    return backend
  },
}))

const frames: FrameRequestCallback[] = []
const settled = (engine: Engine) =>
  new Promise<EngineStatus>((resolve) =>
    engine.subscribe_status((status) => status.state !== 'initializing' && resolve(status))
  )
const boot_engine = async () => {
  Object.defineProperties(globalThis, {
    navigator: { value: { gpu: {} }, configurable: true },
    requestAnimationFrame: { value: (callback: FrameRequestCallback) => frames.push(callback), configurable: true },
    cancelAnimationFrame: { value: () => undefined, configurable: true },
  })
  const { create_engine } = await import('../src/renderer.ts')
  const world = compile_runtime_world_recipe(world_terrain('nauvis'), { structures: false })
  return () => create_engine({ canvas: {} as never, world })
}

test('the engine replays retained state on attach and its failed state is terminal', async () => {
  const create = await boot_engine()
  const element = {} as HTMLElement
  const engine = create()
  engine.set_label('pet', { element, anchor: { kind: 'entity', id: 'pet' } })
  engine.set_label('dropped', { element, anchor: { kind: 'portal' } })
  engine.set_label('dropped', null)
  engine.set_time_of_day(1.25)
  engine.set_entity_caption('mob', null)
  const cue = engine.play_fight_cue({ id: 'cue', type: 'zone_removed', zone_id: 'zone' })
  expect(engine.backend()).toBe('initializing')
  expect(await settled(engine)).toEqual({ state: 'ready', backend: 'webgpu' })
  expect(await cue).toBe(true)
  expect(backend_calls.filter((call) => call.startsWith('set_label') || call.startsWith('set_time'))).toEqual([
    'set_time_of_day:0.25',
    'set_label:"pet"',
  ])
  expect(backend_calls[0]).toStartWith('set_quality')
  boot.report({ code: 'advanced_sky_failed' })
  expect(engine.status()).toMatchObject({ state: 'degraded', issue: { code: 'advanced_sky_failed' } })
  engine.start()
  frames.at(-1)!(performance.now() + 100)
  expect(engine.frame_count()).toBe(1)
  const pending = engine.render_chunk(chunk('pending'))
  boot.report({ code: 'webgpu_device_lost' })
  boot.report()
  expect(engine.status()).toEqual({ state: 'failed', backend: 'webgpu', issue: { code: 'webgpu_device_lost' } })
  expect([await pending, await engine.render_chunk(chunk('late')), boot.disposed]).toEqual(['failed', 'failed', 1])
  expect(await engine.play_fight_cue({ id: 'late', type: 'zone_removed', zone_id: 'zone' })).toBe(false)
  engine.start()
  engine.dispose()
  expect([boot.disposed, engine.status().state, engine.backend()]).toEqual([1, 'failed', 'initializing'])
})

test('render, boot and asset failures end the engine once, and disposal settles its waiters', async () => {
  const create = await boot_engine()
  const crashing = create()
  await settled(crashing)
  crashing.start()
  boot.render_error = true
  const { error } = console
  console.error = () => undefined
  frames.at(-1)!(performance.now() + 200)
  console.error = error
  expect(crashing.status()).toMatchObject({
    state: 'failed',
    backend: 'webgpu',
    issue: { code: 'graphics_unavailable' },
  })
  expect(crashing.status().issue?.stack).toContain('GPU submission failed')
  boot.render_error = false
  crashing.dispose()

  boot.fail = new Error('adapter initialization rejected')
  const rejected = create()
  expect(await settled(rejected)).toMatchObject({
    state: 'failed',
    backend: 'none',
    issue: { code: 'webgpu_initialization_failed', detail: 'adapter initialization rejected' },
  })
  rejected.dispose()
  boot.fail = null

  const missing = create()
  await settled(missing)
  const disposals = boot.disposed
  missing.fail({ code: 'asset_missing', detail: 'missing city details' })
  expect([missing.status().issue?.code, boot.disposed - disposals]).toEqual(['asset_missing', 1])
  const removed = create()
  const waiting = removed.render_chunk(chunk('waiting'))
  removed.dispose()
  expect([await waiting, await removed.render_chunk(chunk('after'))]).toEqual(['removed', 'removed'])

  Object.defineProperty(globalThis, 'navigator', { value: {}, configurable: true })
  const unsupported = create()
  expect(await settled(unsupported)).toEqual({
    state: 'failed',
    backend: 'none',
    issue: { code: 'webgpu_unavailable' },
  })
  unsupported.dispose()
})

describe('quality and spells', () => {
  test('quality caps dense displays and bounds spell pixels without upscaling small canvases', () => {
    expect(Object.keys(QUALITY_PROFILES)).toEqual(['low', 'medium', 'high'])
    const high = quality_pixel_ratio({ quality: 'high', css_width: 5120, css_height: 1440, device_pixel_ratio: 1 })
    expect(5120 * 1440 * high * high).toBeCloseTo(6_000_000)
    const medium = quality_pixel_ratio({ quality: 'medium', css_width: 3840, css_height: 2160, device_pixel_ratio: 2 })
    expect(3840 * 2160 * medium * medium).toBeCloseTo(3_500_000)
    for (const quality of QUALITY_OPTIONS) {
      const [width, height] = spell_effect_size(quality, 3265, 1837)
      expect(width * height).toBeLessThanOrEqual(QUALITY_PROFILES[quality].effects.spell_pixels)
      expect(width / height).toBeCloseTo(3265 / 1837, 2)
      expect(spell_effect_size(quality, 320, 224)).toEqual([320, 224])
    }
    expect(QUALITY_OPTIONS.map(uses_world_post_processing)).toEqual([false, true, true])
    const shafts = QUALITY_PROFILES.high.effects.sun_shafts!
    expect(shafts.samples * shafts.resolution ** 2).toBeLessThanOrEqual(4)
  })

  test('every authored spell orders release, impact, completion and end, and a placed trap holds 1.1 s', () => {
    const source = create_authored_spell_source()
    expect(SPELL_EFFECT_CLASSES).toEqual(Object.keys(source.catalog))
    const presets = SPELL_EFFECT_CLASSES.flatMap((classe) =>
      source.catalog[classe]!.map(({ name }) => source.select(classe, name))
    )
    expect(presets).toHaveLength(240)
    for (const preset of presets) {
      const placed = spell_effect_timing({ preset, areas: [], atlas_urls: [], triggered: false })
      expect(placed.release_seconds).toBeLessThanOrEqual(placed.impact_seconds)
      expect(placed.impact_seconds).toBeLessThan(placed.complete_seconds)
      expect(placed.complete_seconds).toBeLessThanOrEqual(placed.end_seconds)
      if (preset.trap) expect(placed.end_seconds - placed.impact_seconds).toBeCloseTo(1.1)
      const triggered = spell_effect_timing({ preset, areas: [], atlas_urls: [], triggered: true })
      expect([triggered.release_seconds, triggered.travel_seconds]).toEqual([0, 0])
    }
    expect(presets.some(({ trap }) => trap)).toBe(true)
  })
})
