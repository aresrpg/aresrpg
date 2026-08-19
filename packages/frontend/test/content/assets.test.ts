// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, test } from 'bun:test'

import { indexed_asset_key, spell_asset_key } from '../../src/content/asset_keys.ts'
import { content_catalog } from '../../src/content/catalog.ts'
import {
  character_model_basenames,
  cosmetic_model_of,
  resolve_cosmetic_variant,
} from '../../src/content/character_model_catalog.ts'
import { worn_cosmetic_options } from '../../src/content/worn_cosmetics.ts'
import { world_terrain, worlds_source } from '../../src/content/worlds.ts'
import airdrop_source from '../../../../seed/content/airdrop.json'
import items_source from '../../../../seed/content/items.json'
import mobs_source from '../../../../seed/content/mobs.json'

const seed = (...parts: readonly string[]) => resolve(import.meta.dir, '../../../../seed', ...parts)

const basenames = (directory: string, extension: string): ReadonlySet<string> =>
  new Set(
    readdirSync(directory)
      .filter((name) => name.toLowerCase().endsWith(extension))
      .map((name) => name.slice(0, -extension.length))
  )

/// The node names declared inside a .glb's embedded glTF JSON chunk.
const glb_nodes = (path: string): readonly string[] => {
  const bytes = readFileSync(path)
  const json_length = bytes.readUInt32LE(12)
  const json = JSON.parse(
    bytes
      .subarray(20, 20 + json_length)
      .toString()
      .replace(/\0+$/u, '')
  ) as Readonly<{ nodes?: readonly Readonly<{ name?: string }>[] }>
  return Object.freeze((json.nodes ?? []).flatMap(({ name }) => (name ? [name] : [])))
}

const png_dimensions = (path: string): Readonly<{ width: number; height: number }> => {
  const bytes = readFileSync(path)
  expect(bytes.subarray(1, 4).toString()).toBe('PNG')
  return Object.freeze({ width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) })
}

describe('shipped content assets', () => {
  test('every declared model exists on disk with the nodes its renderer expects', () => {
    // Characters: one body (plus optional hair) per class and gender, rigged.
    const character_dir = seed('models/characters')
    const characters = basenames(character_dir, '.glb')
    for (const classe of ['senshi', 'shugo', 'tomoda', 'yajin'])
      for (const male of [true, false]) {
        const model = character_model_basenames(classe, male)
        expect(model).not.toBeNull()
        expect(characters.has(model!.body)).toBeTrue()
        if (model!.hair) expect(characters.has(model!.hair)).toBeTrue()
        const bones = glb_nodes(resolve(character_dir, `${model!.body}.glb`)).map((name) => name.toLowerCase())
        expect(bones.some((name) => name.includes('head'))).toBeTrue()
        expect(bones.some((name) => name.includes('cape'))).toBeTrue()
      }

    // Cosmetics: every selectable hat and cloak resolves to one shipped model,
    // and appearances never ride the authored item rows.
    const cosmetics = basenames(seed('models/cosmetics'), '.glb')
    const worn = items_source.filter(({ category }) => category === 'hat' || category === 'cloak')

    expect(items_source.every((item) => !('appearance' in item))).toBe(true)
    expect(worn.flatMap((item) => (cosmetic_model_of(item, cosmetics) ? [] : [item.item_type]))).toEqual([])

    // Every shipped airdrop head cosmetic is selectable under its authored name.
    const airdrop_hats = airdrop_source.showcase.filter(
      ({ kind, art_status }) => kind === 'cosmetic' && art_status.glb === 'present'
    )
    const selectable = new Map(worn_cosmetic_options.hats.map((item) => [item.item_type, item]))

    expect(airdrop_hats.map(({ id }) => id)).toContain('sam')
    for (const { id, name } of airdrop_hats) {
      expect(selectable.get(id)?.name).toBe(name)
      expect(cosmetic_model_of({ item_type: id, category: 'hat' }, cosmetics)?.basename).toBe(id)
    }

    // Mobs: exactly one mob_type-named GLB each, no more and no fewer.
    expect(mobs_source.every((mob) => !('appearance' in mob))).toBe(true)
    expect([...basenames(seed('models/mobs'), '.glb')].toSorted()).toEqual(
      mobs_source.map(({ mob_type }) => mob_type).toSorted()
    )

    // Pets: one exact item-type GLB each.
    const pets = basenames(seed('models/pets'), '.glb')
    const pet_items = content_catalog.items
      .filter(({ category }) => category === 'pet')
      .map(({ item_type }) => item_type)

    expect(pet_items).toHaveLength(71)
    expect(pet_items.filter((item_type) => !pets.has(item_type))).toEqual([])

    // ares_templates capture 2026-08-18: pet_vainquished summons vainquished,
    // whose appearance is Spirit_Gold — assert the model, not the name.
    const vanquished = new Set(glb_nodes(seed('models/pets/pet_vainquished.glb')))
    expect(vanquished.has('R-Mask')).toBeTrue()
    expect(vanquished.has('R-Horn')).toBeTrue()
    expect(vanquished.has('spine.002')).toBeFalse()
  })

  test('every canonical rune owns an HD detail render and a 64px thumbnail', () => {
    const directory = seed('icons/items')
    const runes = items_source.filter(({ category }) => category === 'rune')

    expect(runes).toHaveLength(35)
    for (const { item_type } of runes) {
      const detail = png_dimensions(resolve(directory, `${item_type}_hd.png`))
      const thumbnail = png_dimensions(resolve(directory, `${item_type}.png`))
      expect(detail.width).toBeGreaterThan(64)
      expect(detail.height).toBeGreaterThan(64)
      expect(Math.max(thumbnail.width, thumbnail.height)).toBe(64)
      expect(Math.min(thumbnail.width, thumbnail.height)).toBeGreaterThan(0)
    }
  })

  test('the character catalog uses exact legacy rows and the gender-matching Senshi fallback', () => {
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

  test('derives the authored KHR variant from the item identity', () => {
    expect(resolve_cosmetic_variant('cape_fuwa_black', 'cape_fuwa')).toBe('black')
    expect(resolve_cosmetic_variant('cape_lorito_agility', 'cape_lorito')).toBe('agility')
    expect(resolve_cosmetic_variant('capuche_bara_wisdom', 'capuche_bara')).toBe('moonstone')
    expect(resolve_cosmetic_variant('capuche_bara', 'capuche_bara')).toBe('base')
    expect(resolve_cosmetic_variant('solomonk', 'solomonk')).toBeNull()
  })

  test('spell icon identity ignores word-boundary underscores in seed filenames', () => {
    expect(spell_asset_key('yogan', 'Sunpiercer')).toBe(indexed_asset_key('yogen_sun_piercer'))
  })

  test('world terrain resolves a named world exactly and falls back only when none is selected', () => {
    expect(world_terrain('01_first_shore')).toBe(worlds_source[0]!.terrain)
    expect(world_terrain('02_verdant_hollow')).toBeNull()
    expect(world_terrain('unknown_world')).toBeNull()
    expect(world_terrain(null)).toBe(worlds_source[0]!.terrain)
  })
})
