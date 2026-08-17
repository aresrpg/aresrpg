// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { simulator_loadout_items } from '../../src/simulator/loadout.ts'

test('the simulator gear picker orders eligible items by level then name', () => {
  const items = simulator_loadout_items('helmet')
  const order = items.map(({ level, name }) => `${String(level).padStart(3, '0')}:${name}`)

  expect(items.length).toBeGreaterThan(1)
  expect(order).toEqual([...order].sort((left, right) => left.localeCompare(right)))
})
