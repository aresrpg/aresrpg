// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Link previews for crawlers, which never run the application. Each shareable route gets a copy of
// the built shell with its own title, description and card; the application boots from it unchanged.

import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { class_names } from '@aresrpg/immutable'
import type { Plugin } from 'vite'
import { parse } from 'yaml'

import { character_model_basenames } from './src/content/character_model_catalog.ts'
import { encyclopedia_item_path } from './src/encyclopedia/routes.ts'
import { create_social_renderer, type EncyclopediaCard, type EntityCard } from './social_card_render.ts'

export type SocialDirectories = Readonly<{
  cards_dir: string
  content_dir: string
  copy_path: string
  icons_dir: string
}>
export type SocialCard = Readonly<{
  description: string
  /** Present when the card image is painted from content at build time. */
  entity: EntityCard | null
  image: string
  route: string
  title: string
}>
type Stats = Readonly<Record<'min' | 'max', Readonly<Record<string, number>>>>
type Item = Readonly<{ category: string; item_type: string; level: number; name: string; stats?: Stats }>
type Mob = Readonly<{
  agility: number
  ap: number
  element: string
  hp: number
  level_max: number
  level_min: number
  mob_type: string
  mp: number
  name: string
  role: string
  spells: readonly Readonly<{ name: string }>[]
}>
type Spell = Readonly<{ classe: string; name: string; unlock_level: number }>
type Copy = Readonly<{
  characters_page: Readonly<{ stat: Readonly<Record<string, string>> }>
  item_categories: Readonly<Record<string, string>>
  simulator_page: Readonly<Record<string, string>>
}>

const ENCYCLOPEDIA_IMAGE = '/social/encyclopedia.jpg'
const MOSAIC_TILES = 30
const titleize = (value: string): string =>
  value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
const range = (min: number, max: number): string => (min === max ? String(min) : `${min} – ${max}`)
const page = (route: string, card: string, title: string, description: string): SocialCard =>
  Object.freeze({ description, entity: null, image: `/social/${card}.jpg`, route, title })

const GIFT_COPY = [
  'A gift is waiting for you',
  'Sign in with Google to claim it into your AresRPG game wallet.',
] as const
const ENCYCLOPEDIA_COPY = ['Encyclopedia', 'Every item, mob, class, spell and recipe in AresRPG.'] as const
const PAGE_CARDS: readonly SocialCard[] = Object.freeze([
  page('/claim', 'gift', ...GIFT_COPY),
  page('/gift', 'gift', ...GIFT_COPY),
  page(
    '/marketplace',
    'marketplace',
    'Marketplace',
    'Player listings on Sui. Gear and characters at any price you set.'
  ),
  page('/leaderboard', 'leaderboard', 'Leaderboard', 'Who runs the world? Ranked from on-chain history.'),
  page('/mastery', 'mastery', 'Mastery', 'Complete daily dungeon quests to earn unique rewards.'),
  page('/kares', 'kares', 'KARES staking', 'Stakers share 20% of collected marketplace royalties in SUI.'),
  page(
    '/allocation',
    'allocation',
    'KARES whitelist',
    'Climb a leaderboard or post on X to get a Veteran or Member spot for the KARES sale on Blast.'
  ),
  ...['', '/items', '/bestiary', '/classes'].map((tab) =>
    page(`/encyclopedia${tab}`, 'encyclopedia', ...ENCYCLOPEDIA_COPY)
  ),
])

const read_json = async <T>(path: string): Promise<T> => JSON.parse(await readFile(path, 'utf8')) as T
/** Resolves a content slug to its best authored icon, or null when no art exists yet. */
const art_lookup = async (directory: string) => {
  const names = new Set(await readdir(directory))
  return (slug: string): string | null => {
    const name = [`${slug}_hd.png`, `${slug}.png`].find((candidate) => names.has(candidate))
    return name ? join(directory, name) : null
  }
}
const entity_card = (
  kind: string,
  slug: string,
  route: string,
  description: string,
  art_path: string | null,
  card: Omit<EntityCard, 'art_path'>
): SocialCard =>
  Object.freeze({
    description,
    entity: art_path ? Object.freeze({ ...card, art_path }) : null,
    image: art_path ? `/social/${kind}/${slug}.jpg` : ENCYCLOPEDIA_IMAGE,
    route,
    title: card.title,
  })

const item_card = (copy: Copy, art: (slug: string) => string | null, item: Item): SocialCard => {
  const category = copy.item_categories[item.category] ?? titleize(item.category)
  const { min = {}, max = {} } = item.stats ?? {}
  const stats = Object.keys(min)
    .filter((stat) => min[stat] || max[stat])
    .slice(0, 4)
    .map((stat) => [copy.characters_page.stat[stat] ?? titleize(stat), range(min[stat]!, max[stat] ?? 0)] as const)
  const detail = `Level ${item.level}`
  return entity_card(
    'item',
    item.item_type,
    encyclopedia_item_path(item.item_type),
    [`${category} · ${detail}`, ...stats.map(([label, value]) => `${label} ${value}`)].join(' · '),
    art(item.item_type),
    {
      accent: category,
      crumb: 'Encyclopedia · Items',
      detail,
      rows: stats.length ? stats : [['Category', category] as const, ['Level', String(item.level)] as const],
      title: item.name,
    }
  )
}
const mob_card = (art: (slug: string) => string | null, mob: Mob): SocialCard => {
  const detail = `${titleize(mob.role)} · Level ${range(mob.level_min, mob.level_max)}`
  const element = titleize(mob.element)
  return entity_card(
    'mob',
    mob.mob_type,
    `/encyclopedia/bestiary/${encodeURIComponent(mob.mob_type)}`,
    `${element} ${detail} · ${mob.hp.toLocaleString('en-US')} HP · ${mob.ap} AP · ${mob.mp} MP`,
    art(mob.mob_type),
    {
      accent: element,
      crumb: 'Encyclopedia · Bestiary',
      detail,
      rows: [
        ['Health', mob.hp.toLocaleString('en-US')],
        ['Action / Movement', `${mob.ap} AP · ${mob.mp} MP`],
        ['Agility', String(mob.agility)],
        ['Spells', mob.spells.map(({ name }) => name).join(' · ')],
      ],
      title: mob.name,
    }
  )
}
const class_card = (
  copy: Copy,
  art: (slug: string) => string | null,
  spells: readonly Spell[],
  classe: string
): SocialCard => {
  const role = copy.simulator_page[`class_${classe}_title`] ?? titleize(classe)
  const book = spells.filter((spell) => spell.classe === classe).toSorted((a, b) => a.unlock_level - b.unlock_level)
  // Classes still borrowing another class's model have no portrait of their own to show.
  const portrait = character_model_basenames(classe, true).body
  return entity_card(
    'classe',
    classe,
    `/encyclopedia/classes/${classe}`,
    `${role} · ${book.length} spells. One of ${class_names.length} classes in AresRPG.`,
    portrait.startsWith(classe) ? art(portrait) : null,
    {
      accent: 'Class',
      crumb: 'Encyclopedia · Classes',
      detail: role,
      rows: [
        ['Spells', String(book.length)],
        [
          'Starts with',
          book
            .slice(0, 3)
            .map(({ name }) => name)
            .join(' · '),
        ],
      ],
      title: titleize(classe),
    }
  )
}

export const social_catalog = async ({
  content_dir,
  copy_path,
  icons_dir,
}: Omit<SocialDirectories, 'cards_dir'>): Promise<
  Readonly<{ cards: readonly SocialCard[]; encyclopedia: EncyclopediaCard }>
> => {
  const [items, mobs, spells, recipes] = await Promise.all([
    read_json<readonly Item[]>(join(content_dir, 'items.json')),
    read_json<readonly Mob[]>(join(content_dir, 'mobs.json')),
    read_json<readonly Spell[]>(join(content_dir, 'spells.json')),
    read_json<readonly unknown[]>(join(content_dir, 'recipes.json')),
  ])
  const copy = parse(await readFile(copy_path, 'utf8')) as Copy
  const [item_art, mob_art, class_art] = await Promise.all(
    ['items', 'mobs', 'characters'].map((kind) => art_lookup(join(icons_dir, kind)))
  )
  const equipment = items
    .filter((item) => item.stats && item_art!(item.item_type))
    .toSorted((a, b) => b.level - a.level || a.item_type.localeCompare(b.item_type))
  const stride = Math.max(1, Math.floor(equipment.length / MOSAIC_TILES))
  return Object.freeze({
    cards: Object.freeze([
      ...PAGE_CARDS,
      ...items.map((item) => item_card(copy, item_art!, item)),
      ...mobs.map((mob) => mob_card(mob_art!, mob)),
      ...class_names.map((classe) => class_card(copy, class_art!, spells, classe)),
    ]),
    encyclopedia: Object.freeze({
      art_paths: equipment
        .filter((_, index) => index % stride === 0)
        .slice(0, MOSAIC_TILES)
        .map((item) => item_art!(item.item_type)!),
      counts: [
        [items.length, 'items'],
        [mobs.length, 'mobs'],
        [spells.length, 'spells'],
        [recipes.length, 'recipes'],
      ] as const,
    }),
  })
}

export const escape_html = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
/** Replaces one tag's value; a shell without the tag is a broken contract, never a silent skip. */
const swap = (html: string, pattern: RegExp, value: string): string => {
  if (html.match(pattern)?.length !== 1) throw new Error(`Social shell must carry exactly one ${pattern.source}`)
  return html.replace(pattern, (_, before: string, after: string) => `${before}${escape_html(value)}${after}`)
}
const meta = (key: string): RegExp => new RegExp(`(<meta (?:property|name)="${key}" content=")[^"]*(")`, 'g')

export const social_html = (shell: string, card: SocialCard, app_url: string): string => {
  const title = `${card.title} · AresRPG`
  const url = new URL(card.route.slice(1), app_url).href
  const image = new URL(card.image.slice(1), app_url).href
  return (
    [
      [/(<title>)[^<]*(<\/title>)/g, title],
      [/(<link rel="canonical" href=")[^"]*(")/g, url],
      [meta('description'), card.description],
      [meta('og:title'), title],
      [meta('og:description'), card.description],
      [meta('og:url'), url],
      [meta('og:image'), image],
      [meta('og:image:alt'), card.title],
      [meta('twitter:title'), title],
      [meta('twitter:description'), card.description],
      [meta('twitter:image'), image],
      [meta('twitter:image:alt'), card.title],
    ] as const
  ).reduce((html, [pattern, value]) => swap(html, pattern, value), shell)
}

export const social_cards_plugin = (
  directories: SocialDirectories,
  render: Readonly<{ app_url: string; font_path: string; logo_path: string; tokens_path: string }>
): Plugin => ({
  name: 'aresrpg-social-cards',
  apply: 'build',
  writeBundle: async ({ dir }) => {
    if (!dir) return
    const emit = async (path: string, source: string | Uint8Array) => {
      await mkdir(dirname(join(dir, path)), { recursive: true })
      await writeFile(join(dir, path), source)
    }
    const { cards, encyclopedia } = await social_catalog(directories)
    const renderer = await create_social_renderer(render)
    const shell = await readFile(join(dir, 'index.html'), 'utf8')
    for (const name of await readdir(directories.cards_dir))
      await emit(`social/${name}`, await readFile(join(directories.cards_dir, name)))
    await emit(ENCYCLOPEDIA_IMAGE.slice(1), await renderer.encyclopedia(encyclopedia))
    for (const card of cards) {
      if (card.entity) await emit(card.image.slice(1), await renderer.entity(card.entity))
      await emit(`${card.route.slice(1)}/index.html`, social_html(shell, card, render.app_url))
    }
  },
})
