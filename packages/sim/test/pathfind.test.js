// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, test, expect } from 'bun:test'

import {
  find_path_4dir,
  find_path_8dir,
  get_reachable_cells,
} from '../src/pathfind.js'
import { cell_key } from '../src/cell.js'
import { manhattan } from '../src/combat_grid.js'

const open = () => true
const unoccupied = () => false
const blocked =
  (...keys) =>
  ({ x, y }) =>
    !new Set(keys).has(`${x},${y}`)

describe('find_path_4dir', () => {
  test('straight line on open grid', () => {
    const path = find_path_4dir(
      { x: 0, y: 0 },
      { x: 3, y: 0 },
      5,
      open,
      unoccupied,
    )
    expect(path).not.toBeNull()
    expect(path).toHaveLength(4)
    expect(path[0]).toEqual({ x: 0, y: 0 })
    expect(path[path.length - 1]).toEqual({ x: 3, y: 0 })
  })

  test('path to self is just the start', () => {
    expect(
      find_path_4dir({ x: 2, y: 2 }, { x: 2, y: 2 }, 5, open, unoccupied),
    ).toEqual([{ x: 2, y: 2 }])
  })

  test('rejects path exceeding max_mp', () => {
    expect(
      find_path_4dir({ x: 0, y: 0 }, { x: 3, y: 0 }, 2, open, unoccupied),
    ).toBeNull()
  })

  test('accepts path at exact budget', () => {
    expect(
      find_path_4dir({ x: 0, y: 0 }, { x: 3, y: 0 }, 3, open, unoccupied),
    ).toHaveLength(4)
  })

  test('detours around an obstacle', () => {
    const path = find_path_4dir(
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      6,
      blocked('1,0'),
      unoccupied,
    )
    expect(path).not.toBeNull()
    expect(path.some(c => c.x === 1 && c.y === 0)).toBe(false)
    expect(path[path.length - 1]).toEqual({ x: 2, y: 0 })
  })

  test('null when goal is walled off', () => {
    const walls = blocked('1,0', '3,0', '2,1', '2,-1')
    expect(
      find_path_4dir({ x: 0, y: 0 }, { x: 2, y: 0 }, 20, walls, unoccupied),
    ).toBeNull()
  })

  test('null when goal itself is unwalkable', () => {
    expect(
      find_path_4dir(
        { x: 0, y: 0 },
        { x: 2, y: 0 },
        20,
        blocked('2,0'),
        unoccupied,
      ),
    ).toBeNull()
  })

  test('deterministic: same inputs -> identical path', () => {
    const a = find_path_4dir(
      { x: 0, y: 0 },
      { x: 4, y: 3 },
      20,
      blocked('2,1', '2,2'),
      unoccupied,
    )
    const b = find_path_4dir(
      { x: 0, y: 0 },
      { x: 4, y: 3 },
      20,
      blocked('2,1', '2,2'),
      unoccupied,
    )
    expect(a).toEqual(b)
  })
})

describe('get_reachable_cells', () => {
  test('open grid mp=2 reaches the manhattan diamond (13 cells)', () => {
    const reachable = get_reachable_cells({ x: 0, y: 0 }, 2, open, unoccupied)
    expect(reachable).toHaveLength(13)
    for (const { cell, cost } of reachable) {
      expect(cost).toBe(manhattan({ x: 0, y: 0 }, cell))
    }
  })

  test('includes the start at cost 0', () => {
    const reachable = get_reachable_cells({ x: 5, y: 5 }, 3, open, unoccupied)
    expect(reachable[0]).toEqual({ cell: { x: 5, y: 5 }, cost: 0 })
  })

  test('obstacles reduce the reachable set', () => {
    const walls = blocked('1,0', '0,1', '-1,0', '0,-1')
    const reachable = get_reachable_cells({ x: 0, y: 0 }, 3, walls, unoccupied)
    expect(reachable).toHaveLength(1) // fully boxed in
  })

  test('deterministic: same inputs -> identical set', () => {
    const keys = m => m.map(({ cell }) => cell_key(cell.x, cell.y)).sort()
    const a = get_reachable_cells(
      { x: 0, y: 0 },
      4,
      blocked('1,1', '2,0'),
      unoccupied,
    )
    const b = get_reachable_cells(
      { x: 0, y: 0 },
      4,
      blocked('1,1', '2,0'),
      unoccupied,
    )
    expect(keys(a)).toEqual(keys(b))
  })
})

describe('find_path_8dir (roam, diagonals)', () => {
  test('takes the diagonal on an open grid (one step per cell)', () => {
    const path = find_path_8dir({ x: 0, y: 0 }, { x: 4, y: 4 }, open)
    expect(path).not.toBeNull()
    // pure diagonal -> 5 cells (start..goal), not the 9 a 4-dir walk would need
    expect(path).toHaveLength(5)
    expect(path?.[0]).toEqual({ x: 0, y: 0 })
    expect(path?.at(-1)).toEqual({ x: 4, y: 4 })
  })

  test('routes around an obstacle wall', () => {
    // vertical wall x=2 for y in -1..1, gap above
    const wall = blocked('2,-1', '2,0', '2,1')
    const path = find_path_8dir({ x: 0, y: 0 }, { x: 4, y: 0 }, wall)
    expect(path).not.toBeNull()
    for (const c of path ?? []) expect(wall(c)).toBe(true) // never steps on the wall
  })

  test('refuses to cut a corner between two diagonal obstacles', () => {
    // block both orthogonals of the NE diagonal from origin -> the direct (0,0)->(1,1)
    // diagonal is forbidden. (1,1) is still reachable the long way around, so the path
    // must exist but NOT be the 2-cell corner-cut.
    const corner = blocked('1,0', '0,1')
    const path = find_path_8dir({ x: 0, y: 0 }, { x: 1, y: 1 }, corner)
    expect(path).not.toBeNull()
    expect(path.length).toBeGreaterThan(2) // routed around, never cut the corner
    // and it never used the forbidden direct diagonal as consecutive steps
    const took_cut = (path ?? []).some(
      (c, i) =>
        i > 0 &&
        path[i - 1].x === 0 &&
        path[i - 1].y === 0 &&
        c.x === 1 &&
        c.y === 1,
    )
    expect(took_cut).toBe(false)
  })

  test('returns null for a walled-off goal', () => {
    const boxed = blocked('4,4', '6,4', '5,3', '5,5') // goal 5,4 fully enclosed
    expect(find_path_8dir({ x: 0, y: 0 }, { x: 5, y: 4 }, boxed)).toBeNull()
  })

  test('is deterministic', () => {
    const w = blocked('2,1', '2,2', '3,2')
    const a = find_path_8dir({ x: 0, y: 0 }, { x: 5, y: 3 }, w)
    const b = find_path_8dir({ x: 0, y: 0 }, { x: 5, y: 3 }, w)
    expect(a).toEqual(b)
  })
})
