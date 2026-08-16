// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, test } from 'bun:test'

import {
  character_model_basenames,
  cosmetic_model_of,
  resolve_cosmetic_variant,
} from '../../src/content/character_model_catalog.ts'
import items_source from '../../../../seed/content/items.json'

const glb_node_names = (path: string): readonly string[] => {
  const bytes = readFileSync(path)
  const json_length = bytes.readUInt32LE(12)
  const json = JSON.parse(
    bytes
      .subarray(20, 20 + json_length)
      .toString()
      .replace(/\0+$/u, '')
  ) as Readonly<{
    nodes?: readonly Readonly<{ name?: string }>[]
  }>
  return Object.freeze((json.nodes ?? []).flatMap(({ name }) => (name ? [name.toLowerCase()] : [])))
}

describe('character model catalog', () => {
  test('uses exact legacy rows and the gender-matching Senshi fallback', () => {
    expect(character_model_basenames('senshi', true)).toEqual({
      body: 'senshi_male',
      hair: 'senshi_male_hair',
    })
    expect(character_model_basenames('shugo', false)).toEqual({ body: 'shugo_female' })
    expect(character_model_basenames('yogan', true)).toEqual({
      body: 'senshi_male',
      hair: 'senshi_male_hair',
    })
  })

  test('every declared character asset exists', () => {
    const model_dir = resolve(import.meta.dir, '../../../../seed/models/characters')
    const available = new Set(readdirSync(model_dir).map((name) => name.replace(/\.glb$/i, '')))
    for (const classe of ['senshi', 'shugo', 'tomoda', 'yajin'])
      for (const male of [true, false]) {
        const model = character_model_basenames(classe, male)
        expect(model).not.toBeNull()
        expect(available.has(model!.body)).toBeTrue()
        if (model!.hair) expect(available.has(model!.hair)).toBeTrue()
        const bones = glb_node_names(resolve(model_dir, `${model!.body}.glb`))
        expect(bones.some((name) => name.includes('head'))).toBeTrue()
        expect(bones.some((name) => name.includes('cape'))).toBeTrue()
      }
  })

  test('every selectable hat and cloak resolves to one shipped cosmetic model', () => {
    const model_dir = resolve(import.meta.dir, '../../../../seed/models/cosmetics')
    const available = new Set(readdirSync(model_dir).map((name) => name.replace(/\.glb$/i, '')))
    const worn = items_source.filter(({ category }) => category === 'hat' || category === 'cloak')

    expect(items_source.every((item) => !('appearance' in item))).toBe(true)
    expect(worn.flatMap((item) => (cosmetic_model_of(item, available) ? [] : [item.item_type]))).toEqual([])
  })

  test('derives the authored KHR variant from the item identity', () => {
    expect(resolve_cosmetic_variant('cape_fuwa_black', 'cape_fuwa')).toBe('black')
    expect(resolve_cosmetic_variant('cape_lorito_agility', 'cape_lorito')).toBe('agility')
    expect(resolve_cosmetic_variant('capuche_bara_wisdom', 'capuche_bara')).toBe('moonstone')
    expect(resolve_cosmetic_variant('capuche_bara', 'capuche_bara')).toBe('base')
    expect(resolve_cosmetic_variant('solomonk', 'solomonk')).toBeNull()
  })
})
