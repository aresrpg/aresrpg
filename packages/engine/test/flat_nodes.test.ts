// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { flat_burn_field } from '../src/flat_nodes.ts'

test('the flat transition field is continuous in world space', () => {
  const sample = flat_burn_field(73.25, -41.5)
  const adjacent = flat_burn_field(73.26, -41.5)

  expect(Math.abs(adjacent - sample)).toBeLessThan(0.01)
  expect(flat_burn_field(180, 90)).not.toBeCloseTo(sample, 3)
})
