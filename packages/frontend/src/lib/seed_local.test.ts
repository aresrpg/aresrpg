// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Fixtures-only unit test for the seed-local mapper (never reads live seed — another lane rewrites those files,
// so live counts would flap the suite). Proves: file-kind routing, world derivation, dedup, and that the
// modal `default_prompt` mirrors the census `one_line(description)` rule.
import { test, expect, describe } from 'bun:test'

import { map_seed_corpus, census_prompt, map_seed_worldmobs, seed_i18n_json, type SeedRow } from './seed_local'

const P = '/repo/aresrpg/seed/mainnet'

const FILES: Record<string, any> = {
  [`${P}/01_first_shore/items.json`]: [
    {
      // Realistic weapon: seed itemType is the wielding CLASS (rojin), category is the semantic type (AXE).
      slug: 'chipped_axe',
      name: 'Chipped Axe',
      itemType: 'rojin',
      category: 'AXE',
      level: 5,
      quality: 'COMMON',
      description: 'The blade has more chips than a bag of crisps. Truly a sorry sight.',
    },
    { slug: 'no_desc_ring', name: 'Plain Ring', itemType: 'ring', category: 'RING', level: 2 },
  ],
  [`${P}/01_first_shore/resources.json`]: [
    { slug: 'wheat', name: 'Wheat', itemType: 'resource', category: 'RESOURCE', level: 1, description: 'A grain.' },
  ],
  [`${P}/05_drowned_fen/items.json`]: [
    {
      slug: 'pet_moonstone_cactee',
      name: 'Moonstone Cactee',
      itemType: 'pet',
      category: 'PET',
      level: 32,
      quality: 'RARE',
      description: 'Only visible during full moons.',
    },
  ],
  [`${P}/shop.json`]: {
    _meta: { ignore: true },
    cosmetics: [
      {
        slug: 'coiffe_pepe_royal',
        name: 'Pepe Royal Crown',
        itemType: 'hat',
        category: 'hat',
        quality: 'LEGENDARY',
        icon: 'coiffe_pepe_royal',
        description: 'The pepe ascended.',
      },
    ],
    pets: [
      {
        slug: 'aetherwing',
        name: 'Aetherwing',
        itemType: 'pet',
        category: 'PET',
        quality: 'RARE',
        element: 'chaos',
        icon: 'aetherwing',
      },
    ],
  },
  [`${P}/spells/senshi.json`]: [
    {
      id: 'senshi_earthen_cleave',
      name: 'Earthen Cleave',
      element: 'earth',
      unlock: 1,
      classType: 'senshi',
      description_key: 'spell.senshi_earthen_cleave.desc',
    },
  ],
  // Ignored kinds — must not produce rows:
  [`${P}/01_first_shore/mobs.json`]: [{ slug: 'fs_shorecrab', name: 'Shorecrab' }],
  [`${P}/01_first_shore/recipes.json`]: [{ slug: 'r1' }],
  [`${P}/01_first_shore/world.json`]: { id: '01_first_shore' },
  [`${P}/01_first_shore/icon_requests.json`]: ['crab_shell'],
}

const rows = map_seed_corpus(FILES)
const by_slug = (s: string) => rows.find((r) => r.slug === s) as SeedRow

describe('map_seed_corpus', () => {
  test('maps items, resources, shop cosmetics+pets, spells and ignores mobs/recipes/world/icon_requests', () => {
    const slugs = rows.map((r) => r.slug).sort()
    expect(slugs).toEqual(
      [
        'aetherwing',
        'chipped_axe',
        'coiffe_pepe_royal',
        'no_desc_ring',
        'pet_moonstone_cactee',
        'senshi_earthen_cleave',
        'wheat',
      ].sort()
    )
  })

  test('item_type = category (semantic type for the generator), NOT the class-bearing seed itemType', () => {
    const axe = by_slug('chipped_axe')
    expect(axe).toMatchObject({
      kind: 'item',
      item_type: 'AXE', // category — not 'rojin' (the wielding class in the seed itemType)
      category: 'AXE',
      level: 5,
      world: '01_first_shore',
      quality: 'COMMON',
      icon_kind: 'item',
    })
  })

  test('resource keeps RESOURCE category on the item icon path', () => {
    expect(by_slug('wheat')).toMatchObject({
      category: 'RESOURCE',
      kind: 'item',
      icon_kind: 'item',
      world: '01_first_shore',
    })
  })

  test('shop rows land under world=shop; pet carries its element', () => {
    expect(by_slug('coiffe_pepe_royal').world).toBe('shop')
    expect(by_slug('aetherwing')).toMatchObject({ world: 'shop', category: 'PET', elements: ['chaos'] })
  })

  test('spell row: id→slug, spell kind + spell icon path, unlock→level, classType→world', () => {
    expect(by_slug('senshi_earthen_cleave')).toMatchObject({
      kind: 'spell',
      item_type: 'spell',
      category: 'SPELL',
      icon_kind: 'spell',
      level: 1,
      world: 'senshi',
      elements: ['earth'],
    })
  })

  test('default_prompt on an item = census one-liner (first sentence of its description)', () => {
    expect(by_slug('chipped_axe').default_prompt).toBe('The blade has more chips than a bag of crisps.')
  })

  test('default_prompt on a spell derives from element + name', () => {
    expect(by_slug('senshi_earthen_cleave').default_prompt).toBe('A earth spell: Earthen Cleave.')
  })

  test('dedup by icon_kind:slug (later file wins, no duplicate rows)', () => {
    const dupe = map_seed_corpus({
      [`${P}/a/items.json`]: [{ slug: 'x', name: 'A', category: 'RING' }],
      [`${P}/b/items.json`]: [{ slug: 'x', name: 'B', category: 'RING' }],
    })
    expect(dupe).toHaveLength(1)
    expect(dupe[0].name).toBe('B')
  })

  test('drops rows without a slug/id', () => {
    expect(map_seed_corpus({ [`${P}/z/items.json`]: [{ name: 'no slug' }] })).toHaveLength(0)
  })
})

describe('map_seed_worldmobs (mobs/worlds/recipes — the SEEDS admin + World tab join)', () => {
  const WM_FILES: Record<string, any> = {
    [`${P}/01_first_shore/mobs.json`]: [
      {
        key: 'fs_shorecrab',
        name: 'Shore Crab',
        appearance: 'Crab',
        role: 'trash',
        minLevel: 1,
        maxLevel: 3,
        hp: 35,
        element: 'water',
        stats: { chance: 12 },
        loot: [{ item: 'crab_shell', chance: 0.5, min: 1, max: 2 }],
        xp: 10,
        i18n: { fr: { name: 'Crabe de Rivage', description: 'Un crabe.' } },
      },
    ],
    // Same mob key reappearing in a second world folder — worlds must union, not overwrite.
    [`${P}/02_verdant_hollow/mobs.json`]: [
      { key: 'fs_shorecrab', name: 'Shore Crab', minLevel: 1, maxLevel: 3, hp: 35, loot: [], xp: 10 },
    ],
    [`${P}/01_first_shore/world.json`]: {
      id: '01_first_shore',
      name: 'First Shore',
      band: [1, 12],
      biome: 'archipelago',
      neutral: true,
      specialty: 'onboarding breeze',
      resources: [{ slug: 'wheat', rate: 0.9, job: 0, tier: 1, protector: 'protector_wheat' }],
      mobGroups: [{ mob: 'fs_shorecrab', rate: 0.8 }],
      dungeonKey: 'sounding_hull_key',
      dungeonRooms: [['fs_shorecrab', 'fs_driftling']],
    },
    [`${P}/01_first_shore/recipes.json`]: [
      {
        label: 'craft_woolamu',
        job: 'jeweler',
        output: 'woolamu',
        outQty: 1,
        inputs: [{ slug: 'tide_pearl', qty: 1 }],
        craft_xp: 23,
      },
    ],
    // Ignored kinds — must not produce rows here (they're map_seed_corpus's job).
    [`${P}/01_first_shore/items.json`]: [{ slug: 'wheat', name: 'Wheat', category: 'RESOURCE' }],
  }
  const { mobs, worlds, recipes } = map_seed_worldmobs(WM_FILES)

  test('mob rows union worlds across every folder the key appears in (deduped by id)', () => {
    expect(mobs).toHaveLength(1)
    expect(mobs[0]).toMatchObject({ id: 'fs_shorecrab', name: 'Shore Crab', role: 'trash' })
    expect(Array.isArray(mobs[0].worlds)).toBe(true)
    expect(mobs[0].worlds.slice().sort()).toEqual(['01_first_shore', '02_verdant_hollow'])
  })

  test('mob i18n block flattens to the flat name/description i18nJson use_template_t reads', () => {
    expect(JSON.parse(mobs[0].i18nJson!)).toEqual({ name: { fr: 'Crabe de Rivage' }, description: { fr: 'Un crabe.' } })
  })

  test('world row carries band/biome/resources/mobGroups/dungeon', () => {
    expect(worlds).toHaveLength(1)
    expect(worlds[0]).toMatchObject({
      id: '01_first_shore',
      name: 'First Shore',
      band: [1, 12],
      biome: 'archipelago',
      dungeonKey: 'sounding_hull_key',
    })
    expect(worlds[0].resources[0]).toMatchObject({ slug: 'wheat', job: 0, tier: 1 })
    expect(worlds[0].dungeonRooms).toEqual([['fs_shorecrab', 'fs_driftling']])
  })

  test('recipe row keeps label as id + the job string + inputs', () => {
    expect(recipes).toHaveLength(1)
    expect(recipes[0]).toMatchObject({
      id: 'craft_woolamu',
      job: 'jeweler',
      output: 'woolamu',
      craft_xp: 23,
      world: '01_first_shore',
    })
  })
})

describe('seed_i18n_json', () => {
  test('flattens per-locale {name,description} into {name:{lang},description:{lang}}', () => {
    const out = seed_i18n_json({ fr: { name: 'Blé', description: 'Un grain.' }, de: { name: 'Weizen' } })
    expect(JSON.parse(out!)).toEqual({ name: { fr: 'Blé', de: 'Weizen' }, description: { fr: 'Un grain.' } })
  })

  test('undefined input or empty object ⇒ undefined (no i18nJson field)', () => {
    expect(seed_i18n_json(undefined)).toBeUndefined()
    expect(seed_i18n_json({})).toBeUndefined()
  })
})

describe('census_prompt (mirrors p_icon_census.one_line)', () => {
  test('takes the first sentence', () => {
    expect(census_prompt('One. Two. Three.')).toBe('One.')
  })

  test('truncates a >92-char single sentence to 90 chars + ellipsis', () => {
    const long = `${'a'.repeat(120)} end`
    const out = census_prompt(long)
    expect(out.endsWith('…')).toBe(true)
    expect(out.length).toBe(91) // 90 chars + '…'
  })

  test('no description ⇒ derived from name + category', () => {
    expect(census_prompt('', 'Plain Ring', 'RING')).toBe('A ring named Plain Ring.')
  })

  test('empty everything ⇒ empty string', () => {
    expect(census_prompt('', '', '')).toBe('')
  })
})
