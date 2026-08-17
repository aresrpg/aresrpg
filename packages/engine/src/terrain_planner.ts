// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { WorldRecipe } from './world_recipe.ts'

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
  const start = (request: PlannerRequest): void => {
    active = request
    worker.postMessage({ type: 'plan', id: request.id, columns: request.columns })
  }
  worker.postMessage({ type: 'initialize', world })
  worker.addEventListener(
    'message',
    ({ data }: MessageEvent<Readonly<{ id: number; plans: readonly TerrainColumnPlan[] }>>) => {
      const request = active
      if (!request || request.id !== data.id) return
      active = null
      request.resolve(data.plans)
      const next = queued
      queued = null
      if (next) start(next)
    }
  )
  worker.addEventListener('error', (event) => {
    worker_error = new Error(event.message)
    active?.reject(worker_error)
    queued?.reject(worker_error)
    active = null
    queued = null
  })
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
