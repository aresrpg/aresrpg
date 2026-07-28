// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// PARITY FINGERPRINT (#1536 row 2) — the sim's {x,y} 4-dir BFS and the fight side's encoded-int BFS are ONE
// algorithm, and this test is the tooth that keeps them one. Both claim to mirror `combat_grid::bfs_path_cost`
// (layer-FIFO frontiers, visited-on-enqueue, left/right/up/down neighbour order); the client draws a route with
// one of them and the contract charges MP for the other, so ANY disagreement in cost, route, or reachable set is
// a drawn path that costs a different number of MP than the player was shown.
//
// The comparison is exhaustive per board: every target cell, three MP budgets, deterministic pseudo-random
// blocker layouts (fixed seeds — same boards on every machine, no flake). It must stay green whatever the
// implementations do internally; it is deliberately blind to representation.

import { find_path_4dir, get_reachable_cells } from '@aresrpg/sim/pathfind'
import { describe, expect, test } from 'bun:test'

import { GRID_CELLS, GRID_H, GRID_W, bfsPath, bfsPathCost, bfsReachable, decode, encode } from '../src/los.js'

/** Deterministic 31-bit LCG — the boards must be identical on every machine (no Math.random). */
const lcg = (seed) => {
  let state = seed >>> 0
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff
    return state / 0x80000000
  }
}

/** A pseudo-random blocker layout: `count` distinct encoded cells. */
const blocker_board = (next, count) => {
  const blocked = new Set()
  while (blocked.size < count) blocked.add(Math.floor(next() * GRID_CELLS))
  return blocked
}

/** The sim-side predicates for the SAME board: in-bounds walkable terrain, nobody standing anywhere. */
const sim_terrain = (blocked) => (cell) =>
  cell.x >= 0 && cell.y >= 0 && cell.x < GRID_W && cell.y < GRID_H && !blocked.has(encode(cell.x, cell.y))
const nobody = () => false

const sorted = (cells) => [...cells].sort((a, b) => a - b)

describe('BFS parity — sim find_path_4dir/get_reachable_cells ≡ fight bfsPathCost/bfsPath/bfsReachable', () => {
  test('identical cost, route and reachable set on every board × start × target × MP budget', () => {
    const disagreements = []
    let compared = 0

    for (const seed of [1, 7, 42, 1337]) {
      const next = lcg(seed)
      const blocked = blocker_board(next, 60)
      const is_walkable = sim_terrain(blocked)
      // a start the mover could actually stand on
      let start = Math.floor(next() * GRID_CELLS)
      while (blocked.has(start)) start = (start + 1) % GRID_CELLS

      for (const mp of [3, 6, 12]) {
        const reach_fight = sorted(bfsReachable(start, mp, blocked))
        const reach_sim = sorted(
          get_reachable_cells(decode(start), mp, is_walkable, nobody)
            .filter((r) => r.cost > 0)
            .map((r) => encode(r.cell.x, r.cell.y))
        )
        if (reach_fight.join() !== reach_sim.join())
          disagreements.push({ kind: 'reach', seed, start, mp, fight: reach_fight.length, sim: reach_sim.length })

        for (let target = 0; target < GRID_CELLS; target++) {
          compared++
          const cost_fight = bfsPathCost(start, target, blocked, mp)
          const sim_route = find_path_4dir(decode(start), decode(target), mp, is_walkable, nobody)
          const cost_sim = sim_route ? sim_route.length - 1 : GRID_CELLS
          if (cost_fight !== cost_sim)
            disagreements.push({ kind: 'cost', seed, start, target, mp, fight: cost_fight, sim: cost_sim })

          const route_fight = bfsPath(start, target, blocked, mp).join()
          const route_sim = (sim_route ?? [])
            .slice(1)
            .map((c) => encode(c.x, c.y))
            .join()
          if (route_fight !== route_sim)
            disagreements.push({ kind: 'route', seed, start, target, mp, fight: route_fight, sim: route_sim })
        }
      }
    }

    // The count is the headline: a non-zero here is a class of "the path you were shown is not the path you paid for".
    // `compared` is pinned to a literal, never to itself — a self-compared count is green even when the sweep dies.
    expect({ compared, disagreements: disagreements.slice(0, 8) }).toEqual({
      compared: 4 * 3 * GRID_CELLS,
      disagreements: [],
    })
  })

  test('an unreachable target answers with the SAME sentinel on both sides', () => {
    // a fully walled cell: (5,5) ringed by blockers
    const blocked = new Set([encode(4, 5), encode(6, 5), encode(5, 4), encode(5, 6)])
    const is_walkable = sim_terrain(blocked)
    const start = encode(0, 0)
    const target = encode(5, 5)
    expect(bfsPathCost(start, target, blocked, 40)).toBe(GRID_CELLS)
    expect(find_path_4dir(decode(start), decode(target), 40, is_walkable, nobody)).toBeNull()
    expect(bfsPath(start, target, blocked, 40)).toEqual([])
  })
})
