// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import { relief_image_rect, relief_sample_view } from '../../../src/game/hud/map_relief_view.ts'
import { combat_center } from '../../../src/game/hud/combat_alignment.ts'

test('small pans reuse one overscanned terrain sample while its image moves immediately', () => {
  const view = { center_x: 0, center_z: 0, radius: 512 }
  const sampled = relief_sample_view(view)
  const moved = { ...view, center_x: 20, center_z: -12 }
  expect(relief_sample_view(moved)).toEqual(sampled)
  const before = relief_image_rect(view, sampled, 768)
  const after = relief_image_rect(moved, sampled, 768)
  expect(after.x - before.x).toBe(-15)
  expect(after.y - before.y).toBe(9)
  expect(after.x).toBeLessThan(0)
  expect(after.x + after.size).toBeGreaterThan(768)
})
test('terrain sampling stays on a stable lattice across cache boundaries', () => {
  const first = relief_sample_view({ center_x: 120, center_z: 0, radius: 512 })
  const next = relief_sample_view({ center_x: 140, center_z: 0, radius: 512 })
  expect((next.center_x - first.center_x) / ((first.radius * 2) / 192)).toBe(32)
})
test('zoom reprojects the prior completed image instead of clearing it', () => {
  const view = { center_x: 0, center_z: 0, radius: 512 }
  const sampled = relief_sample_view(view)
  const before = relief_image_rect(view, sampled, 768)
  const after = relief_image_rect({ ...view, radius: 1024 }, sampled, 768)
  expect(after.size).toBe(before.size / 2)
  expect(after.x + after.size / 2).toBe(384)
})
test('combat stays centered until chat collides, then shifts only enough to clear it', () => {
  expect(combat_center(1440, 772, 310)).toBe(720)
  expect(combat_center(1440, 772, 450)).toBe(848)
  expect(combat_center(844, 626, 196)).toBe(521)
})
