// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #1536 — combat_grid owns Manhattan distance for both encoded board cells and coordinate objects.

import { describe, expect, test } from 'bun:test'

import { encode, manhattan } from '../src/combat_grid.js'

describe('#1536 Manhattan distance has one home', () => {
  test('the grid owner serves encoded cells and coordinate objects', () => {
    expect(manhattan(encode(1, 2), encode(4, 6))).toBe(7)
    expect(manhattan({ x: -2, y: 1 }, { x: 2, y: -1 })).toBe(6)
  })
})
