// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { WorldRecipe } from './world_recipe.ts'
import type { WorkerReply } from './worker_reply.ts'

export type TerrainColumnCoordinate = Readonly<{ x: number; z: number }>
export type TerrainColumnPlan = TerrainColumnCoordinate & Readonly<{ layers: readonly number[] }>
export type TerrainPlanner = Readonly<{
  plan: (columns: readonly TerrainColumnCoordinate[]) => Promise<readonly TerrainColumnPlan[]>
  dispose: () => void
}>

type PlannerRequest = Readonly<{
  id: number
  columns: readonly TerrainColumnCoordinate[]
  resolve: (plans: readonly TerrainColumnPlan[]) => void
  reject: (error: Error) => void
}>
type PlannerWorker = Pick<Worker, 'addEventListener' | 'postMessage' | 'terminate'>

export const create_terrain_planner = (
  world: WorldRecipe,
  worker_factory: () => PlannerWorker = () =>
    new Worker(new URL('./terrain_plan_worker.ts', import.meta.url), { type: 'module' })
): TerrainPlanner => {
  const worker = worker_factory()
  let next_id = 1
  let active: PlannerRequest | null = null
  let queued: PlannerRequest | null = null
  let disposed = false
  let worker_error: Error | null = null
  const report_failure = (error: Error): void => {
    worker_error = error
    active?.reject(error)
    queued?.reject(error)
    active = null
    queued = null
    worker.terminate()
  }
  const start = (request: PlannerRequest): void => {
    active = request
    try {
      worker.postMessage({ type: 'plan', id: request.id, columns: request.columns })
    } catch (error) {
      report_failure(error instanceof Error ? error : new Error(String(error)))
    }
  }
  worker.addEventListener('message', ({ data }: MessageEvent<WorkerReply<readonly TerrainColumnPlan[]>>) => {
    const request = active
    if (!request || request.id !== data.id) return
    active = null
    if ('error' in data) request.reject(new Error(data.error))
    else request.resolve(data.result)
    const next = queued
    queued = null
    if (next) start(next)
  })
  worker.addEventListener('error', (event) => report_failure(new Error(event.message)))
  worker.addEventListener('messageerror', () => report_failure(new Error('terrain planner reply could not be decoded')))
  try {
    worker.postMessage({ type: 'initialize', world })
  } catch (error) {
    report_failure(error instanceof Error ? error : new Error(String(error)))
  }
  return Object.freeze({
    plan: (columns) => {
      if (disposed) return Promise.reject(new Error('terrain planner is disposed'))
      if (worker_error) return Promise.reject(worker_error)
      if (columns.length === 0) return Promise.resolve([])
      const id = next_id
      next_id += 1
      return new Promise((resolve, reject) => {
        const request = Object.freeze({ id, columns, resolve, reject })
        if (!active) {
          start(request)
          return
        }
        queued?.reject(new Error('terrain plan was superseded by a newer focus'))
        queued = request
      })
    },
    dispose: () => {
      if (disposed) return
      disposed = true
      worker.terminate()
      const error = new Error('terrain planner is disposed')
      active?.reject(error)
      queued?.reject(error)
      active = null
      queued = null
    },
  })
}
