// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { readFileSync } from 'node:fs'

import { expect, test } from 'bun:test'

import { simulator_loadout_items } from '../../src/simulator/loadout.ts'

test('the simulator gear picker orders eligible items by level then name', () => {
  const items = simulator_loadout_items('tool')
  const order = items.map(({ level, name }) => `${String(level).padStart(3, '0')}:${name}`)

  expect(items.length).toBeGreaterThan(1)
  expect(order).toEqual([...order].sort((left, right) => left.localeCompare(right)))
})

test('the fight lab equipment selector owns readable fixed-size slots', () => {
  const component = readFileSync(new URL('../../src/simulator/LoadoutSection.tsx', import.meta.url), 'utf8')
  const css = readFileSync(new URL('../../src/components/character_surfaces.css', import.meta.url), 'utf8')

  expect(component).toContain('data-fight-lab-equipment=""')
  expect(css).toContain('[data-fight-lab-equipment] .inv__slot')
  expect(css).toContain('width: 64px')
  expect(css).toContain('height: 64px')
})
