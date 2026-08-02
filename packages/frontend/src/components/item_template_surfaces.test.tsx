// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// item_template_surfaces.test.tsx — RED-FIRST for #856: the last item-template surfaces resolved their
// template out of the BUNDLED seed catalog (`@aresrpg/sdk/items-data`, reached through
// pages/encyclopedia/content.ts), which this repo ships as `{}` by construction — the content boundary. A
// lookup against `{}` never matches, so every one of these surfaces printed a raw underscored slug (or a
// bare chain name) where a published, localized name belongs, and the hover card could never tell "this
// template authors stats, the roll is missing" from "this item has no stats". Same class as the jobs drawer
// (#765), the recipe detail (#821) and the level-unlock panel (#800); this is its items half.
//
// WHAT DRIVES WHAT: the corpus hook is the ONE spy seam (`useItemCorpus`) — the surfaces reach it through
// pages/encyclopedia/item_lookup.ts, which imports it as a namespace for exactly that reason. States are
// built through the REAL projection (`item_corpus_from_v1`) from REAL `/v1` wire rows, never hand-shaped
// objects, so a change to the wire decode surfaces here too. The hover tooltip is driven through
// `useTooltipDetail` because TooltipPortal renders via createPortal, which the SSR harness cannot resolve.

import { readFileSync } from 'node:fs'

import { describe, expect, spyOn, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import i18next from 'i18next'
import { I18nextProvider } from 'react-i18next'

import en from '../i18n/locales/en.json'
import encyclopedia_fixture from '../rpc/fixtures/encyclopedia.json'
import type { RpcEncyclopediaItem } from '../rpc/views'
import type { ItemInfo } from '../types/chain'
import * as item_corpus from '../pages/encyclopedia/item_corpus'
import { useItemLookup } from '../pages/encyclopedia/item_lookup'

import { ItemTooltipContent } from './items'
import { useTooltipDetail } from './item_hover_tooltip'

const test_i18n = i18next.createInstance()
void test_i18n.init({
  lng: 'en',
  resources: { en: { translation: en } },
  interpolation: { escapeValue: false },
})

// The fixtures speak REAL seeded template ids so the surfaces are exercised on the shapes they actually
// render (no id whitelist gates them any more — #1467: the live rows are the corpus).
const LIVING_IDS = encyclopedia_fixture.items.map(({ template_id }) => template_id)

// The /v1 stat projection serves the on-chain StatsMin/MaxKey ranges BIASED at 32768 (a stat is signed, the
// chain field is not) — writing plain 3/9 here would test the decoder against itself.
const STAT_BIAS = 32768

const wire = (index: number, over: Partial<RpcEncyclopediaItem> = {}): RpcEncyclopediaItem => ({
  template_id: LIVING_IDS[index],
  item_type: `art_slug_${index}`,
  name: `Published Name ${index}`,
  description: `Published description ${index}`,
  level: 40 + index,
  category: 'helmet',
  stats: { vitality: [STAT_BIAS + 3, STAT_BIAS + 9] },
  damages: [],
  supply: 1,
  last_sale_mist: null,
  ...over,
})

/** The two states a mounted surface can be in, both built through the REAL projection. */
const cold: item_corpus.ItemCorpus = { items: [], by_id: new Map(), loading: true }
const landed = (rows: RpcEncyclopediaItem[]): item_corpus.ItemCorpus => {
  const items = item_corpus.item_corpus_from_v1(rows)
  return { items, by_id: new Map(items.map((item) => [item.id, item])), loading: false }
}

const render_against = (state: item_corpus.ItemCorpus, node: React.ReactElement): string => {
  const spy = spyOn(item_corpus, 'useItemCorpus').mockImplementation(() => state)
  try {
    return renderToStaticMarkup(<I18nextProvider i18n={test_i18n}>{node}</I18nextProvider>)
  } finally {
    spy.mockRestore()
  }
}

const text_of = (html: string): string =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

// ── the class fence ───────────────────────────────────────────────────────────────────────────────

describe('the item-template surfaces read the LIVE corpus, never the bundled seed catalog (#856)', () => {
  const SURFACES = ['../pages/shop.tsx', './items.tsx', './item_hover_tooltip.tsx'] as const

  test.each(SURFACES)('%s resolves item templates through the /v1 door', (path) => {
    const source = readFileSync(new URL(path, import.meta.url), 'utf8')
    // The bundled door — `use_content()` over @aresrpg/sdk/items-data — is `{}` by construction here, so a
    // surface reaching for it renders empty on every real deployment. Not "prefer the live door": absent.
    expect(source).not.toContain('encyclopedia/content')
    expect(source).not.toContain('items-data')
    expect(source).toContain('useItemLookup')
  })
})

// ── the shared door ───────────────────────────────────────────────────────────────────────────────

function LookupProbe({ keys }: Readonly<{ keys: string[] }>) {
  const { find, name_of, loading } = useItemLookup()
  return (
    <div>
      <span id="loading">{String(loading)}</span>
      {keys.map((key) => (
        <span key={key}>{`[${name_of(key)}|${find(key)?.level ?? '-'}]`}</span>
      ))}
    </div>
  )
}

describe('useItemLookup — one row out of the published corpus', () => {
  test('a cold corpus says LOADING and humanizes the key — it never invents a row', () => {
    const html = render_against(cold, <LookupProbe keys={['moon_helmet']} />)
    expect(html).toContain('<span id="loading">true</span>')
    expect(text_of(html)).toContain('[moon helmet|-]')
  })

  test('a landed corpus resolves by the template OBJECT id and by the authored ART SLUG alike', () => {
    const html = render_against(landed([wire(0)]), <LookupProbe keys={[LIVING_IDS[0], 'art_slug_0']} />)
    expect(text_of(html)).toContain('[Published Name 0|40] [Published Name 0|40]')
    expect(html).toContain('<span id="loading">false</span>')
  })

  test('a template the live game no longer mints stays an honest gap, never a fabricated name', () => {
    const html = render_against(landed([wire(0)]), <LookupProbe keys={['retired_relic']} />)
    expect(text_of(html)).toContain('[retired relic|-]')
  })
})

// ── the surfaces ──────────────────────────────────────────────────────────────────────────────────

const OWNED_ITEM: ItemInfo = {
  id: '0xowned',
  template_id: 'art_slug_0', // a minted Item carries the authored art slug, never the template object id
  quantity: 1,
  stats_json: '{}',
  slot: '',
  name: '',
  description: '',
  rarity: 'common',
  category: 'HELMET',
  level: 40,
  damages_json: '[]',
  consumable_json: 'null',
  particle_trail_json: 'null',
  appearance: '',
  weapon_class: '',
  pet_power: 0,
  pet_stats_json: '{}',
} as unknown as ItemInfo

describe('ItemTooltipContent — the bag/hover cell', () => {
  test('the empty root printed the raw slug; the landed corpus prints the published name + description', () => {
    expect(text_of(render_against(cold, <ItemTooltipContent item={OWNED_ITEM} />))).toContain('art slug 0')

    const text = text_of(render_against(landed([wire(0)]), <ItemTooltipContent item={OWNED_ITEM} />))
    expect(text).toContain('Published Name 0')
    expect(text).toContain('Published description 0')
    expect(text).not.toContain('art slug 0')
  })
})

function TooltipDetailProbe({ item }: Readonly<{ item: ItemInfo }>) {
  const detail = useTooltipDetail(item, undefined, null)
  return (
    <div>
      <span id="name">{detail.name}</span>
      <span id="unavailable">{String(detail.stats_unavailable)}</span>
    </div>
  )
}

describe('the marketplace hover tooltip', () => {
  test('an unrolled instance of a stat-authoring template says so — the empty root could not know it did', () => {
    // to_detail_item's own last resort is the raw key the instance carries (it has no published row to
    // humanize against) — the un-named cell #856 reports.
    const cold_html = render_against(cold, <TooltipDetailProbe item={OWNED_ITEM} />)
    expect(cold_html).toContain('<span id="name">art_slug_0</span>')
    expect(cold_html).toContain('<span id="unavailable">false</span>')

    const html = render_against(landed([wire(0)]), <TooltipDetailProbe item={OWNED_ITEM} />)
    expect(html).toContain('<span id="name">Published Name 0</span>')
    // the template authors vitality [3,9] and this instance carries no roll — the honest "unavailable" line
    expect(html).toContain('<span id="unavailable">true</span>')
  })
})
