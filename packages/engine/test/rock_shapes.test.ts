// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import { rock_pebbles } from '../src/nature/rock_pebbles.ts'
import { mulberry } from '../src/nature/sprite_kit.ts'

test('pebbles use sloped irregular facets rather than stacked axis-aligned boxes', () => {
  const vertices = rock_pebbles(mulberry(42))
  let diagonal = 0
  for (let i = 0; i < vertices.length; i += 3) {
    const a = vertices[i]!,
      b = vertices[i + 1]!,
      c = vertices[i + 2]!
    const nx = (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1])
    const nz = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
    if (Math.abs(nx * nz) > 1e-9) diagonal++
  }
  expect(diagonal).toBeGreaterThan(vertices.length / 6)
  expect(vertices.length / 3).toBeLessThanOrEqual(72)
  expect(vertices.every((v) => v.length === 7 && v[4] === 0 && v[6]! <= 0.25)).toBe(true)
})
