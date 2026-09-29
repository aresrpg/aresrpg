// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import { detail_builder } from '../../packages/engine/src/detail_builder.ts'
import workshop from '../../seed/structures/workshop.recipe.json'
import { bake_schematic } from '../bake_schematic.mjs'
import recipe from '../../seed/scenes/main_menu.recipe.json'
import { author_house, house_footprint } from '../main_menu_buildings.mjs'

test('the foreground inn preserves the canonical workshop architecture instead of rebuilding a generic wing', () => {
  const [source] = recipe.houses
  expect(source.asset).toBe('house_architecture')
  const blocks = new Map()
  author_house(
    { ...source, position: [0, 32, 0], rotation: 0, palette: {} },
    {
      details: detail_builder(),
      glows: [],
      set: (x, y, z, material) => blocks.set(`${x},${y},${z}`, material),
    }
  )
  const expected = bake_schematic(workshop.assets, 'house_architecture', [0, 32, 0]).blocks.filter(([, , , material]) =>
    ['wood', 'stone', 'plaster'].includes(material)
  )
  expect(expected.length).toBeGreaterThan(1000)
  expected.forEach(([x, y, z, material]) => expect(blocks.get(`${x},${y},${z}`)).toBe(material))
})

test('authored houses keep distinct elevations and orientations without cutting into their neighbours', () => {
  const occupied = new Map()
  const intersections = new Set()
  const invalid = []
  expect(new Set(recipe.houses.map((house) => house.rotation)).size).toBe(4)
  for (const house of recipe.houses) {
    const bounds = house_footprint(house)
    author_house(house, {
      glows: [],
      details: detail_builder(),
      set: (x, y, z, material) => {
        const valid = [
          ...[x, y, z].map(Number.isSafeInteger),
          x >= bounds.min_x,
          x <= bounds.max_x,
          z >= bounds.min_z,
          z <= bounds.max_z,
        ]
        if (valid.includes(false)) invalid.push([house.name, x, y, z])
        if (y <= house.position[1] || material === 'air') return
        const key = `${x}:${y}:${z}`
        const previous = occupied.get(key)
        if (previous && previous !== house.name) intersections.add(`${previous} / ${house.name}`)
        occupied.set(key, house.name)
      },
    })
  }
  expect(invalid).toEqual([])
  expect([...intersections]).toEqual([])
})
