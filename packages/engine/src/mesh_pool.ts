// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { FloraMeshData } from './scenery_flora_mesh.ts'
import type { GreedyMeshData } from './greedy_mesher.ts'
import type { ScatterMeshData } from './scatter_mesh.ts'
import type { RenderChunkRequest, RenderedChunk } from './types.ts'
import { terrain_recipe, type WorldRecipe } from './world_recipe.ts'
import { read_worker_error, type WorkerReply } from './worker_reply.ts'

export type MeshResult = Readonly<{
  chunk: RenderedChunk
  mesh: GreedyMeshData
  scatter: ScatterMeshData | null
}>

type Job = Readonly<{
  id: number
  chunk: RenderChunkRequest
  priority: number
  resolve: (data: MeshResult) => void
  reject: (error: Error) => void
}>

export type MeshPool = Readonly<{
  prepare_flora: () => Promise<FloraMeshData | null>
  mesh: (chunk: RenderChunkRequest, priority: number) => Promise<MeshResult>
  cancel: (key: string) => void
  state: () => Readonly<{ queued: number; active: number }>
  dispose: () => void
}>

type MeshWorker = Pick<Worker, 'addEventListener' | 'postMessage' | 'terminate'>

export const create_mesh_pool = (
  world: WorldRecipe,
  worker_factory: () => MeshWorker = () => new Worker(new URL('./mesh_worker.ts', import.meta.url), { type: 'module' })
): MeshPool => {
  const count = Math.max(1, Math.min(6, (navigator.hardwareConcurrency || 4) - 2))
  const workers: MeshWorker[] = []
  try {
    for (let index = 0; index < count; index++) workers.push(worker_factory())
  } catch (error) {
    workers.forEach((worker) => worker.terminate())
    throw error
  }
  const idle = [...workers]
  const queued: Job[] = []
  const active = new Map<MeshWorker, Job>()
  let next_id = 1
  // Set once by a worker fault or disposal; every later request rejects with it.
  let ended: Error | null = null
  let flora: Promise<FloraMeshData | null> | null = null
  let flora_request: Readonly<{
    resolve: (data: FloraMeshData | null) => void
    reject: (error: Error) => void
  }> | null = null

  const reject_all = (error: Error): void => {
    if (ended) return
    ended = error
    flora_request?.reject(error)
    flora_request = null
    queued.splice(0).forEach(({ reject }) => reject(error))
    active.forEach(({ reject }) => reject(error))
    active.clear()
    workers.forEach((worker) => worker.terminate())
    idle.length = 0
  }

  const drain = (): void => {
    while (idle.length > 0 && queued.length > 0) {
      const worker = idle.pop()
      const job = queued.shift()
      if (!worker || !job) return
      active.set(worker, job)
      try {
        worker.postMessage({ type: 'mesh', id: job.id, chunk: job.chunk })
      } catch (error) {
        reject_all(error instanceof Error ? error : new Error(String(error)))
      }
    }
  }

  workers.forEach((worker) => {
    worker.addEventListener(
      'message',
      ({ data }: MessageEvent<WorkerReply<MeshResult> | (WorkerReply<FloraMeshData | null> & { type: 'flora' })>) => {
        if ('type' in data) {
          if ('error' in data) flora_request?.reject(read_worker_error(data))
          else flora_request?.resolve(data.result)
          flora_request = null
          return
        }
        const job = active.get(worker)
        if (!job || job.id !== data.id) return
        active.delete(worker)
        idle.push(worker)
        if ('error' in data) job.reject(read_worker_error(data))
        else job.resolve(data.result)
        drain()
      }
    )
    worker.addEventListener('error', (event) => reject_all(new Error(event.message)))
    worker.addEventListener('messageerror', () => reject_all(new Error('mesh worker reply could not be decoded')))
  })
  try {
    workers.forEach((worker) => worker.postMessage({ type: 'initialize', world: terrain_recipe(world) }))
  } catch (error) {
    reject_all(error instanceof Error ? error : new Error(String(error)))
  }

  return Object.freeze({
    prepare_flora: () => {
      if (ended) return Promise.reject(ended)
      flora ??= new Promise<FloraMeshData | null>((resolve, reject) => {
        flora_request = { resolve, reject }
        workers[0]!.postMessage({ type: 'flora', rows: world.scenery?.plants ?? [] })
      })
      return flora
    },
    mesh: (chunk: RenderChunkRequest, priority: number) =>
      new Promise<MeshResult>((resolve, reject) => {
        if (ended) {
          reject(ended)
          return
        }
        for (let index = queued.length - 1; index >= 0; index -= 1) {
          if (queued[index]?.chunk.key !== chunk.key) continue
          const [superseded] = queued.splice(index, 1)
          superseded?.reject(new Error(`mesh job ${chunk.key} was superseded`))
        }
        queued.push({ id: next_id, chunk, priority, resolve, reject })
        queued.sort((left, right) => left.priority - right.priority)
        next_id += 1
        drain()
      }),
    cancel: (key: string) => {
      // Keep an active worker occupied until its matching reply; cancellation settles only its caller.
      active.forEach((job) => {
        if (job.chunk.key === key) job.reject(new Error(`mesh job ${key} was cancelled`))
      })
      for (let index = queued.length - 1; index >= 0; index -= 1) {
        const job = queued[index]
        if (job?.chunk.key !== key) continue
        queued.splice(index, 1)
        job.reject(new Error(`mesh job ${key} was cancelled`))
      }
    },
    state: () => Object.freeze({ queued: queued.length, active: active.size }),
    dispose: () => reject_all(new Error('mesh pool is disposed')),
  })
}
