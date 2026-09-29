// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { begin_walking_search, advance_walking_search, type WalkingSearch } from './walking_route.ts'
import { walking_edge, type WalkPoint, type WalkWorld } from './walkable.ts'
import { ground_height_below } from './collision.ts'
import type { RunTarget } from './run_to.ts'

type WalkingState = Readonly<{
  search: WalkingSearch | null
  path: readonly WalkPoint[]
  phase_target: WalkPoint | null
  target: RunTarget
  last_position: WalkPoint
  stalled: number
}>
export type WalkingStep = Readonly<{
  state: WalkingState
  status: 'planning' | 'walking' | 'arrived'
  yaw: number
  forward: number
  phase_target: WalkPoint | null
  remaining: number | null
}>

export const begin_walking = (position: WalkPoint, target: RunTarget): WalkingState => ({
  search: null,
  path: [],
  phase_target: null,
  target,
  last_position: position,
  stalled: 0,
})

const distance = (a: WalkPoint, b: WalkPoint): number => Math.hypot(a[0] - b[0], a[2] - b[2])
const idle_step = (state: WalkingState, status: WalkingStep['status'] = 'planning'): WalkingStep => ({
  state,
  status,
  yaw: 0,
  forward: 0,
  phase_target: null,
  remaining: null,
})
const remaining_distance = (position: WalkPoint, path: readonly WalkPoint[], target: RunTarget): number | null => {
  const final = path.at(-1)
  if (!final || Math.hypot(final[0] - target.x, final[2] - target.z) > 0.01) return null
  return path.reduce((sum, point, index) => {
    const from = index ? path[index - 1]! : position
    return sum + Math.hypot(...point.map((value, axis) => value - from[axis]!))
  }, 0)
}

const steer = (state: WalkingState, position: WalkPoint, point: WalkPoint): WalkingStep => ({
  state,
  status: 'walking',
  yaw: Math.atan2(position[0] - point[0], position[2] - point[2]),
  forward: Math.min(1, distance(position, point) / 1.5),
  phase_target: state.phase_target,
  remaining: remaining_distance(position, state.phase_target ? [state.phase_target] : state.path, state.target),
})
const ahead = (position: WalkPoint, target: RunTarget, range: number): WalkPoint => {
  const dx = target.x - position[0],
    dz = target.z - position[2]
  const fraction = Math.min(1, range / Math.max(0.001, Math.hypot(dx, dz)))
  return [position[0] + dx * fraction, position[1], position[2] + dz * fraction]
}
const ready = (world: WalkWorld, position: WalkPoint, point: WalkPoint): boolean =>
  world.ready({
    min_x: Math.min(position[0], point[0]) - 1,
    max_x: Math.max(position[0], point[0]) + 1,
    min_z: Math.min(position[2], point[2]) - 1,
    max_z: Math.max(position[2], point[2]) + 1,
  })

const phase_destination = (world: WalkWorld, position: WalkPoint, point: WalkPoint): WalkPoint => {
  const floor = ground_height_below(world.solid_at, point[0], position[1], point[2])
  return [point[0], world.ground_height(point[0], point[2], floor ?? undefined), point[2]]
}

/** A failed cheap search buys four blocks of direct travel, not another search each frame. */
const phase = (world: WalkWorld, state: WalkingState, position: WalkPoint, target: RunTarget): WalkingStep => {
  const point = state.phase_target ?? ahead(position, target, 4)
  if (!ready(world, position, point)) return idle_step(state)
  const phase_target = state.phase_target ?? phase_destination(world, position, point)
  return steer({ ...state, search: null, path: [], phase_target }, position, phase_target)
}

const plan_walk = (world: WalkWorld, state: WalkingState, position: WalkPoint, target: RunTarget): WalkingStep => {
  const result = advance_walking_search(world, state.search!)
  switch (result.type) {
    case 'blocked':
      return phase(world, state, position, target)
    case 'searching':
    case 'waiting':
      return idle_step({ ...state, search: result.search })
    case 'route':
      return idle_step({ ...state, search: null, path: result.path.slice(1), stalled: 0 })
  }
}

const follow_path = (world: WalkWorld, state: WalkingState, position: WalkPoint): WalkingStep => {
  const first = state.path.findIndex((point) => distance(position, point) > 0.15)
  const path = first < 0 ? [] : state.path.slice(first)
  if (!path.length) return idle_step({ ...state, path })
  const point = path[0]!
  const edge = walking_edge(world, position, point[0], point[2])
  if (edge === undefined) return idle_step(state)
  if (!edge || Math.abs(edge[1] - point[1]) > 0.1) return idle_step({ ...state, path: [] })
  return steer({ ...state, path }, position, point)
}

const advance_walk = (world: WalkWorld, state: WalkingState, position: WalkPoint, target: RunTarget): WalkingStep => {
  const point = ahead(position, target, 1)
  if (!ready(world, position, point)) return idle_step(state)
  if (Math.hypot(position[0] - target.x, position[2] - target.z) <= 0.2) return idle_step(state, 'arrived')
  if (state.stalled > 0.5) return phase(world, state, position, target)
  if (state.search) return plan_walk(world, state, position, target)
  if (state.path.length) return follow_path(world, state, position)
  const edge = walking_edge(world, position, point[0], point[2])
  if (edge === undefined) return idle_step(state)
  if (edge) {
    // Steer at the actual destination: the one-block probe must not throttle long journeys.
    return steer(state, position, [target.x, edge[1], target.z])
  }
  return plan_walk(world, { ...state, search: begin_walking_search(position, target) }, position, target)
}

export const step_walking = (
  world: WalkWorld,
  previous: WalkingState,
  position: WalkPoint,
  target: RunTarget,
  delta_seconds: number
): WalkingStep => {
  // Moving followers keep a useful local detour until their target changes direction materially.
  const changed = Math.hypot(target.x - previous.target.x, target.z - previous.target.z) > 2
  const state = changed ? begin_walking(position, target) : previous
  if (state.phase_target) {
    const remaining = Math.hypot(...position.map((value, index) => value - state.phase_target![index]!))
    return remaining > 0.05 ? phase(world, state, position, target) : idle_step(begin_walking(position, target))
  }
  const moved = distance(position, state.last_position) > 0.05
  const stalled = moved ? 0 : state.stalled + Math.min(delta_seconds, 0.1)
  const next = { ...state, stalled, last_position: moved ? position : state.last_position }
  const result = advance_walk(world, next, position, target)
  // Waiting for collision or a bounded search is not a locomotion stall.
  return result.status === 'planning' ? { ...result, state: { ...result.state, stalled: 0 } } : result
}
