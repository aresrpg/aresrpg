// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import source from '../../seed/structures/thebes_castle.recipe.json'
import workshop from '../../seed/structures/workshop.recipe.json'
import { bake_schematic } from '../bake_schematic.mjs'

// The castle's authored anchor is the existing raised keep datum (188 + 20).
const DATUM = 208

test('the authored castle has supported bridge access, keep stairs and five interior flights', () => {
  const cells = new Set()
  for (const part of source.assets.castle.parts) {
    const assets = { ...workshop.assets, ...source.assets, probe: { kind: 'building', parts: [part] } }
    for (const [x, y, z] of bake_schematic(assets, 'probe').blocks) cells.add([x, y + DATUM, z].join(','))
  }
  const open = (x, y, z) => {
    expect(cells.has([x, y, z].join(',')), `blocked headroom at ${x},${y},${z}`).toBe(false)
    expect(
      source.excavations.some(({ min, max }) => [x, y - DATUM, z].every((v, axis) => v >= min[axis] && v <= max[axis]))
    ).toBe(true)
  }
  const approach = Array.from({ length: 9 }, (_, i) => [0, 187, -72 + i])
  const stairs = Array.from({ length: 31 }, (_, step) => [0, 187 + Math.min(26, step), -52 + step])
  const landing = Array.from({ length: 8 }, (_, i) => [0, 213, -22 + i])
  const flights = Array.from({ length: 5 }, (_, flight) =>
    Array.from({ length: 10 }, (_, i) => {
      const step = i + 1
      return [flight % 2 === 0 ? -15 + step : -3 - step, 213 + flight * 12 + step, flight % 2 === 0 ? 15 : 20]
    })
  ).flat()
  const tower_stairs = [
    [-64, -62],
    [64, -62],
    [-64, 65],
    [64, 65],
  ].flatMap(([cx, cz]) =>
    Array.from({ length: 20 }, (_, step) => [
      cx + Math.sign(cx) * (-8 + Math.min(16, step)),
      188 + step,
      cz - 8 + Math.max(0, step - 16),
    ])
  )
  for (const [x, floor, z] of [...approach, ...stairs, ...landing, ...flights, ...tower_stairs]) {
    expect(cells.has([x, floor, z].join(','))).toBe(true)
    open(x, floor + 2, z)
    open(x, floor + 4, z)
  }
  expect(cells.size).toBeGreaterThan(250000)
  expect([...cells].some((key) => Number(key.split(',')[1]) >= 330)).toBe(true)
}, 60000)
