// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { GreedyMeshData } from './greedy_mesher.ts'
import type { ScatterInstance } from './scatter.ts'
import type { RenderChunkRequest, RenderedChunk } from './types.ts'
import type { WorldRecipe } from './world_recipe.ts'
import type { WorkerReply } from './worker_reply.ts'

export type MeshResult = Readonly<{
  chunk: RenderedChunk
  mesh: GreedyMeshData
  scatter: readonly ScatterInstance[]
}>

type Job = Readonly<{
  id: number
  chunk: RenderChunkRequest
  priority: number
  resolve: (data: MeshResult) => void
  reject: (error: Error) => void
}>

export type MeshPool = Readonly<{
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
  let disposed = false
  let worker_error: Error | null = null

  const stop = (error: Error): void => {
    queued.splice(0).forEach(({ reject }) => reject(error))
    active.forEach(({ reject }) => reject(error))
    active.clear()
    workers.forEach((worker) => worker.terminate())
    idle.length = 0
  }
  const report_failure = (error: Error): void => {
    worker_error = error
    stop(error)
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
        report_failure(error instanceof Error ? error : new Error(String(error)))
      }
    }
  }

  workers.forEach((worker) => {
    worker.addEventListener('message', ({ data }: MessageEvent<WorkerReply<MeshResult>>) => {
      const job = active.get(worker)
      if (!job || job.id !== data.id) return
      active.delete(worker)
      idle.push(worker)
      if ('error' in data) job.reject(new Error(data.error))
      else job.resolve(data.result)
      drain()
    })
    worker.addEventListener('error', (event) => report_failure(new Error(event.message)))
    worker.addEventListener('messageerror', () => report_failure(new Error('mesh worker reply could not be decoded')))
  })
  try {
    workers.forEach((worker) => worker.postMessage({ type: 'initialize', world }))
  } catch (error) {
    report_failure(error instanceof Error ? error : new Error(String(error)))
  }

  return Object.freeze({
    mesh: (chunk: RenderChunkRequest, priority: number) =>
      new Promise<MeshResult>((resolve, reject) => {
        if (disposed || worker_error) {
          reject(worker_error ?? new Error('mesh pool is disposed'))
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
    dispose: () => {
      disposed = true
      stop(new Error('mesh pool is disposed'))
    },
  })
}
