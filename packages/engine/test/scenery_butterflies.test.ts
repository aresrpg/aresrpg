// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import { scenery_butterflies, BUTTERFLY_BUDGET } from '../src/scenery_butterflies.ts'
import { validate_scenery } from '../src/scenery_data.ts'

test('butterflies are one bounded wing batch with a GPU motion graph, absent without authored volumes', () => {
  expect(scenery_butterflies([])).toBeNull()
  const mesh = scenery_butterflies([{ center: [0, 73, 0], size: [38, 4, 26] }])!
  expect(mesh.geometry.instanceCount).toBe(BUTTERFLY_BUDGET.high)
  expect(mesh.geometry.getAttribute('position').count).toBeGreaterThan(4)
  expect(mesh.material.transparent).toBe(false)
  expect(mesh.material.positionNode).not.toBeNull()
  expect(mesh.geometry.boundingBox!.max.x).toBeLessThan(28)
  mesh.geometry.dispose()
  mesh.material.dispose()
})
test('oversized butterfly volumes are rejected at the existing scenery boundary', () => {
  expect(
    validate_scenery({
      waterfalls: [],
      spores: [],
      vines: [],
      butterflies: [{ center: [0, 73, 0], size: [200, 4, 20] }],
    })
  ).toContain('scenery.butterflies must contain at most 4 bounded placements')
})
