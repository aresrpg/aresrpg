// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { expect, test } from 'bun:test'
import { item_stat_center } from '@aresrpg/immutable'

import items_source from '../../../../seed/content/items.json'
import { item_stat_offset } from '../../src/game/character_stats.ts'

const seed = (...parts: readonly string[]) => resolve(import.meta.dir, '../../../../seed', ...parts)

const png_dimensions = (path: string): Readonly<{ width: number; height: number }> => {
  const bytes = readFileSync(path)
  return Object.freeze({ width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) })
}

type GlbJson = Readonly<{
  nodes?: readonly Readonly<{ name?: string; children?: readonly number[] }>[]
  skins?: readonly Readonly<{ joints: readonly number[] }>[]
  animations?: readonly Readonly<{ name?: string }>[]
  meshes?: readonly Readonly<{
    primitives: readonly Readonly<{ attributes: Readonly<Record<string, number>> }>[]
  }>[]
}>

const glb_json = (path: string): GlbJson => {
  const bytes = readFileSync(path)
  const json_length = bytes.readUInt32LE(12)
  return JSON.parse(
    bytes
      .subarray(20, 20 + json_length)
      .toString()
      .replace(/\0+$/u, '')
  ) as GlbJson
}

const glb_animations = (path: string): readonly string[] =>
  Object.freeze((glb_json(path).animations ?? []).flatMap(({ name }) => (name ? [name] : [])))

test('Pampkin grows to exactly 40 wisdom and 60 vitality through ordinary feeding', () => {
  const pet = items_source.find(({ item_type }) => item_type === 'pampkin')!
  expect(pet.pet_movement).toBe('fly')
  expect(pet.pet_foods).toEqual(['bloodnight_pet_food'])
  expect(pet.stats!.min).toEqual(pet.stats!.max)
  for (const [stat, endpoint] of [
    ['wisdom', 40],
    ['vitality', 60],
  ] as const) {
    expect(pet.stats!.max[stat]).toBe(endpoint)
    const stats = { [stat]: item_stat_center + pet.stats!.max[stat] }
    for (const pet_power of [0, 30, 60]) {
      expect(item_stat_offset({ category: 'pet', stats, pet_power }, stat)).toBe((endpoint * pet_power) / 60)
    }
  }
})

test('every authored pet owns its model and canonical icon pair', () => {
  const pets = items_source.filter(({ category }) => category === 'pet')

  for (const { item_type } of pets) {
    const model = glb_json(seed('models/pets', `${item_type}.glb`))
    const nodes = model.nodes ?? []
    const mounts = nodes.flatMap((node, index) => (node.name === 'Mount' ? [index] : []))
    expect(mounts, `${item_type}: one authored mount socket`).toHaveLength(1)
    const parent = nodes.findIndex((node) => node.children?.includes(mounts[0]!))
    expect(
      model.skins?.some(({ joints }) => joints.includes(parent)),
      `${item_type}: socket follows the rig`
    ).toBeTrue()
    expect(
      glb_animations(seed('models/pets', `${item_type}.glb`)).some((name) => name.toUpperCase().includes('IDLE'))
    ).toBeTrue()
    expect(png_dimensions(seed('icons/items', `${item_type}_hd.png`))).toEqual({ width: 512, height: 512 })
    expect(png_dimensions(seed('icons/items', `${item_type}.png`))).toEqual({ width: 64, height: 64 })
  }
})
