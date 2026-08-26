// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, test } from 'bun:test'

import { indexed_asset_key, spell_asset_basename, spell_asset_key } from '../../src/content/asset_keys.ts'
import { spell_icon } from '../../src/content/assets.ts'
import { character_model_basenames, worn_equipment_model_of } from '../../src/content/character_model_catalog.ts'
import { mob_model_identity } from '../../src/content/mob_models.ts'
import { world_terrain, worlds_source } from '../../src/content/worlds.ts'
import items_source from '../../../../seed/content/items.json'
import mobs_source from '../../../../seed/content/mobs.json'
import spells_source from '../../../../seed/content/spells.json'

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

const glb_variants = (path: string): readonly string[] => {
  const bytes = readFileSync(path)
  const json_length = bytes.readUInt32LE(12)
  const json = JSON.parse(
    bytes
      .subarray(20, 20 + json_length)
      .toString()
      .trim()
  ) as Readonly<{
    extensions?: Readonly<{ KHR_materials_variants?: Readonly<{ variants?: readonly Readonly<{ name: string }>[] }> }>
  }>
  return Object.freeze(json.extensions?.KHR_materials_variants?.variants?.map(({ name }) => name) ?? [])
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

    expect(items_source.every((item) => !('appearance' in item))).toBe(true)

    // Mobs: exact types own a GLB; suffixed types own one declared material variant.
    expect(mobs_source.every((mob) => !('appearance' in mob))).toBe(true)
    const mob_models = [...basenames(seed('models/mobs'), '.glb')]
    const identities = mobs_source.map(({ mob_type }) => mob_model_identity(mob_type, mob_models))
    expect(identities.every((identity) => identity !== null)).toBeTrue()
    expect([...new Set(identities.flatMap((identity) => (identity ? [identity.basename] : [])))].toSorted()).toEqual(
      mob_models.toSorted()
    )
    const mob_registry = readFileSync(resolve(import.meta.dir, '../../src/content/mob_models.ts'), 'utf8')
    expect(mob_registry).not.toContain('typeof import.meta.glob')
    expect(mob_registry).toContain("typeof Bun === 'undefined'")
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

  test('new item art uses the 512px detail and 64px runtime convention', () => {
    const directory = seed('icons/items')
    for (const item_type of [
      'nifuwa_wool',
      'fuwa_wool',
      'fuwa_horn',
      'fuwa_eye',
      'fuwa_hide',
      'nifuwa_hide',
      'fukuo_tidal_horn',
      'green_mushroom',
      'key_of_tangled_aftermath',
    ]) {
      expect(png_dimensions(resolve(directory, `${item_type}_hd.png`))).toEqual({ width: 512, height: 512 })
      expect(png_dimensions(resolve(directory, `${item_type}.png`))).toEqual({ width: 64, height: 64 })
    }
  })

  test('every protector resource bag owns its restored 512px and 64px icon pair', () => {
    const directory = seed('icons/items')
    const bags = items_source.filter(({ consumable }) => consumable?.type === 'loot_box')

    expect(bags).toHaveLength(33)
    for (const { item_type } of bags) {
      expect(png_dimensions(resolve(directory, `${item_type}_hd.png`))).toEqual({ width: 512, height: 512 })
      expect(png_dimensions(resolve(directory, `${item_type}.png`))).toEqual({ width: 64, height: 64 })
    }
  })

  test('every mob owns its HD and turn-card portrait pair', () => {
    const directory = seed('icons/mobs')

    for (const { mob_type } of mobs_source) {
      expect(png_dimensions(resolve(directory, `${mob_type}_hd.png`))).toEqual({ width: 1024, height: 1024 })
      expect(png_dimensions(resolve(directory, `${mob_type}.png`))).toEqual({ width: 512, height: 512 })
    }
  })

  test('the four Fuwa equipment identities resolve through two shared variant GLBs', () => {
    const directory = seed('models/equipment')
    const available = basenames(directory, '.glb')
    const identities = Object.freeze([
      'cape_fuwa__white',
      'cape_fuwa__black',
      'coiffe_fuwa__white',
      'coiffe_fuwa__black',
    ])
    const rows = identities.map((item_type) => items_source.find((item) => item.item_type === item_type)!)

    expect(rows.map(({ item_type }) => item_type)).toEqual([...identities])
    for (const item of rows) {
      expect(item.category).toBe(item.item_type.startsWith('cape_') ? 'cloak' : 'hat')
      const model = worn_equipment_model_of(item, available)
      if (!model?.variant) throw new Error(`${item.item_type} has no equipment model variant`)
      expect(glb_variants(resolve(directory, `${model.basename}.glb`))).toContain(model.variant)
      expect(png_dimensions(seed('icons/items', `${item.item_type}_hd.png`))).toEqual({ width: 512, height: 512 })
      expect(png_dimensions(seed('icons/items', `${item.item_type}.png`))).toEqual({ width: 64, height: 64 })
    }
  })

  test('development mob icons bypass the boot-time Vite glob when a file is added', () => {
    const registry = readFileSync(resolve(import.meta.dir, '../../src/content/assets.ts'), 'utf8')

    expect(registry).toContain("'/__seed/assets/'")
    expect(registry).toContain('import.meta.env.DEV')
  })

  test('the character catalog uses exact legacy rows and the gender-matching Senshi fallback', () => {
    expect(character_model_basenames('senshi', true)).toEqual({
      body: 'senshi_male',
      hair: 'senshi_male_hair',
    })
    expect(character_model_basenames('shugo', false)).toEqual({ body: 'shugo_female' })
    expect(character_model_basenames('tomoda', false)).toEqual({ body: 'tomoda_female' })
    expect(character_model_basenames('yogan', true)).toEqual({
      body: 'senshi_male',
      hair: 'senshi_male_hair',
    })
  })

  test('spell icon identity ignores word-boundary underscores in seed filenames', () => {
    expect(spell_asset_basename('yogan', 'Adder Shaft')).toBe('yogan_adder_shaft')
    expect(spell_asset_key('yogan', 'Sunpiercer')).toBe(indexed_asset_key('yogan_sun_piercer'))
    const spell_icons = basenames(seed('icons/spells'), '.webp')
    expect(spells_source.every(({ classe, name }) => spell_icons.has(spell_asset_basename(classe, name)))).toBeTrue()
  })

  test('bare hands use the fight HUD fallback instead of a nonexistent spell image', () => {
    expect(spell_icon('', 'Bare hands')).toBeNull()
  })

  test('world terrain resolves a named world exactly and falls back only when none is selected', () => {
    expect(world_terrain('nauvis')).toBe(worlds_source[0]!.terrain)
    expect(world_terrain('yakutia')).toBe(worlds_source[1]!.terrain)
    expect(world_terrain('unknown_world')).toBeNull()
    expect(world_terrain(null)).toBe(worlds_source[0]!.terrain)
  })
})
