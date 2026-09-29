// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import recipe from '../../seed/structures/workshop.recipe.json'
import family from '../../seed/structures/townhouse.family.json'
import { plan_neighborhood, compile_neighborhood } from '../compile_neighborhood.mjs'
import { build_townhouse } from '../townhouse.mjs'
import { validate_module, validate_connections } from '../module_connections.mjs'
import { bake_schematic } from '../bake_schematic.mjs'

const variant = { ...family.variants[0], bays: 2, sides: ['party', 'party'] }

test('all family proportions preserve sealed walls and ground-level entrances', () => {
  for (const bays of [2, 3, 4])
    for (const choice of family.variants) {
      const house = build_townhouse({ ...choice, bays, sides: ['party', 'party'] })
      expect(() => validate_module(house)).not.toThrow()
      expect(house.pieces.every(([shape]) => ['block', 'slab', 'stair'].includes(shape))).toBe(true)
    }
})

test('a missing party-wall cell and a blocked entrance are rejected before meshing', () => {
  const house = build_townhouse(variant)
  const gap = { ...house, pieces: house.pieces.filter(([, [x, y, z]]) => !(x === 0 && y === 2 && z === 8)) }
  expect(() => validate_module(gap)).toThrow('Unsealed')
  const [x, , z] = house.module.clearances[0].min
  const blocked = { ...house, pieces: [...house.pieces, ['block', [x, 0, z], 'stone', 0, 'bottom']] }
  expect(() => validate_module(blocked)).toThrow('Blocked')
})

test('100 seeds retain continuous streets, constrained roof rhythms and varied heights', () => {
  const signatures = new Set()
  const heights = new Set()
  for (let seed = 0; seed < 100; seed++) {
    const { choices, edges } = plan_neighborhood({ ...recipe.neighborhood, seed })
    signatures.add(JSON.stringify(choices))
    choices.forEach(({ floors }) => heights.add(floors))
    edges.forEach(([a, b]) => {
      expect(choices[a].roof).not.toBe(choices[b].roof)
      expect(choices[a].cover).not.toBe(choices[b].cover)
      expect(Math.abs(choices[a].floors - choices[b].floors)).toBeLessThanOrEqual(1)
    })
  }
  expect(signatures.size).toBeGreaterThan(90)
  expect([...heights].sort()).toEqual([2, 3])
})

test('compiled rows meet physically and the whole composition has no overlapping pieces', () => {
  const assets = compile_neighborhood(recipe)
  for (const row of [assets.street_0, assets.street_1]) {
    expect(() => validate_connections(assets, row)).not.toThrow()
    row.parts.slice(1).forEach((part, i) => {
      const previous = row.parts[i]
      expect(part.position[0]).toBe(previous.position[0] + assets[previous.asset].module.size[0])
    })
  }
  expect(() => bake_schematic(assets, 'demo_city')).not.toThrow()
})

test('a neighbouring placement cannot block an entrance, including rotated houses', () => {
  const house = build_townhouse(variant)
  const [x] = house.module.clearances[0].min
  const obstruction = { kind: 'building', pieces: [['block', [-1, 0, x], 'stone', 0, 'bottom']] }
  const assets = {
    ...recipe.assets,
    house,
    obstruction,
    assembly: {
      kind: 'building',
      parts: [
        { asset: 'house', position: [0, 0, 0], rotation: 1 },
        { asset: 'obstruction', position: [0, 0, 0], rotation: 0 },
      ],
    },
  }
  expect(() => bake_schematic(assets, 'assembly')).toThrow('Blocked assembled clearance')
})
