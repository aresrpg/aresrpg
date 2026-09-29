// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import { PointLight, Scene } from 'three'

import { create_scenery_lights } from '../src/scenery_lights.ts'
import { validate_scenery } from '../src/scenery_data.ts'
import { reflection_scale } from '../src/water_reflection.ts'
import { hanging_ice } from '../src/nature/hanging_ice.ts'
import { mulberry } from '../src/nature/sprite_kit.ts'

const glow = { center: [0, 5, 0], color: [2, 1, 0.2], size: 2, range: 24 } as const
const base = { waterfalls: [], spores: [], vines: [] }
test('winter light and plant authoring stays within finite resource budgets', () => {
  expect(validate_scenery({ ...base, glows: Array(5).fill(glow) })).toContain(
    'scenery supports at most four local lights'
  )
  expect(validate_scenery({ ...base, glows: [{ ...glow, range: 0 }] }).length).toBeGreaterThan(0)
  expect(
    validate_scenery({
      ...base,
      plants: Array(513).fill({ kind: 'fern', center: [0, 0, 0], color: [1, 1, 1], accent: [1, 1, 1], scale: 1 }),
    }).length
  ).toBeGreaterThan(0)
  const scene = new Scene()
  const lamps = create_scenery_lights(scene, Array(4).fill(glow))
  lamps.set_visible(true)
  lamps.set_quality('low')
  expect(scene.children.filter((light) => light.visible)).toHaveLength(1)
  lamps.set_quality('high')
  expect(scene.children.filter((light) => light.visible)).toHaveLength(4)
  expect(scene.children.every((light) => light instanceof PointLight && !light.castShadow)).toBe(true)
  lamps.dispose()
  expect(scene.children).toHaveLength(0)
})
test('planar targets stay capped and every quality retains the same reflection path', () => {
  expect(reflection_scale('low', 3840, 2160)).toBe(0.125)
  expect(reflection_scale('high', 3840, 2160) * 3840).toBe(1024)
  expect(reflection_scale('medium', 1920, 1080)).toBe(0.25)
})
test('hanging ice is tapered crossed sprite geometry below its attachment, with no wind sway', () => {
  const vertices = hanging_ice(mulberry(1))
  expect(vertices.length).toBeGreaterThan(0)
  expect(vertices.every((vertex) => vertex[1] <= 0 && vertex[4] === 0)).toBe(true)
  expect(Math.min(...vertices.map((vertex) => vertex[1]))).toBeLessThan(-2)
})
