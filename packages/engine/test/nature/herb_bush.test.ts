// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import { herb_bush } from '../../src/nature/herb_bush.ts'
import { mulberry } from '../../src/nature/sprite_kit.ts'

test('bush geometry reaches its grounded origin instead of hovering above the placement', () => {
  for (const seed of [0, 1, 17, 99]) {
    const vertices = herb_bush(mulberry(seed))
    expect(Math.min(...vertices.map((vertex) => vertex[1]))).toBe(0)
    expect(vertices.some(([x, y, z, , sway]) => x === 0 && y === 0 && z === 0 && sway === 0)).toBe(true)
  }
})
