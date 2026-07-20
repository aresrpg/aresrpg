// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, test, expect } from 'bun:test'

import {
  cell_key,
  manhattan_distance,
  chebyshev_distance,
  neighbors_4dir,
} from '../src/cell.js'

describe('cell', () => {
  test('cell_key is stable and distinct', () => {
    expect(cell_key(1, 2)).toBe('1,2')
    expect(cell_key(-3, 0)).toBe('-3,0')
    expect(cell_key(1, 2)).not.toBe(cell_key(2, 1))
  })

  test('manhattan distance', () => {
    expect(manhattan_distance({ x: 0, y: 0 }, { x: 0, y: 0 })).toBe(0)
    expect(manhattan_distance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(7)
    expect(manhattan_distance({ x: -2, y: 1 }, { x: 2, y: -1 })).toBe(6)
  })

  test('chebyshev distance', () => {
    expect(chebyshev_distance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(4)
    expect(chebyshev_distance({ x: 0, y: 0 }, { x: 5, y: 2 })).toBe(5)
  })

  test('neighbors_4dir returns the four cardinals', () => {
    expect(neighbors_4dir({ x: 0, y: 0 })).toEqual([
      { x: 0, y: -1 },
      { x: -1, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
    ])
  })
})
