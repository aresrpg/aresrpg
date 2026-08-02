// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// loadout_picker.test.tsx — every gear picker in the simulator (all 20 slots) opened EMPTY on edge, the same
// class of bug the mob picker had (#826) and the Jobs drawer before it (#765/#800). The cause here was the
// SOURCE: the pickers read the BUNDLED seed catalog (`@aresrpg/sdk/items-data`), which this repo ships as
// `{}` by construction — the content boundary — so no corpus landing could ever have populated them.
//
// WHAT DRIVES WHAT: `useSlotPickerContent` is the picker's whole content brain — SlotPicker is a
// pass-through shell over it and renders through `createPortal`, which this repo's SSR harness cannot
// resolve (same split rationale as MobPicker.test.tsx). The corpus hook is spied for the same reason the
// mob picker spies its store: under SSR a subscription serves its initial state and would hide every later
// one. The projection those states are built from is the REAL one (`item_corpus_from_v1`), never hand-built
// rows, so a change to the wire decode surfaces here too.

import { describe, expect, test, spyOn } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import i18next from 'i18next'
import { I18nextProvider } from 'react-i18next'

import en from '../i18n/locales/en.json'
import encyclopedia_fixture from '../rpc/fixtures/encyclopedia.json'
import type { RpcEncyclopediaItem } from '../rpc/views'
import * as item_corpus from '../pages/encyclopedia/item_corpus'

import { MaxRollItemCard, picker_item_detail, useSlotPickerContent } from './LoadoutSection'

const test_i18n = i18next.createInstance()
void test_i18n.init({
  lng: 'en',
  resources: { en: { translation: en } },
  interpolation: { escapeValue: false },
})

const LIVING_IDS = encyclopedia_fixture.items.map(({ template_id }) => template_id)

const STAT_BIAS = 32768 // the /v1 stat projection's on-chain bias — see item_corpus.test.ts

const wire = (index: number, category: string): RpcEncyclopediaItem => ({
  template_id: LIVING_IDS[index],
  item_type: `art_${category}_${index}`,
  name: `Live ${category} ${index}`,
  description: null,
  level: 10 + index,
  category,
  stats: { vitality: [STAT_BIAS + 1, STAT_BIAS + 7] },
  damages: [],
  supply: 1,
  last_sale_mist: null,
})

const MIXED = [wire(0, 'helmet'), wire(1, 'boots'), wire(2, 'longsword'), wire(3, 'ring')]

/** The two states a mounted picker can be in, built through the REAL projection. */
const cold: item_corpus.ItemCorpus = { items: [], by_id: new Map(), loading: true }
const landed = (rows: RpcEncyclopediaItem[]): item_corpus.ItemCorpus => {
  const items = item_corpus.item_corpus_from_v1(rows)
  return { items, by_id: new Map(items.map((item) => [item.id, item])), loading: false }
}

/** Prints exactly what the picker hands its modal — the empty line, then one row per offered item. */
function PickerContent({ slot }: Readonly<{ slot: string }>) {
  const { items, empty_label } = useSlotPickerContent(slot)
  return (
    <div>
      <span id="empty">{empty_label ?? ''}</span>
      <span id="count">{items.length}</span>
      {items.map((item) => (
        <span key={item.id}>{item.label}</span>
      ))}
    </div>
  )
}

const render_against = (state: item_corpus.ItemCorpus, slot: string): string => {
  const spy = spyOn(item_corpus, 'useItemCorpus').mockImplementation(() => state)
  try {
    return renderToStaticMarkup(
      <I18nextProvider i18n={test_i18n}>
        <PickerContent slot={slot} />
      </I18nextProvider>
    )
  } finally {
    spy.mockRestore()
  }
}

const count_of = (html: string): number => Number(html.match(/<span id="count">(\d+)<\/span>/)?.[1] ?? -1)

describe('a gear picker over a corpus that has not landed yet', () => {
  test('reads as LOADING — never the "no results" lie about what the game contains', () => {
    const html = render_against(cold, 'helmet')
    expect(html).toContain(en.simulator.item_corpus_loading)
    expect(count_of(html)).toBe(0)
    expect(html).not.toContain(en.search_picker.no_results)
  })

  test('every slot says it, not just the first one someone tested', () => {
    for (const slot of ['helmet', 'weapon', 'left_ring', 'relic_1', 'pet', 'boots'])
      expect(render_against(cold, slot)).toContain(en.simulator.item_corpus_loading)
  })
})

describe('the corpus landing populates the picker — the empty→populated transition', () => {
  test('the helmet picker goes from 0 rows to its helmet', () => {
    expect(count_of(render_against(cold, 'helmet'))).toBe(0)

    const html = render_against(landed(MIXED), 'helmet')
    expect(count_of(html)).toBe(1)
    expect(html).toContain('Live helmet 0')
    expect(html).not.toContain(en.simulator.item_corpus_loading) // settled ⇒ the loading line is gone
  })

  test('each slot draws only its own family out of the SAME corpus', () => {
    const corpus = landed(MIXED)
    expect(render_against(corpus, 'boots')).toContain('Live boots 1')
    expect(render_against(corpus, 'weapon')).toContain('Live longsword 2')
    expect(render_against(corpus, 'left_ring')).toContain('Live ring 3')
    // and never a foreign one: the helmet picker must not offer the boots
    expect(render_against(corpus, 'helmet')).not.toContain('Live boots 1')
  })

  test('a slot the landed corpus genuinely has no gear for says NO RESULTS, not LOADING', () => {
    const html = render_against(landed(MIXED), 'pet')
    expect(count_of(html)).toBe(0)
    expect(html).not.toContain(en.simulator.item_corpus_loading)
  })

  test('a row carries the authored art slug as its icon key — a template object id would 404', () => {
    const [row] = item_corpus.item_corpus_from_v1([wire(0, 'helmet')])
    expect(row.item_type).toBe('art_helmet_0')
  })
})

// #883 ⑦ — a row said its NAME and its level and nothing else, so twenty slots were equipped blind. The
// hover (long-press on touch) now shows the game's own item card over the same published row.
describe('the hover detail a row shows BEFORE the pick', () => {
  const [row] = item_corpus.item_corpus_from_v1([wire(0, 'helmet')])

  test('the projection is the published row at its MAX ROLL — art slug, no invented fields', () => {
    const detail = picker_item_detail(row)
    expect(detail.name).toBe('Live helmet 0')
    expect(detail.level).toBe(10)
    // The SIMULATOR equips ceilings, so the card shows the ceiling: the authored [1, 7] vitality range
    // reaches it as a flat +7, the roll this build actually gets. Showing the spread would advertise a
    // roll no simulated character is ever assembled with (test/simulator/gear_hover.test.tsx pins this
    // against the `(+X)` the stat rows credit for the same item — one arithmetic, two surfaces).
    expect(detail.stats).toEqual({ vitality: 7 })
    expect(detail.image_url).toContain('art_helmet_0')
    // a TEMPLATE authors its ranges in the open — it is never an instance with a pending roll
    expect('stats_unavailable' in detail).toBe(false)
  })

  test('the SHARED card renders it — the same component the encyclopedia and the bag show', () => {
    const html = renderToStaticMarkup(
      <I18nextProvider i18n={test_i18n}>
        <MaxRollItemCard item={row} />
      </I18nextProvider>
    )
    expect(html).toContain('Live helmet 0')
    // the authored [1, 7] vitality range reaches the card decoded off its bias and collapsed to its
    // ceiling — the simulator's roll, labelled as such
    expect(html).toContain('+7')
    expect(html).toContain(en.simulator.max_roll)
  })
})
