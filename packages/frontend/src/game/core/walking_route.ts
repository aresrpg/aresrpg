// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

/* eslint-disable functional/immutable-data, fp-law/no-mutating-methods -- each search slice constructs its private scratch collections and heap. */

import { walking_leg } from './walking_leg.ts'
import { walking_edge, type WalkPoint, type WalkWorld } from './walkable.ts'
import { RUN_TO_ARRIVAL_DISTANCE, type RunTarget } from './run_to.ts'

// Bound both retained search data and each frame's work. Long journeys use successive
// collision-checked legs; a distant destination never allocates a world-sized grid.
export const WALKING_SEARCH_LIMIT = 128
const FRAME_EXPANSIONS = 16
const DIRECTIONS = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
] as const

type Node = Readonly<{ point: WalkPoint; cost: number; score: number; parent: Node | null }>
export type WalkingSearch = Readonly<{
  origin: WalkPoint
  open: readonly Node[]
  seen: ReadonlyMap<string, number>
}> &
  ReturnType<typeof walking_leg>
export type WalkingResult =
  | Readonly<{ type: 'searching' | 'waiting'; search: WalkingSearch }>
  | Readonly<{ type: 'route'; path: readonly WalkPoint[] }>
  | Readonly<{ type: 'blocked' }>

const key = (origin: WalkPoint, point: WalkPoint): string =>
  `${Math.round(point[0] - origin[0])}:${Math.round(point[1])}:${Math.round(point[2] - origin[2])}`
const distance = (point: WalkPoint, target: RunTarget): number => Math.hypot(point[0] - target.x, point[2] - target.z)
const priority = (point: WalkPoint, target: RunTarget, cost: number): number => cost + distance(point, target)

// Equal-cost routes prefer further progress instead of flooding the local grid.
const precedes = (a: Node, b: Node): boolean => a.score < b.score || (a.score === b.score && a.cost > b.cost)

export const begin_walking_search = (origin: WalkPoint, target: RunTarget): WalkingSearch => {
  const leg = walking_leg(origin, target)
  return {
    ...leg,
    origin,
    open: [{ point: origin, cost: 0, score: priority(origin, leg.target, 0), parent: null }],
    seen: new Map([[key(origin, origin), 0]]),
  }
}

const route = (node: Node): readonly WalkPoint[] => {
  const points: WalkPoint[] = []
  for (let cursor: Node | null = node; cursor; cursor = cursor.parent) points.push(cursor.point)
  return points.reverse()
}

/** The heap is private construction for one pure search slice. */
const frontier = (nodes: readonly Node[]) => {
  const heap = [...nodes]
  const enqueue = (node: Node): void => {
    let index = heap.length
    heap.push(node)
    while (index > 0) {
      const parent = (index - 1) >> 1
      if (!precedes(node, heap[parent]!)) break
      heap[index] = heap[parent]!
      index = parent
    }
    heap[index] = node
  }

  const dequeue = (): Node | undefined => {
    const first = heap[0]
    const tail = heap.pop()
    if (!heap.length || !tail) return first
    let index = 0
    while (index * 2 + 1 < heap.length) {
      const left = index * 2 + 1
      const right = left + 1
      const child = right < heap.length && precedes(heap[right]!, heap[left]!) ? right : left
      if (!precedes(heap[child]!, tail)) break
      heap[index] = heap[child]!
      index = child
    }
    heap[index] = tail
    return first
  }

  return { enqueue, dequeue, heap }
}

const destination = (world: WalkWorld, search: WalkingSearch, node: Node): WalkPoint | null | undefined => {
  if (search.exit !== null) {
    const coordinate = node.point[search.exit === 'x' ? 0 : 2]
    return Math.abs(coordinate - search.target[search.exit]) < 0.01 ? node.point : null
  }
  if (distance(node.point, search.target) > RUN_TO_ARRIVAL_DISTANCE) return null
  return walking_edge(world, node.point, search.target.x, search.target.z)
}

const inside_leg = ({ bounds }: WalkingSearch, x: number, z: number): boolean =>
  x >= bounds.min_x && x <= bounds.max_x && z >= bounds.min_z && z <= bounds.max_z

export const advance_walking_search = (world: WalkWorld, search: WalkingSearch): WalkingResult => {
  if (search.seen.size >= WALKING_SEARCH_LIMIT) return { type: 'blocked' }
  const open = frontier(search.open)
  const seen = new Map(search.seen)
  for (let iteration = 0; iteration < FRAME_EXPANSIONS; iteration += 1) {
    const node = open.dequeue()
    if (!node) return { type: 'blocked' }
    if (node.cost !== seen.get(key(search.origin, node.point))) continue
    const end = destination(world, search, node)
    if (end === undefined) return { type: 'waiting', search }
    if (end) return { type: 'route', path: [...route(node), end] }
    const neighbors = DIRECTIONS.map(([dx, dz]) => [node.point[0] + dx, node.point[2] + dz] as const)
      .filter(([x, z]) => inside_leg(search, x, z))
      .map(([x, z]) => walking_edge(world, node.point, x, z))
    if (neighbors.includes(undefined)) return { type: 'waiting', search }
    neighbors
      .filter((point): point is WalkPoint => point != null)
      .slice(0, Math.max(0, WALKING_SEARCH_LIMIT - seen.size))
      .forEach((point) => {
        const cost = node.cost + Math.hypot(...point.map((value, index) => value - node.point[index]!))
        if (cost >= (seen.get(key(search.origin, point)) ?? Infinity)) return
        seen.set(key(search.origin, point), cost)
        open.enqueue({ point, cost, score: priority(point, search.target, cost), parent: node })
      })
  }
  return { type: 'searching', search: { ...search, open: open.heap, seen } }
}
