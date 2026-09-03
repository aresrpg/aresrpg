// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { expect, test } from 'bun:test'

import items_source from '../../../../seed/content/items.json'

const seed = (...parts: readonly string[]) => resolve(import.meta.dir, '../../../../seed', ...parts)

const png_dimensions = (path: string): Readonly<{ width: number; height: number }> => {
  const bytes = readFileSync(path)
  return Object.freeze({ width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) })
}

type GlbJson = Readonly<{
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

test('every authored pet owns its model and canonical icon pair', () => {
  const pets = items_source.filter(({ category }) => category === 'pet')

  for (const { item_type } of pets) {
    expect(
      glb_animations(seed('models/pets', `${item_type}.glb`)).some((name) => name.toUpperCase().includes('IDLE'))
    ).toBeTrue()
    expect(png_dimensions(seed('icons/items', `${item_type}_hd.png`))).toEqual({ width: 512, height: 512 })
    expect(png_dimensions(seed('icons/items', `${item_type}.png`))).toEqual({ width: 64, height: 64 })
  }
})

test('Suicune keeps baked vertex shading instead of a flat palette-only material', () => {
  const attributes = glb_json(seed('models/pets/suicune.glb')).meshes?.flatMap(({ primitives }) =>
    primitives.map(({ attributes: row }) => row)
  )

  expect(attributes?.every((row) => 'COLOR_0' in row)).toBeTrue()
})
