// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Link previews for crawlers, which never run the application. Each shareable route gets a copy of the built shell
// with its own title, description and card; the application boots from it unchanged. Every card image is painted
// here at build time by the one card painter, from the site's copy and `seed/content`, so none can go stale.

import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { class_names } from '@aresrpg/immutable'
import type { Plugin } from 'vite'
import { parse } from 'yaml'

import { character_model_basenames } from './src/content/character_model_catalog.ts'
import { docs_path } from './src/docs/routes.ts'
import { SITE_ADDRESSES, SITE_PAGES, type SitePage } from './src/site/routes.ts'
import {
  create_card_painter,
  type ArtCard,
  type Card,
  type CardBar,
  type CardTone,
  type EntityCard,
  type PageObject,
} from './social_card_render.ts'

export type SocialDirectories = Readonly<{
  content_dir: string
  copy_path: string
  icons_dir: string
}>
/** One shareable route: its title, description and the card image its tags point at. */
export type SocialCard = Readonly<{ description: string; image: string; route: string; title: string }>
/** One image the build paints: its path under the site and what it shows. Routes may share an image. */
export type SocialImage = Readonly<{ image: string; card: Card }>
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
type Words = Readonly<Record<string, string>>
type Copy = Readonly<{
  agent_page: Words
  characters_page: Readonly<{ stat: Words }>
  docs_page: Readonly<{ title: string; overview: Readonly<{ counts: Words }> }>
  encyclopedia_page: Readonly<{
    world_role: Words
    world_protector: string
    items: string
    mobs: string
    classes: string
  }>
  item_categories: Words
  portfolio_page: Words
  simulator_page: Words
  ui: Words
}>

const ENCYCLOPEDIA_IMAGE = '/social/encyclopedia.jpg'
const MOSAIC_TILES = 12
const JPEG_QUALITY = 84
const frontend_file = (path: string): string => fileURLToPath(new URL(path, import.meta.url))
const titleize = (value: string): string =>
  value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
const range = (min: number, max: number): string => (min === max ? String(min) : `${min} – ${max}`)
/** A copy key the cards need; a missing one is a broken contract, never a blank label. */
const word = (words: Words, key: string): string => {
  const value = words[key]
  if (value === undefined) throw new Error(`Social card copy is missing: ${key}`)
  return value
}
/** The address a card prints: the site's host, then the route (the home is the host alone). */
const address_of = (app_url: string, route: string): string => {
  const url = new URL(route === SITE_PAGES[0].path ? '' : route.slice(1), app_url)
  return `${url.host}${url.pathname}`.replace(/\/$/, '')
}

/** What the page cards draw from content and copy: named art, captioned item cards and the docs' figures. */
type PageKit = Readonly<{
  copy: Copy
  item: (item_type: string) => ArtCard
  item_art: (item_type: string) => string
  character_art: (basename: string) => string
  mosaic: readonly string[]
  counts: readonly (readonly [number, string])[]
}>
type PageSpec = Readonly<{
  image: string
  routes: readonly string[]
  tone: CardTone
  headline: string
  sub: string
  show: (kit: PageKit) => Readonly<{ bar: CardBar; object: PageObject }>
}>
const lit = (page: SitePage | null): CardBar => ({ lit: page })
/** The items the portfolio card's bag shows. */
const BAG = Object.freeze([
  'drakar',
  'cloudstep_greaves',
  'crowani_scale_ring',
  'webbound_pendant',
  'misui_razorfins',
  'gravebrand',
  'galeweb_spiral',
  'emberweb_locket',
  'pincer_lance',
  'lorito_hat__chance',
  'salvagers_cleaver',
  'misui_iris',
])

/** The site's page cards: the approved headlines and sub lines, and what each one shows. The first is the home's. */
const PAGE_CARDS: readonly PageSpec[] = Object.freeze([
  {
    image: 'marketplace',
    routes: [SITE_ADDRESSES.market],
    tone: 'bone',
    headline: 'Buy and sell heroes and gear for SUI.',
    sub: 'The market of AresRPG, an on-chain MMORPG. Play the game when you want.',
    show: ({ copy, item, character_art }) => ({
      bar: lit('market'),
      object: {
        kind: 'shelf',
        cards: [
          {
            art: character_art('senshi_female'),
            name: titleize('senshi'),
            caption: `${word(copy.ui, 'character')} · ${word(copy.simulator_page, 'class_senshi_title')}`,
            fill: true,
          },
          ...['sunbound_concord', 'lorito_cloak__golden', 'five_biome_greatbow'].map(item),
        ],
      },
    }),
  },
  {
    image: 'world',
    routes: [SITE_ADDRESSES.world],
    tone: 'bone',
    headline: 'Enter the world.',
    sub: 'Explore, fight and trade in a voxel world where every action settles on Sui.',
    show: () => ({ bar: lit(null), object: { kind: 'capture', art: frontend_file('./src/assets/social/world.png') } }),
  },
  {
    image: 'agents',
    routes: [SITE_ADDRESSES.agent],
    tone: 'ember',
    headline: 'Let your AI play your heroes.',
    sub: 'Connect your AI assistant. It plays with a wallet of its own, and you stay in charge.',
    show: ({ copy, character_art }) => ({
      bar: lit('agent'),
      object: {
        kind: 'facts',
        tabs: [word(copy.ui, 'wallet_game'), word(copy.ui, 'wallet_bot')],
        lit: 1,
        art: character_art('yogan_female'),
        facts: ['wallet', 'log', 'charge'].map(
          (fact) => [word(copy.agent_page, `stage_${fact}_title`), word(copy.agent_page, `stage_${fact}`)] as const
        ),
      },
    }),
  },
  {
    image: 'kares',
    routes: [SITE_ADDRESSES.staking],
    tone: 'sky',
    headline: "Stake KARES. Share the market's royalties.",
    sub: 'Stakers share collected marketplace royalties, paid in SUI.',
    show: () => ({ bar: lit('staking'), object: { kind: 'coin', art: frontend_file('./public/kares.png') } }),
  },
  {
    image: 'leaderboard',
    routes: [SITE_ADDRESSES.leaderboards],
    tone: 'bone',
    headline: 'Who runs the world?',
    sub: 'Combat, dungeons, professions and trade, ranked every month from on-chain play.',
    show: ({ character_art }) => ({
      bar: lit('leaderboards'),
      object: {
        kind: 'podium',
        arts: [character_art('senshi_female'), character_art('ikari_male'), character_art('tomoda_male')],
      },
    }),
  },
  {
    image: 'portfolio',
    routes: [SITE_ADDRESSES.portfolio],
    tone: 'bone',
    headline: 'Everything you own, in one place.',
    sub: 'Your heroes, items and listings on Sui, on your game account and on your bot.',
    show: ({ copy, item_art }) => ({
      bar: lit('portfolio'),
      object: {
        kind: 'bag',
        tabs: ['tab_heroes', 'tab_bag', 'tab_for_sale'].map((key) => word(copy.portfolio_page, key)),
        lit: 1,
        arts: BAG.map(item_art),
      },
    }),
  },
  {
    image: 'gift',
    routes: ['/gift', '/claim'],
    tone: 'bone',
    headline: 'A gift is waiting for you.',
    sub: 'Sign in with Google to claim it into your AresRPG game wallet.',
    show: ({ item }) => ({
      bar: { crumb: ['Gift'] },
      object: { kind: 'shelf', cards: [{ ...item('sui_crate'), caption: 'Basecamp edition', fill: true }] },
    }),
  },
  {
    image: 'encyclopedia',
    routes: [SITE_ADDRESSES.docs, ...(['items', 'bestiary', 'classes'] as const).map((section) => docs_path(section))],
    tone: 'bone',
    headline: 'Every item, mob, class and spell.',
    sub: 'Guides and the full reference of AresRPG.',
    show: ({ copy, mosaic, counts }) => ({
      bar: { crumb: [copy.docs_page.title] },
      object: { kind: 'mosaic', arts: mosaic, counts },
    }),
  },
] satisfies readonly PageSpec[])

/** A page card's title is its headline without the closing full stop. */
const title_of = (headline: string): string => headline.replace(/\.$/, '')
const image_path = (name: string): string => `/social/${name}.jpg`
const HOME = PAGE_CARDS.find(({ routes }) => routes.includes(SITE_PAGES[0].path))!

/** The root document's own preview: the home's card, so the site's default and its home cannot differ. */
export const home_preview = (app_url: string): Readonly<{ description: string; image_url: string; alt: string }> => ({
  description: HOME.sub,
  image_url: new URL(image_path(HOME.image).slice(1), app_url).href,
  alt: title_of(HOME.headline),
})

const read_json = async <T>(path: string): Promise<T> => JSON.parse(await readFile(path, 'utf8')) as T
/** Resolves a content slug to its best authored icon, or null when no art exists yet. */
const art_lookup = async (directory: string) => {
  const names = new Set(await readdir(directory))
  return (slug: string): string | null => {
    const name = [`${slug}_hd.png`, `${slug}.png`].find((candidate) => names.has(candidate))
    return name ? join(directory, name) : null
  }
}
const required = (lookup: (slug: string) => string | null) => (slug: string) => {
  const path = lookup(slug)
  if (!path) throw new Error(`Social card art is missing: ${slug}`)
  return path
}

type Entry = Readonly<{ social: SocialCard; image: SocialImage | null }>
type EntityFacts = Omit<EntityCard, 'kind' | 'bar' | 'address' | 'art'>
/** An entry's card, or the docs card when the entry has no art of its own: it never borrows another entry's art. */
const entity_entry = (
  app_url: string,
  [kind, slug, route, description]: readonly [string, string, string, string],
  [section, art]: readonly [string, string | null],
  facts: EntityFacts,
  docs_title: string
): Entry => {
  const image = art ? `/social/${kind}/${slug}.jpg` : ENCYCLOPEDIA_IMAGE
  const card: Card | null = art
    ? { ...facts, kind: 'entity', art, bar: { crumb: [docs_title, section] }, address: address_of(app_url, route) }
    : null
  return Object.freeze({
    social: Object.freeze({ description, image, route, title: facts.name }),
    image: card && Object.freeze({ image, card }),
  })
}

type Catalog = Readonly<{
  copy: Copy
  items: readonly Item[]
  mobs: readonly Mob[]
  spells: readonly Spell[]
  art: Readonly<Record<'items' | 'mobs' | 'characters', (slug: string) => string | null>>
  app_url: string
}>

const item_entry = ({ copy, art, app_url }: Catalog, item: Item): Entry => {
  const category = copy.item_categories[item.category] ?? titleize(item.category)
  const { min = {}, max = {} } = item.stats ?? {}
  const stats = Object.keys(min)
    .filter((stat) => min[stat] || max[stat])
    .map((stat) => [copy.characters_page.stat[stat] ?? titleize(stat), range(min[stat]!, max[stat] ?? 0)] as const)
  const detail = `Level ${item.level}`
  const route = docs_path('items', item.item_type)
  const description = [`${category} · ${detail}`, ...stats.slice(0, 4).map(([label, value]) => `${label} ${value}`)]
  return entity_entry(
    app_url,
    ['item', item.item_type, route, description.join(' · ')],
    [copy.encyclopedia_page.items, art.items(item.item_type)],
    {
      tone: 'bone',
      accent: category,
      detail,
      name: item.name,
      rows: stats.length ? stats : [['Category', category] as const, ['Level', String(item.level)] as const],
      bust: false,
    },
    copy.docs_page.title
  )
}
/** A mob's role in the docs' own words; a role the docs do not name is left out. */
const role_word = (copy: Copy, role: string): string | null =>
  ({
    normal: copy.encyclopedia_page.world_role.trash,
    archi: copy.encyclopedia_page.world_role.archi,
    boss: copy.encyclopedia_page.world_role.boss,
    protector: copy.encyclopedia_page.world_protector,
  })[role] ?? null
const ELEMENT_TONES: Readonly<Record<string, CardTone>> = Object.freeze({ fire: 'ember', water: 'sky' })
const mob_entry = ({ copy, art, app_url }: Catalog, mob: Mob): Entry => {
  const level = `Level ${range(mob.level_min, mob.level_max)}`
  const detail = [role_word(copy, mob.role), level].filter(Boolean).join(' · ')
  const element = titleize(mob.element)
  const route = docs_path('bestiary', mob.mob_type)
  return entity_entry(
    app_url,
    [
      'mob',
      mob.mob_type,
      route,
      `${element} ${detail} · ${mob.hp.toLocaleString('en-US')} HP · ${mob.ap} AP · ${mob.mp} MP`,
    ],
    [copy.encyclopedia_page.mobs, art.mobs(mob.mob_type)],
    {
      tone: ELEMENT_TONES[mob.element] ?? 'bone',
      accent: element,
      detail,
      name: mob.name,
      rows: [
        ['Health', mob.hp.toLocaleString('en-US')],
        ['Action / Movement', `${mob.ap} AP · ${mob.mp} MP`],
        ['Agility', String(mob.agility)],
        ['Spells', mob.spells.map(({ name }) => name).join(' · ')],
      ],
      bust: false,
    },
    copy.docs_page.title
  )
}
const class_entry = ({ copy, art, spells, app_url }: Catalog, classe: string): Entry => {
  const role = copy.simulator_page[`class_${classe}_title`] ?? titleize(classe)
  const book = spells.filter((spell) => spell.classe === classe).toSorted((a, b) => a.unlock_level - b.unlock_level)
  // Classes still borrowing another class's model have no portrait of their own to show.
  const portrait = character_model_basenames(classe, true).body
  const route = docs_path('classes', classe)
  return entity_entry(
    app_url,
    ['classe', classe, route, `${role} · ${book.length} spells. One of ${class_names.length} classes in AresRPG.`],
    [copy.encyclopedia_page.classes, portrait.startsWith(classe) ? art.characters(portrait) : null],
    {
      tone: 'ember',
      accent: 'Class',
      detail: role,
      name: titleize(classe),
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
      bust: true,
    },
    copy.docs_page.title
  )
}

const page_kit = (catalog: Catalog, recipes: number): PageKit => {
  const { copy, items, mobs, spells, art } = catalog
  const item_art = required(art.items)
  const by_type = new Map(items.map((item) => [item.item_type, item]))
  const item = (item_type: string): ArtCard => {
    const found = by_type.get(item_type)
    if (!found) throw new Error(`Social card item is missing: ${item_type}`)
    const category = copy.item_categories[found.category] ?? titleize(found.category)
    return { art: item_art(item_type), name: found.name, caption: `${category} · Lv. ${found.level}`, fill: false }
  }
  // The docs card's mosaic: equipment spread across the levels, highest first.
  const equipment = items
    .filter((entry) => entry.stats && art.items(entry.item_type))
    .toSorted((a, b) => b.level - a.level || a.item_type.localeCompare(b.item_type))
  const stride = Math.max(1, Math.floor(equipment.length / MOSAIC_TILES))
  const { counts } = copy.docs_page.overview
  return {
    copy,
    item,
    item_art,
    character_art: required(art.characters),
    mosaic: equipment
      .filter((_, index) => index % stride === 0)
      .slice(0, MOSAIC_TILES)
      .map(({ item_type }) => item_art(item_type)),
    counts: [
      [items.length, word(counts, 'items')],
      [mobs.length, word(counts, 'mobs')],
      [spells.length, word(counts, 'spells')],
      [recipes, word(counts, 'recipes')],
    ],
  }
}

export const social_catalog = async (
  { content_dir, copy_path, icons_dir }: SocialDirectories,
  app_url: string
): Promise<Readonly<{ cards: readonly SocialCard[]; images: readonly SocialImage[] }>> => {
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
  const catalog: Catalog = {
    copy,
    items,
    mobs,
    spells,
    art: { items: item_art!, mobs: mob_art!, characters: class_art! },
    app_url,
  }
  const kit = page_kit(catalog, recipes.length)
  const pages = PAGE_CARDS.map((spec) => {
    const { bar, object } = spec.show(kit)
    const card: Card = {
      kind: 'page',
      tone: spec.tone,
      bar,
      address: address_of(app_url, spec.routes[0]!),
      headline: spec.headline,
      sub: spec.sub,
      object,
    }
    const image = image_path(spec.image)
    return {
      cards: spec.routes.map((route) => ({ description: spec.sub, image, route, title: title_of(spec.headline) })),
      image: { image, card },
    }
  })
  const entries = [
    ...items.map((item) => item_entry(catalog, item)),
    ...mobs.map((mob) => mob_entry(catalog, mob)),
    ...class_names.map((classe) => class_entry(catalog, classe)),
  ]
  return Object.freeze({
    cards: Object.freeze([...pages.flatMap(({ cards }) => cards), ...entries.map(({ social }) => social)]),
    images: Object.freeze([
      ...pages.map(({ image }) => image),
      ...entries.flatMap(({ image }) => (image ? [image] : [])),
    ]),
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

export const social_cards_plugin = (directories: SocialDirectories, app_url: string): Plugin => ({
  name: 'aresrpg-social-cards',
  apply: 'build',
  writeBundle: async ({ dir }) => {
    if (!dir) return
    const emit = async (path: string, source: string | Uint8Array) => {
      await mkdir(dirname(join(dir, path)), { recursive: true })
      await writeFile(join(dir, path), source)
    }
    const { cards, images } = await social_catalog(directories, app_url)
    const painter = await create_card_painter()
    // A card's page is a copy of the document that serves its address: the game's under `/world`, else the site's.
    const [site, world] = await Promise.all(
      ['index.html', 'world.html'].map((file) => readFile(join(dir, file), 'utf8'))
    )
    const shell_of = (route: string): string => (route === '/world' || route.startsWith('/world/') ? world! : site!)
    for (const { image, card } of images)
      await emit(image.slice(1), await (await painter.paint(card)).encode('jpeg', JPEG_QUALITY))
    for (const card of cards)
      await emit(`${card.route.slice(1)}/index.html`, social_html(shell_of(card.route), card, app_url))
  },
})
