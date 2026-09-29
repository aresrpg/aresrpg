// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import source from '../../seed/structures/thebes_gate.recipe.json'
import street from '../../seed/structures/thebes_entry_street.recipe.json'
import workshop from '../../seed/structures/workshop.recipe.json'
import { piece_cells } from '../building_kit.mjs'
import { bake_schematic } from '../bake_schematic.mjs'

test('two buried guardians leave the approach and gate passage clear', () => {
  const statues = source.instances.filter(({ asset }) => asset === 'guardian')
  expect(statues).toHaveLength(2)
  expect(statues.every(({ position, scale, buried }) => position[0] <= -56 && scale === 3 && buried === 0.5)).toBe(true)
  const baked = bake_schematic({ ...workshop.assets, ...source.assets }, source.root)
  expect(baked.blocks.filter(([x, y, z]) => x >= -10 && x <= 12 && Math.abs(z) <= 7 && y >= 0 && y < 12)).toEqual([])
  expect(Math.max(...source.assets.guardian.pieces.map(([, [, y]]) => y))).toBeGreaterThan(50)
})

test('the entrance street bakes attached houses and edge towers without overlapping architecture', () => {
  const buildings = street.assets.entry_street.parts.filter(({ asset }) => asset.startsWith('entry_house_'))
  expect(buildings).toHaveLength(8)
  expect(street.assets.entry_street.connections).toHaveLength(6)
  expect(street.assets.entry_street.parts.filter(({ asset }) => asset === 'edge_tower')).toHaveLength(2)
  const baked = bake_schematic({ ...workshop.assets, ...street.assets }, street.root)
  expect(baked.blocks.length).toBeGreaterThan(15000)
  expect(baked.plants).toHaveLength(0)
  expect(baked.vines).toHaveLength(0)
})

test('watchtower finials contact the roof through every half-block layer', () => {
  const occupied = new Set(street.assets.edge_tower.pieces.flatMap(piece_cells).map(([x, y, z]) => [x, y, z].join(',')))
  for (let y = 102; y < 110; y++) expect(occupied.has([0, y, 0].join(','))).toBe(true)
})
