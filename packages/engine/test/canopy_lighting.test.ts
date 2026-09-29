// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import { canopy_light_visibility } from '../src/canopy_lighting.ts'

test('foliage beneath a roof receives no direct sun through the external shadow', () => {
  expect(canopy_light_visibility(0)).toBe(0)
  expect(canopy_light_visibility(1)).toBe(0.5)
  expect(canopy_light_visibility(0.5)).toBe(0.25)
  expect(canopy_light_visibility(-1)).toBe(0)
  expect(canopy_light_visibility(2)).toBe(0.5)
})
