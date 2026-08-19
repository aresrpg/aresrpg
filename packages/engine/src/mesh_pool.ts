// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { GreedyMeshData } from './greedy_mesher.ts'
import type { ScatterInstance } from './scatter.ts'
import type { RenderChunkRequest, RenderedChunk } from './types.ts'
import type { WorldRecipe } from './world_recipe.ts'

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

export const create_mesh_pool = (world: WorldRecipe): MeshPool => {
  const count = Math.max(1, Math.min(6, (navigator.hardwareConcurrency || 4) - 2))
  const workers = Array.from(
    { length: count },
    () => new Worker(new URL('./mesh_worker.ts', import.meta.url), { type: 'module' })
  )
  const idle = [...workers]
  workers.forEach((worker) => worker.postMessage({ type: 'initialize', world }))
  const queued: Job[] = []
  const active = new Map<Worker, Job>()
  let next_id = 1
  let disposed = false

  const drain = (): void => {
    while (idle.length > 0 && queued.length > 0) {
      const worker = idle.pop()
      const job = queued.shift()
      if (!worker || !job) return
      active.set(worker, job)
      worker.postMessage({ type: 'mesh', id: job.id, chunk: job.chunk })
    }
  }

  workers.forEach((worker) => {
    worker.addEventListener('message', ({ data }: MessageEvent<Readonly<{ id: number; result: MeshResult }>>) => {
      const job = active.get(worker)
      if (!job || job.id !== data.id) return
      active.delete(worker)
      idle.push(worker)
      job.resolve(data.result)
      drain()
    })
    worker.addEventListener('error', (event) => {
      const job = active.get(worker)
      if (!job) return
      active.delete(worker)
      idle.push(worker)
      job.reject(new Error(event.message))
      drain()
    })
  })

  return Object.freeze({
    mesh: (chunk: RenderChunkRequest, priority: number) =>
      new Promise<MeshResult>((resolve, reject) => {
        if (disposed) {
          reject(new Error('mesh pool is disposed'))
          return
        }
        for (let index = queued.length - 1; index >= 0; index -= 1)
          if (queued[index]?.chunk.key === chunk.key) queued.splice(index, 1)
        queued.push({ id: next_id, chunk, priority, resolve, reject })
        queued.sort((left, right) => left.priority - right.priority)
        next_id += 1
        drain()
      }),
    cancel: (key: string) => {
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
      const error = new Error('mesh pool is disposed')
      queued.splice(0).forEach(({ reject }) => reject(error))
      active.forEach(({ reject }) => reject(error))
      active.clear()
      workers.forEach((worker) => worker.terminate())
      idle.length = 0
    },
  })
}
