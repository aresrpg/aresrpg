// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Content and copy gates: every locale carries every key and placeholder, player text is never a raw failure, and
// every authored identity resolves to the art, model, catalog entry and guide fact the product shows for it.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { afterAll, expect, test } from 'bun:test'
import { parse } from 'yaml'
import { class_names, item_categories, item_stat_center, job_slugs, stat_names } from '@aresrpg/immutable'
import { item_stat_offset } from '@aresrpg/protocol/character-stats'

import airdrop_source from '../../../seed/content/airdrop.json'
import crew_source from '../../../seed/content/crew.json'
import items_source from '../../../seed/content/items.json'
import mobs_source from '../../../seed/content/mobs.json'
import recipes_source from '../../../seed/content/recipes.json'
import spells_source from '../../../seed/content/spells.json'
import { item_icon, mob_icon, spell_icon } from '../src/content/assets.ts'
import { content_catalog, encyclopedia_catalog } from '../src/content/catalog.ts'
import {
  NPC_CHARACTER_MODELS,
  authored_character_model_classes,
  character_model_basenames,
} from '../src/content/character_model_catalog.ts'
import { mob_model_identity } from '../src/content/mob_models.ts'
import { city_at_position, world_city_areas, world_terrain, worlds_source } from '../src/content/worlds.ts'
import { character_price_sui, first_hour, market_terms } from '../src/docs/guide_facts.ts'
import { copy_text, format_text, load_app_copy } from '../src/i18n/copy.ts'
import { error_text, localized_error } from '../src/i18n/error_text.ts'
import { LOCALES as locale_options, load_locale, save_locale } from '../src/i18n/locale.ts'
import { player_error_text } from '../src/i18n/player_error.ts'
import { on_error_translate, toast } from '../src/toast.ts'

import { browser_navigator, memory_storage, replace_globals, restore_globals } from './harness.ts'

afterAll(restore_globals)

const LOCALES = locale_options.map(({ code }) => code)
const documents = await Promise.all(LOCALES.map(load_app_copy))
const en = documents[0]!
/** The raw document, parsed with duplicate keys refused: the build's YAML import keeps the last of a pair silently. */
const raw = (locale: string): Record<string, unknown> =>
  parse(readFileSync(new URL(`../src/i18n/locales/${locale}.yaml`, import.meta.url), 'utf8'), { uniqueKeys: true })
const leaf_paths = (value: unknown, prefix = ''): readonly string[] =>
  typeof value === 'object' && value !== null
    ? Object.entries(value).flatMap(([key, child]) => leaf_paths(child, prefix ? `${prefix}.${key}` : key))
    : [prefix]
const seed = (...parts: readonly string[]) => resolve(import.meta.dir, '../../../seed', ...parts)

/** The placeholders a copy string carries, single- or double-braced. */
const tokens = (value: unknown): readonly string[] =>
  typeof value === 'string' ? [...value.matchAll(/\{\{?([^{}]+)\}\}?/g)].map((match) => match[1]!).toSorted() : []
/** Every leaf whose translation lost or invented a placeholder of the English reference. */
const placeholder_drift = (reference: unknown, translated: unknown, path = ''): readonly string[] =>
  typeof reference === 'object' && reference !== null
    ? Object.entries(reference).flatMap(([key, value]) =>
        placeholder_drift(value, (translated as Record<string, unknown>)[key], `${path}.${key}`)
      )
    : tokens(translated).join() === tokens(reference).join()
      ? []
      : [path]
type Vocabulary = Readonly<
  Record<'item_categories' | 'simulator_page' | 'leaderboard_page' | 'spell_effects', Record<string, string>>
>
/** The game identities a locale must name: categories, stats, professions and spell effects. */
const missing_vocabulary = (document: Vocabulary, effects: readonly string[]): readonly string[] =>
  [
    ...[...item_categories, 'weapon', 'tool', 'relic_slot'].map((key) => ['item_categories', key] as const),
    ...stat_names.map((stat) => ['simulator_page', `stat_${stat}`] as const),
    ...job_slugs.map((job) => ['leaderboard_page', `job_${job}`] as const),
    ...effects.map((key) => ['spell_effects', key] as const),
  ]
    .filter(([section, key]) => !String(document[section][key] ?? '').trim())
    .map(([section, key]) => `${section}.${key}`)

test('every locale parses uniquely, carries every key and placeholder, and names every game identity', async () => {
  expect(LOCALES).toEqual(['en', 'fr', 'es', 'de', 'uk', 'ja', 'zh', 'ru', 'vi', 'ko', 'pt'])
  const [english, ...others] = LOCALES.map(raw)
  const expected = [...leaf_paths(english)].toSorted()
  expect(others.map((document) => [...leaf_paths(document)].toSorted())).toEqual(others.map(() => expected))
  expect(documents.slice(1).flatMap((document) => placeholder_drift(en, document))).toEqual([])
  const { EFFECT_KINDS, AREA_SHAPES, TARGET_FILTERS } = await import('@aresrpg/fight/move_contract')
  const effects = [
    ...Object.keys(EFFECT_KINDS),
    ...Object.keys(AREA_SHAPES).map((shape) => `shape_${shape}`),
    ...Object.keys(TARGET_FILTERS)
      .filter((target) => target !== 'none')
      .map((target) => `target_${target}`),
  ]
  expect(documents.flatMap((document) => missing_vocabulary(document as unknown as Vocabulary, effects))).toEqual([])
  const spell_identities = spells_source.map(({ name }) => name).toSorted()
  const spell_names = documents.map(
    (document) => (document as unknown as { spell_names: Record<string, string> }).spell_names
  )
  expect(spell_names.map((names) => Object.keys(names).toSorted())).toEqual(documents.map(() => spell_identities))
  expect(spell_names.flatMap(Object.values).filter((name) => !name.trim())).toEqual([])
  expect(spell_names[1]!["Senshi's Wrath"]).toBe('Colère du Senshi')
  const descriptions = documents.map(
    (document) =>
      (document as unknown as { encyclopedia_page: { item_descriptions: Record<string, string> } }).encyclopedia_page
        .item_descriptions
  )
  expect(descriptions.filter(({ scroll_of_rebirth }) => !scroll_of_rebirth)).toEqual([])
})

test('player text is literal, never a raw failure, and the language the player chose is kept', async () => {
  const text = copy_text({
    review: 'Register {{character}} with {{team}}?',
    odd: '{{missing}} {{constructor}} {{zero}}',
  })
  expect(text('review', { character: 'hero', team: "$& $$ $` $'" })).toBe("Register hero with $& $$ $` $'?")
  expect(text('review', { character: '{{team}}', team: 'Rivals' })).toBe('Register {{team}} with Rivals?')
  expect(text('odd', { zero: 0 })).toBe('{{missing}} {{constructor}} 0')
  expect(format_text('{name} / {{name}} / {count}', { name: '$& {{count}}', count: 0 })).toBe(
    '$& {{count}} / $& {{count}} / 0'
  )
  const fr = documents[1]!
  expect(error_text(fr.kares_page, new Error('User rejected the request'))).toBe(fr.kares_page.error_rejected)
  expect(error_text(fr.kares_page, new Error('Insufficient balance'))).toBe(fr.kares_page.error_funds)
  expect(player_error_text(fr, new Error('MoveAbort private diagnostic'))).toBe(fr.kares_page.error_generic)
  expect(player_error_text(fr, '[sdk] transaction outcome unknown: digest')).toBe(fr.transaction_unknown_toast)
  const shown: string[] = []
  const unsubscribe = toast.subscribe((event) => void (event.type === 'show' && shown.push(event.toast.message)))
  on_error_translate((message, is_raw) => (is_raw ? error_text(fr.kares_page, message) : null))
  try {
    toast.add('provider internals are not player copy')
    toast.add(localized_error('Une action précise'))
    expect(shown).toEqual([fr.kares_page.error_generic, 'Une action précise'])
  } finally {
    unsubscribe()
    on_error_translate(null)
  }
  // A browser in Brazilian Portuguese reads Portuguese until the player picks another language, which is kept.
  const storage = memory_storage({ ares_language: 'unsupported' })
  const restore = replace_globals({ localStorage: storage, navigator: browser_navigator('pt-BR') })
  try {
    expect(load_locale()).toBe('pt')
    save_locale('en')
    expect(load_locale()).toBe('en')
  } finally {
    restore()
  }
})

/** The node names inside a model's embedded glTF JSON chunk. */
const glb_nodes = (path: string): readonly string[] => {
  const bytes = readFileSync(path)
  const json = JSON.parse(
    bytes
      .subarray(20, 20 + bytes.readUInt32LE(12))
      .toString()
      .replace(/\0+$/u, '')
  ) as { nodes?: { name?: string }[] }
  return (json.nodes ?? []).flatMap(({ name }) => (name ? [name.toLowerCase()] : []))
}
/** A recipe's ingredients as the catalog states them. */
const ingredient_pairs = (item_type: string) =>
  encyclopedia_catalog.item(item_type)?.recipe?.ingredients.map(({ item_type: input, quantity }) => [input, quantity])
/** The catalog names the mob as a source of its own drop. */
const dropped_by = (mob_type: string, drop: Readonly<{ item_type: string }>): boolean =>
  encyclopedia_catalog
    .item(drop.item_type)
    ?.dropped_by.some(({ mob, drop: reverse }) => mob.mob_type === mob_type && reverse === drop) ?? false

test('every authored identity owns the icon, portrait and model the product addresses for it', () => {
  const file_of = (url: string | null | undefined) => seed(decodeURIComponent(url!.replace(/^\/icons\//, 'icons/')))
  expect(items_source.filter(({ item_type }) => !existsSync(file_of(item_icon(item_type))))).toEqual([])
  expect(mobs_source.filter(({ mob_type }) => !existsSync(file_of(mob_icon(mob_type))))).toEqual([])
  expect(spells_source.filter(({ classe, name }) => !existsSync(file_of(spell_icon(classe, name))))).toEqual([])
  expect(spell_icon('', 'Bare hands')).toBeNull()
  const plates = new Set(readdirSync(seed('icons/nameplates')).map((name) => name.replace(/\.png$/, '')))
  expect(
    items_source
      .flatMap((item) => ('title_nameplate' in item && item.title_nameplate ? [item.title_nameplate] : []))
      .filter((plate) => !plates.has(plate))
  ).toEqual([])
  const width = (path: string) => readFileSync(path).readUInt32BE(16)
  expect(mobs_source.filter(({ mob_type }) => width(seed('icons/mobs', `${mob_type}_hd.png`)) !== 1024)).toEqual([])
  expect(
    items_source.filter(
      ({ category, item_type }) => category === 'pet' && width(seed('icons/items', `${item_type}.png`)) !== 64
    )
  ).toEqual([])
  // Every class and gender has a rigged body; every mob type resolves to one shipped model and no model is orphaned.
  expect(authored_character_model_classes).toEqual(class_names)
  const bodies = class_names.flatMap((classe) =>
    [true, false].map((male) => character_model_basenames(classe, male).body)
  )
  expect(
    bodies.filter((body) => !glb_nodes(seed('models/characters', `${body}.glb`)).some((name) => name.includes('head')))
  ).toEqual([])
  expect(character_model_basenames('unknown', false)).toEqual({ body: 'senshi_female', hair: 'senshi_female_hair' })
  const mob_models = readdirSync(seed('models/mobs'))
    .filter((name) => name.endsWith('.glb'))
    .map((name) => name.slice(0, -4))
  const identities = mobs_source.map(({ mob_type }) => mob_model_identity(mob_type, mob_models))
  expect(identities.every(Boolean)).toBe(true)
  expect([...new Set(identities.map((identity) => identity!.basename))].toSorted()).toEqual(mob_models.toSorted())
  // The crew NPC stands in a real world, gives a public campaign's real items and wears a shipped model.
  expect(worlds_source.some(({ world }) => world === crew_source.npc.world)).toBe(true)
  const campaign = airdrop_source.campaigns.find(({ id }) => id === crew_source.campaign)
  expect(campaign?.visibility).toBe('public')
  expect(campaign?.items.every((item_type) => items_source.some((item) => item.item_type === item_type))).toBe(true)
  expect(NPC_CHARACTER_MODELS[crew_source.npc.model]).toBeDefined()
  const cities = worlds_source.flatMap(({ world }) => world_city_areas(world).map((city) => ({ world, city })))
  expect(
    cities.filter(({ world, city }) => city_at_position(world, city.anchor_x, city.anchor_z)?.id !== city.id)
  ).toEqual([])
  expect(world_terrain('unknown_world')).toBeNull()
})

test('the catalog, the guides and the pets state what the seed says', () => {
  expect(encyclopedia_catalog.items).toHaveLength(items_source.length)
  expect(encyclopedia_catalog.mobs).toHaveLength(mobs_source.length)
  expect(recipes_source.map(({ output_type }) => ingredient_pairs(output_type))).toEqual(
    recipes_source.map(({ inputs }) => Object.entries(inputs))
  )
  const drops = mobs_source.flatMap((source) => source.loot.map((drop) => ({ source, drop })))
  expect(drops.filter(({ source, drop }) => !dropped_by(source.mob_type, drop))).toEqual([])
  // The first-hour guide names a real starter city, its mobs, its dungeon key and the recipe of the first tool.
  const { starter, key, tool } = first_hour
  if (!starter || !key || !tool) throw new Error('the content no longer yields the first-hour guide')
  const world = content_catalog.world(starter.world)!
  expect(world.entry_level).toBe(Math.min(...content_catalog.worlds.map(({ entry_level }) => entry_level)))
  expect(
    starter.mobs.filter(
      (mob) => !world.mobs.find(({ mob_type }) => mob_type === mob.mob_type)?.cities.includes(starter.city)
    )
  ).toEqual([])
  expect(content_catalog.dungeon(starter.dungeon)?.key).toBe(key.item_type)
  expect(ingredient_pairs(tool.item.item_type)).toEqual(
    tool.parts.map(({ item, quantity }) => [item.item_type, quantity])
  )
  expect(character_price_sui).toBeGreaterThan(0)
  expect(market_terms.royalty_percent).toBeGreaterThan(0)
  expect(market_terms.lot_sizes.length).toBeGreaterThan(0)
  // A pet's power scales its authored bonus linearly to its maximum at sixty meals.
  const pampkin = items_source.find(({ item_type }) => item_type === 'pampkin')!
  expect([pampkin.stats!.max.wisdom, pampkin.stats!.max.vitality]).toEqual([40, 60])
  const offsets = [0, 30, 60].map((pet_power) =>
    item_stat_offset({ category: 'pet', stats: { vitality: item_stat_center + 60 }, pet_power }, 'vitality')
  )
  expect(offsets).toEqual([0, 30, 60])
})
