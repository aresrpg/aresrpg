// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import source from '../../seed/structures/thebes_castle_ward.recipe.json'
import workshop from '../../seed/structures/workshop.recipe.json'
import { bake_schematic } from '../bake_schematic.mjs'

test('the lower ward has varied homes on the hillside and a supported castle-side passage', () => {
  const homes = source.assets.ward.parts.filter(({ asset }) => asset.startsWith('ward_home_'))
  expect(homes).toHaveLength(25)
  expect(new Set(homes.map(({ asset }) => asset)).size).toBeGreaterThan(12)
  expect(new Set(homes.map(({ position }) => position[1])).size).toBeGreaterThan(8)
  expect(
    Math.max(...homes.map(({ position }) => position[1])) - Math.min(...homes.map(({ position }) => position[1]))
  ).toBeGreaterThan(40)
  expect(source.assets.ward.parts.filter(({ asset }) => asset === 'house_architecture')).toHaveLength(1)
  const blocks = new Set()
  for (const part of source.assets.ward.parts) {
    const assets = { ...workshop.assets, ...source.assets, probe: { kind: 'building', parts: [part] } }
    for (const [x, y, z] of bake_schematic(assets, 'probe').blocks) blocks.add([x, y + 132, z].join(','))
  }
  for (let x = -42; x <= -12; x++) {
    const y = Math.round(188 - ((x + 42) * 8) / 30)
    expect(blocks.has([x, y - 1, 204].join(','))).toBe(true)
    expect(blocks.has([x, y + 2, 204].join(','))).toBe(false)
  }
}, 60000)
