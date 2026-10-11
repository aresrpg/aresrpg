// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { readFileSync, readdirSync } from 'node:fs'

import { expect, test } from 'bun:test'

const model_dir = new URL('../../../seed/models/mobs/', import.meta.url)
const read_model = (name: string) => {
  const bytes = readFileSync(new URL(name, model_dir))
  return JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString()) as {
    accessors: readonly { min?: readonly number[]; max?: readonly number[] }[]
    animations?: readonly { name: string; samplers: readonly { input: number }[] }[]
    meshes: readonly { primitives: readonly unknown[] }[]
    extensions?: { KHR_materials_variants?: { variants: readonly { name: string }[] } }
  }
}

test('every authored death animation lasts exactly one second', () => {
  const root = new URL('../../../seed/models/', import.meta.url)
  const files = readdirSync(root, { recursive: true, encoding: 'utf8' }).filter((file) => file.endsWith('.glb'))
  for (const name of files) {
    const model = read_model(`../${name}`)
    const deaths = model.animations?.filter(({ name }) => /^(death|die|ko)(_|$)/i.test(name)) ?? []
    for (const clip of deaths) {
      const starts = clip.samplers.map(({ input }) => model.accessors[input]?.min?.[0])
      const ends = clip.samplers.map(({ input }) => model.accessors[input]?.max?.[0])
      expect(
        [...starts, ...ends].every((value) => value !== undefined && Number.isFinite(value)),
        name
      ).toBeTrue()
      const duration = Math.max(...(ends as number[])) - Math.min(...(starts as number[]))
      expect(duration, `${name}: ${clip.name}`).toBeCloseTo(1, 5)
    }
  }
})

test('protector skins retain three geometries rather than one mesh file per resource', () => {
  const files = readdirSync(model_dir)
    .filter((name) => name.startsWith('protector_'))
    .sort()
  expect(files).toEqual(['protector_bricheton.glb', 'protector_gaia.glb', 'protector_miner.glb'])
  for (const file of files) {
    const model = read_model(file)
    expect(model.meshes).toHaveLength(1)
    expect(model.meshes[0]?.primitives).toHaveLength(1)
    const variants = model.extensions?.KHR_materials_variants?.variants ?? []
    expect(variants.length).toBeGreaterThan(1)
    expect(new Set(variants.map(({ name }) => name)).size).toBe(variants.length)
  }
})
