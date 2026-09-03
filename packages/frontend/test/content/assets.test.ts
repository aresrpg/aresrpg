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
  worn_equipment_model_of,
} from '../../src/content/character_model_catalog.ts'
import { mob_model_identity } from '../../src/content/mob_models.ts'
import {
  city_at_position,
  client_world_position,
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

const glb_scene_nodes = (path: string): readonly string[] => {
  const bytes = readFileSync(path)
  const json_length = bytes.readUInt32LE(12)
  const json = JSON.parse(
    bytes
      .subarray(20, 20 + json_length)
      .toString()
      .replace(/\0+$/u, '')
  ) as Readonly<{
    scene?: number
    scenes?: readonly Readonly<{ nodes?: readonly number[] }>[]
    nodes?: readonly Readonly<{ name?: string }>[]
  }>
  const scene = json.scenes?.[json.scene ?? 0]
  return Object.freeze(
    (scene?.nodes ?? []).flatMap((node) => (json.nodes?.[node]?.name ? [json.nodes[node]!.name!] : []))
  )
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

const glb_scene_scale_boundary = (
  path: string
): Readonly<{ name: string | null; scale: readonly number[]; animated: boolean }> => {
  const bytes = readFileSync(path)
  const json_length = bytes.readUInt32LE(12)
  const json = JSON.parse(
    bytes
      .subarray(20, 20 + json_length)
      .toString()
      .trim()
  ) as Readonly<{
    scene: number
    scenes: readonly Readonly<{ nodes: readonly number[] }>[]
    nodes: readonly Readonly<{ name: string; scale: readonly number[] }>[]
    animations?: readonly Readonly<{
      channels: readonly Readonly<{ target: Readonly<{ node: number }> }>[]
    }>[]
  }>
  const root_index = json.scenes[json.scene].nodes[0]!
  const root = json.nodes[root_index]!
  const animated = (json.animations ?? []).some((animation) =>
    animation.channels.some((channel) => channel.target.node === root_index)
  )
  return Object.freeze({ name: root.name, scale: Object.freeze(root.scale), animated })
}

const glb_scene_rotation = (path: string): readonly number[] | null => {
  const bytes = readFileSync(path)
  const json_length = bytes.readUInt32LE(12)
  const json = JSON.parse(
    bytes
      .subarray(20, 20 + json_length)
      .toString()
      .trim()
  ) as Readonly<{
    scene: number
    scenes: readonly Readonly<{ nodes: readonly number[] }>[]
    nodes: readonly Readonly<{ rotation?: readonly number[] }>[]
  }>
  return json.nodes[json.scenes[json.scene].nodes[0]!]!.rotation ?? null
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

const glb_variant_texture_source = (path: string, variant_name: string): number => {
  const bytes = readFileSync(path)
  const json_length = bytes.readUInt32LE(12)
  const json = JSON.parse(
    bytes
      .subarray(20, 20 + json_length)
      .toString()
      .trim()
  ) as Readonly<{
    extensions: Readonly<{ KHR_materials_variants: Readonly<{ variants: readonly Readonly<{ name: string }>[] }> }>
    materials: readonly Readonly<{
      pbrMetallicRoughness: Readonly<{ baseColorTexture: Readonly<{ index: number }> }>
    }>[]
    meshes: readonly Readonly<{
      primitives: readonly Readonly<{
        extensions: Readonly<{
          KHR_materials_variants: Readonly<{
            mappings: readonly Readonly<{ material: number; variants: readonly number[] }>[]
          }>
        }>
      }>[]
    }>[]
    textures: readonly Readonly<{ source: number }>[]
  }>
  const variant_index = json.extensions.KHR_materials_variants.variants.findIndex(({ name }) => name === variant_name)
  const mapping = json.meshes
    .flatMap(({ primitives }) => primitives)
    .flatMap(({ extensions }) => extensions.KHR_materials_variants.mappings)
    .find(({ variants }) => variants.includes(variant_index))
  if (!mapping) throw new Error(`${path}: variant ${variant_name} has no material mapping`)
  const texture_index = json.materials[mapping.material]!.pbrMetallicRoughness.baseColorTexture.index
  return json.textures[texture_index]!.source
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

  test('the white ant scene contains no exported helper plane', () => {
    expect(glb_scene_nodes(seed('models/mobs/ant_white.glb'))).toEqual(['Armature'])
  })

  test('Nook uses the engine animation vocabulary', () => {
    expect(glb_manifest(seed('models/mobs/nook.glb')).animations.toSorted()).toEqual([
      'ATTACK',
      'DEATH',
      'DEATH_POSE',
      'HIT',
      'IDLE',
      'RUN',
      'WALK',
    ])
  })

  test('Nook normalizes VoxEdit units above its animated hierarchy', () => {
    expect(glb_scene_scale_boundary(seed('models/mobs/nook.glb'))).toEqual({
      name: 'NookScale',
      scale: [0.04, 0.04, 0.04],
      animated: false,
    })
  })

  test('Thebes fauna models use canonical clips and non-animated scale boundaries', () => {
    const ground_clips = ['ATTACK', 'DEATH', 'DEATH_POSE', 'HIT', 'IDLE', 'RUN', 'WALK']
    expect(glb_manifest(seed('models/mobs/bramble.glb')).animations.toSorted()).toEqual(ground_clips)
    expect(glb_manifest(seed('models/mobs/tinker.glb')).animations.toSorted()).toEqual(ground_clips)
    expect(glb_manifest(seed('models/mobs/lorito.glb')).animations.toSorted()).toEqual([
      'ATTACK',
      'DEATH',
      'DEATH_POSE',
      'IDLE',
      'RUN',
      'WALK',
    ])
    expect(glb_scene_scale_boundary(seed('models/mobs/bramble.glb'))).toEqual({
      name: 'BrambleScale',
      scale: [0.026, 0.026, 0.026],
      animated: false,
    })
    expect(glb_scene_scale_boundary(seed('models/mobs/tinker.glb'))).toEqual({
      name: 'TinkerScale',
      scale: [0.03, 0.03, 0.03],
      animated: false,
    })
    expect(glb_scene_scale_boundary(seed('models/mobs/lorito.glb'))).toEqual({
      name: 'LoritoScale',
      scale: [0.027, 0.027, 0.027],
      animated: false,
    })
    expect(glb_manifest(seed('models/mobs/golden_lorito.glb')).animations.toSorted()).toEqual([
      'ATTACK',
      'DEATH',
      'DEATH_POSE',
      'IDLE',
      'RUN',
      'WALK',
    ])
    expect(glb_scene_scale_boundary(seed('models/mobs/golden_lorito.glb'))).toEqual({
      name: 'GoldenLoritoScale',
      scale: [0.04, 0.04, 0.04],
      animated: false,
    })
    expect(glb_variants(seed('models/mobs/lorito.glb')).toSorted()).toEqual(['air', 'earth', 'fire', 'golden', 'water'])
  })

  test('VoxEdit fauna scale boundaries face the engine forward axis', () => {
    for (const model of ['lorito', 'golden_lorito', 'nook', 'bramble', 'tinker', 'wild_boar'])
      expect(glb_scene_rotation(seed(`models/mobs/${model}.glb`))).toEqual([0, 1, 0, 0])
  })

  test('Wild Boar uses the ground-fauna animation and scale contract', () => {
    expect(glb_manifest(seed('models/mobs/wild_boar.glb')).animations.toSorted()).toEqual([
      'ATTACK',
      'DEATH',
      'DEATH_POSE',
      'HIT',
      'IDLE',
      'RUN',
      'WALK',
    ])
    expect(glb_scene_scale_boundary(seed('models/mobs/wild_boar.glb'))).toEqual({
      name: 'WildBoarScale',
      scale: [0.03, 0.03, 0.03],
      animated: false,
    })
  })

  test('Lorito hats and cloaks share all six stat skins plus the basic and golden skins', () => {
    const variants = ['agility', 'chance', 'golden', 'intelligence', 'molted', 'strength', 'vitality', 'wisdom']

    expect(glb_variants(seed('models/equipment/lorito_hat.glb')).toSorted()).toEqual(variants)
    expect(glb_variants(seed('models/equipment/lorito_cloak.glb')).toSorted()).toEqual(variants)
    for (const model of ['lorito_hat.glb', 'lorito_cloak.glb']) {
      const path = seed('models/equipment', model)
      expect(glb_variant_texture_source(path, 'molted')).not.toBe(glb_variant_texture_source(path, 'wisdom'))
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
      'key_of_gilded_lorito',
      'golden_lorito_feather',
      'gilded_talon',
      'gilded_lorito_plume',
      'sunforged_talon',
      'lorito_hat__golden',
      'lorito_cloak__golden',
      'golden_lorito_amulet',
      'colony_laminate',
      'embertide_webbing',
      'galestone_webbing',
      'silkblade_thread',
      'broodglass',
      'shellbound_plate',
      'crowani_scaleweave',
      'fuwa_fleece',
      'nifuwa_fleece',
      'tidal_horn_core',
      'emberstone_scaleplate',
      'galetide_scaleweave',
      'heartscale_membrane',
      'abyssal_oculus',
      'gravebone_composite',
      'moka_arms_binding',
      'boarhide_laminate',
      'gilded_pet_food',
      'bloodamber_pet_food',
      'jadeghost_pet_food',
      'moonfire_pet_food',
      'bloodnight_pet_food',
      'genesis_duskheart_pet_food',
      'phantom_obsidian_pet_food',
      'abyssal_arcanite_pet_food',
      'spectral_draconite_pet_food',
      'primordial_dragon_pet_food',
      'cursed_diamond_pet_food',
    ]) {
      expect(png_dimensions(resolve(directory, `${item_type}_hd.png`))).toEqual({ width: 512, height: 512 })
      expect(png_dimensions(resolve(directory, `${item_type}.png`))).toEqual({ width: 64, height: 64 })
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

  test('every Fuwa skin owns one embedded texture in the shared animated GLB', () => {
    const path = seed('models/mobs/fuwa.glb')
    const variants = mobs_source
      .flatMap(({ mob_type }) => (mob_type.startsWith('fuwa__') ? [mob_type.slice('fuwa__'.length)] : []))
      .toSorted()

    expect(glb_variants(path).toSorted()).toEqual(variants)
    expect(new Set(variants.map((variant) => glb_variant_texture_source(path, variant)))).toHaveLength(variants.length)
  })

  test('the approved standalone hats and Momaku cloak own exact model and icon pairs', () => {
    const directory = seed('models/equipment')
    const available = basenames(directory, '.glb')
    const identities = Object.freeze([
      ['mokan', 'hat'],
      ['momaku', 'cloak'],
      ['drakar', 'hat'],
      ['ekusoni', 'hat'],
      ['casque_hayate', 'hat'],
      ['oeufterhead', 'hat'],
      ['coiffe_pepe', 'hat'],
      ['coiffe_pepe_royal', 'hat'],
      ['fud', 'hat'],
      ['sam', 'hat'],
      ['suicunio', 'hat'],
      ['sui_helmet', 'hat'],
    ] as const)

    for (const [item_type, category] of identities) {
      const item = items_source.find((candidate) => candidate.item_type === item_type)!
      expect(item.category).toBe(category)
      expect(worn_equipment_model_of(item, available)).toEqual({ basename: item_type, variant: null })
      expect(png_dimensions(seed('icons/items', `${item_type}_hd.png`))).toEqual({ width: 512, height: 512 })
      expect(png_dimensions(seed('icons/items', `${item_type}.png`))).toEqual({ width: 64, height: 64 })
    }
  })

  test('the draft Mastery crates own canonical icon pairs', () => {
    for (const item_type of ['food_crate', 'resource_crate', 'pet_crate', 'sui_crate']) {
      expect(items_source.find((item) => item.item_type === item_type)).toMatchObject({
        category: 'consumable',
        level: 1,
        consumable: { type: 'loot_box' },
      })
      expect(png_dimensions(seed('icons/items', `${item_type}_hd.png`))).toEqual({ width: 512, height: 512 })
      expect(png_dimensions(seed('icons/items', `${item_type}.png`))).toEqual({ width: 64, height: 64 })
    }
  })

  test('the Nauvis weapon ladders own five authored identities and icon pairs per category', () => {
    const weapon_ladders = Object.freeze({
      sword: ['resin_edge', 'gravebrand', 'emberweb_falchion', 'tuskspine', 'sunbound_concord'],
      daggers: ['rootshivs', 'crabclaw_knives', 'misui_razorfins', 'chitin_stingers', 'broodglass_twins'],
      bow: ['rootstring_shortbow', 'gravecord_bow', 'fleecehorn_bow', 'crowani_scale_bow', 'five_biome_greatbow'],
      spear: ['resinpoint', 'pincer_lance', 'stoneweb_spear', 'boar_tusk_glaive', 'araknomath_spindle'],
      axe: ['rootsplitter', 'gravechop', 'fuwa_horncleaver', 'colony_mandible_axe', 'mossbound_broadaxe'],
    } as const)

    for (const [category, item_types] of Object.entries(weapon_ladders)) {
      expect(item_types).toHaveLength(5)
      for (const item_type of item_types) {
        expect(items_source.find((item) => item.item_type === item_type)?.category).toBe(category)
        expect(png_dimensions(seed('icons/items', `${item_type}_hd.png`))).toEqual({ width: 512, height: 512 })
        expect(png_dimensions(seed('icons/items', `${item_type}.png`))).toEqual({ width: 64, height: 64 })
      }
    }
  })

  test('Siluri owns its exact pet model and inventory icon pair', () => {
    const item = items_source.find(({ item_type }) => item_type === 'siluri')!

    expect(item).toMatchObject({ category: 'pet', level: 1, pet_foods: ['gilded_pet_food'] })
    expect(glb_manifest(seed('models/pets/siluri.glb')).animations.toSorted()).toEqual(['IDLE', 'RUN'])
    expect(png_dimensions(seed('icons/items/siluri_hd.png'))).toEqual({ width: 512, height: 512 })
    expect(png_dimensions(seed('icons/items/siluri.png'))).toEqual({ width: 64, height: 64 })
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

  test('world terrain resolves a named world exactly and falls back only when none is selected', () => {
    expect(world_terrain('nauvis')).toMatchObject(worlds_source[0]!.terrain!)
    expect(world_terrain('yakutia')).toMatchObject(worlds_source[1]!.terrain!)
    expect(world_terrain('nauvis')).toHaveProperty('structure_areas')
    expect(client_world_position(50_512, 50_000)).toEqual([512, 0])
    expect(world_terrain('nauvis')).toHaveProperty('structure_areas[0].anchor_x', 512)
    expect(
      world_city_areas('nauvis').map(({ id, dungeon, anchor_x, anchor_z }) => [id, dungeon, anchor_x, anchor_z])
    ).toEqual([
      ['thebes', 'gilded_lorito', 512, 0],
      ['the_ruins', 'tangled_aftermath', -13_936, -1_328],
      ['fuwage', 'ivory_rampart', -35_760, -27_312],
    ])
    expect(city_at_position('nauvis', 512, 0)?.id).toBe('thebes')
    expect(city_at_position('nauvis', -13_936, -1_328)?.id).toBe('the_ruins')
    expect(city_at_position('nauvis', -35_760, -27_312)?.id).toBe('fuwage')
    expect(city_at_position('nauvis', -337, 0)).toBeNull()
    expect(world_terrain('unknown_world')).toBeNull()
    expect(world_terrain(null)).toEqual(world_terrain('nauvis'))
  })
})
