// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, test } from 'bun:test'

import { indexed_asset_key, spell_asset_basename, spell_asset_key } from '../../src/content/asset_keys.ts'
import { spell_icon } from '../../src/content/assets.ts'
import {
  authored_character_model_classes,
  character_model_basenames,
} from '../../src/content/character_model_catalog.ts'
import { mob_model_identity } from '../../src/content/mob_models.ts'
import {
  city_at_position,
  client_world_position,
  world_biome_at_zone,
  world_city_areas,
  world_terrain,
  worlds_source,
} from '../../src/content/worlds.ts'
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

const glb_manifest = (path: string): Readonly<{ animations: readonly string[]; textures: readonly string[] }> => {
  const bytes = readFileSync(path)
  const json_length = bytes.readUInt32LE(12)
  const json = JSON.parse(
    bytes
      .subarray(20, 20 + json_length)
      .toString()
      .replace(/\0+$/u, '')
  ) as Readonly<{
    animations?: readonly Readonly<{ name?: string }>[]
    images?: readonly Readonly<{ name?: string }>[]
    textures?: readonly Readonly<{ name?: string; source?: number }>[]
  }>
  return Object.freeze({
    animations: Object.freeze((json.animations ?? []).flatMap(({ name }) => (name ? [name] : []))),
    textures: Object.freeze(
      (json.textures ?? []).flatMap((texture) => {
        const name = texture.name ?? (texture.source === undefined ? undefined : json.images?.[texture.source]?.name)
        return name ? [name] : []
      })
    ),
  })
}

const png_dimensions = (path: string): Readonly<{ width: number; height: number }> => {
  const bytes = readFileSync(path)
  expect(bytes.subarray(1, 4).toString()).toBe('PNG')
  return Object.freeze({ width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) })
}

const assert_character_model_asset = (
  character_dir: string,
  available: ReadonlySet<string>,
  model: ReturnType<typeof character_model_basenames>
): void => {
  const parts = [model.body, ...(model.hair ? [model.hair] : [])]
  expect(parts.every((basename) => available.has(basename))).toBeTrue()
  const body_path = resolve(character_dir, `${model.body}.glb`)
  const bones = glb_nodes(body_path).map((name) => name.toLowerCase())
  expect(bones.some((name) => name.includes('head'))).toBeTrue()
  expect(bones.some((name) => name.includes('cape'))).toBeTrue()
  const body = glb_manifest(body_path)
  const clip_names = body.animations.map((name) =>
    name
      .toUpperCase()
      .split(/[|:/\\.-]/u)
      .at(-1)
  )
  expect(['IDLE', 'WALK', 'RUN'].every((name) => clip_names.includes(name))).toBeTrue()
  for (const basename of parts) {
    const { textures } = glb_manifest(resolve(character_dir, `${basename}.glb`))
    expect(
      ['diffuse_base', 'diffuse_color1', 'diffuse_color2', 'diffuse_color3'].every((name) => textures.includes(name))
    ).toBeTrue()
  }
}

describe('shipped content assets', () => {
  test('every declared model exists on disk with the nodes its renderer expects', () => {
    // Characters: one body (plus optional hair) per class and gender, rigged.
    const character_dir = seed('models/characters')
    const characters = basenames(character_dir, '.glb')
    for (const classe of authored_character_model_classes)
      for (const male of [true, false])
        assert_character_model_asset(character_dir, characters, character_model_basenames(classe, male))
    const declared_characters = authored_character_model_classes.flatMap((classe) =>
      [true, false].flatMap((male) => Object.values(character_model_basenames(classe, male)))
    )
    expect([...characters].toSorted()).toEqual([...new Set(declared_characters)].toSorted())

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

    for (const { item_type } of runes) {
      const detail = png_dimensions(resolve(directory, `${item_type}_hd.png`))
      const thumbnail = png_dimensions(resolve(directory, `${item_type}.png`))
      expect(detail.width).toBeGreaterThan(64)
      expect(detail.height).toBeGreaterThan(64)
      expect(Math.max(thumbnail.width, thumbnail.height)).toBe(64)
      expect(Math.min(thumbnail.width, thumbnail.height)).toBeGreaterThan(0)
    }
  })

  test('every protector resource bag owns its restored 512px and 64px icon pair', () => {
    const directory = seed('icons/items')
    const bags = items_source.filter(
      ({ item_type, consumable }) => item_type.startsWith('bag_') && consumable?.type === 'loot_box'
    )

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

  test('development mob icons bypass the boot-time Vite glob when a file is added', () => {
    const registry = readFileSync(resolve(import.meta.dir, '../../src/content/assets.ts'), 'utf8')

    expect(registry).toContain("'/__seed/assets/'")
    expect(registry).toContain('import.meta.env.DEV')
  })

  test('the character catalog uses every authored pair and the gender-matching Senshi fallback', () => {
    expect(character_model_basenames('senshi', true)).toEqual({
      body: 'senshi_male',
      hair: 'senshi_male_hair',
    })
    expect(character_model_basenames('shugo', false)).toEqual({
      body: 'shugo_female',
      hair: 'shugo_female_hair',
    })
    expect(character_model_basenames('tomoda', false)).toEqual({
      body: 'tomoda_female',
      hair: 'tomoda_female_hair',
    })
    expect(character_model_basenames('rojin', true)).toEqual({ body: 'rojin_male', hair: 'rojin_male_hair' })
    expect(character_model_basenames('tokei', false)).toEqual({ body: 'tokei_female', hair: 'tokei_female_hair' })
    expect(character_model_basenames('yogan', true)).toEqual({
      body: 'senshi_male',
      hair: 'senshi_male_hair',
    })
  })

  test('spell icon identity ignores word-boundary underscores in seed filenames', () => {
    expect(spell_asset_basename('yogan', 'Poisoned Arrow')).toBe('yogan_poisoned_arrow')
    expect(spell_asset_key('yogan', 'Paralyzing Arrow')).toBe(indexed_asset_key('yogan_paralyzing_arrow'))
    const spell_icons = basenames(seed('icons/spells'), '.webp')
    expect(spells_source.every(({ classe, name }) => spell_icons.has(spell_asset_basename(classe, name)))).toBeTrue()
  })

  test('bare hands use the fight HUD fallback instead of a nonexistent spell image', () => {
    expect(spell_icon('', 'Bare hands')).toBeNull()
  })

  test('world terrain and city lookup follow the current authored world roster', () => {
    for (const world of worlds_source) {
      if (world.terrain) expect(world_terrain(world.world)).toMatchObject(world.terrain)
      for (const city of world_city_areas(world.world))
        expect(city_at_position(world.world, city.anchor_x, city.anchor_z)?.id).toBe(city.id)
    }
    expect(client_world_position(50_512, 50_000)).toEqual([512, 0])
    expect(world_biome_at_zone('unknown_world', 97, 97)).toBeNull()
    expect(world_terrain('unknown_world')).toBeNull()
    expect(world_terrain(null)).toEqual(world_terrain(worlds_source[0]?.world ?? null))
  })
})
