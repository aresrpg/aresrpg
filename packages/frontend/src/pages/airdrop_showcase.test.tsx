// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// THE AIRDROP SHOWCASE (#803) — the door and the section, both headless: the parser is pure and the fetch is
// injected, so this suite needs no network and no jsdom.
//
// CAPTURED WIRE BYTES (code law — a decode test that encodes with the same model it decodes with proves
// nothing): airdrop_set.fixture.json is the LIVE published document, byte-for-byte.
//   GET https://assets.aresrpg.world/data/airdrop.json → 200, 8302 bytes
//   sha256 a35f050c2d0f46a0c5a127d6deace1313ec75bb54085465b773c33de5e27bf7d
//   captured 2026-07-26 (matches the serve receipt recorded on issue #803)
// The set is CONTENT: this file asserts the SHAPE the page consumes and the counts that shape implies —
// never a curated item list of its own.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import i18next from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { configure_walrus_assets, reset_walrus_assets_for_test } from '@aresrpg/sdk/jobs'

import en from '../i18n/locales/en.json'
import fr from '../i18n/locales/fr.json'
import es from '../i18n/locales/es.json'
import de from '../i18n/locales/de.json'
import ja from '../i18n/locales/ja.json'
import uk from '../i18n/locales/uk.json'

import { humanize_id, load_airdrop_set, parse_airdrop_set, type AirdropSet } from './airdrop_set'
import { AirdropShowcaseSection } from './airdrop_showcase'
import LIVE from './airdrop_set.fixture.json'

const HOST = 'https://assets.aresrpg.world'
const MANIFEST_URL = `${HOST}/data/airdrop.json`
const publish = () => configure_walrus_assets({ aggregator: HOST, classes: { airdrop: { published: true } } })

/** A fetch stand-in: `body` is served with 200, `ok: false` or a throw reproduces the failure paths. */
const serving = (body: unknown, { ok = true }: { ok?: boolean } = {}) =>
  (async () => ({ ok, json: async () => body })) as unknown as typeof fetch
const dead = (() => Promise.reject(new Error('network down'))) as unknown as typeof fetch

const test_i18n = i18next.createInstance()
test_i18n.init({ lng: 'en', resources: { en: { translation: en } }, interpolation: { escapeValue: false } })

const render_section = (state: { status: 'loading' | 'ready' | 'error'; set: AirdropSet }) =>
  renderToStaticMarkup(
    <I18nextProvider i18n={test_i18n}>
      <AirdropShowcaseSection state={state} on_retry={() => {}} />
    </I18nextProvider>
  )

const EMPTY: AirdropSet = { items: [], pending: [] }
const occurrences = (haystack: string, needle: string) => haystack.split(needle).length - 1

// The resolver only ever MERGES, and the whole suite shares one process: a file that ran earlier and
// configured the real published manifest would otherwise leave `airdrop` published here. Reset on BOTH
// edges so "the class is unpublished" is a state this file actually owns.
beforeEach(() => reset_walrus_assets_for_test())
afterEach(() => reset_walrus_assets_for_test())

describe('the door — the host is resolved, never hardcoded, and absence is never inferred', () => {
  test('an unpublished class is an ERROR, not an empty airdrop', async () => {
    expect(await load_airdrop_set({ fetch_impl: serving(LIVE) })).toEqual({ status: 'error', set: EMPTY })
  })

  test('a non-ok response and a dead request both fail as data — empty set, error status', async () => {
    publish()
    expect(await load_airdrop_set({ fetch_impl: serving(LIVE, { ok: false }) })).toEqual({
      status: 'error',
      set: EMPTY,
    })
    expect(await load_airdrop_set({ fetch_impl: dead })).toEqual({ status: 'error', set: EMPTY })
  })

  test('a served empty document is READY and empty — a fact from the host, not from a failure', async () => {
    publish()
    expect(await load_airdrop_set({ fetch_impl: serving({ items: [], pending: [] }) })).toEqual({
      status: 'ready',
      set: EMPTY,
    })
  })

  test('nothing is cached: a failure followed by a success returns the success', async () => {
    publish()
    expect((await load_airdrop_set({ fetch_impl: dead })).status).toBe('error')
    const second = await load_airdrop_set({ fetch_impl: serving(LIVE) })
    expect(second.status).toBe('ready')
    expect(second.set.items.length).toBe(14)
  })
})

describe('the LIVE published document decodes to exactly what the grid renders', () => {
  test('every row survives, and only rows the host actually serves get an icon', async () => {
    publish()
    const { status, set } = await load_airdrop_set({ fetch_impl: serving(LIVE) })
    expect(status).toBe('ready')
    // 14 ruled items + the one unruled row — the pending row is carried, never dropped.
    expect(set.items.length).toBe(LIVE.items.length)
    expect(set.pending).toEqual([{ id: 'anima', name: 'Anima' }])

    const with_icon = set.items.filter((i) => i.icon_url)
    // The degradation contract: `art_status.icon === 'present'` is the ONLY licence to render art. Every
    // glb-only row (the pets + the full-body outfit) has no icon today and must degrade, not 404.
    expect(with_icon.length).toBe(LIVE.items.filter((i) => 'icon' in i.art_status).length)
    expect(set.items.filter((i) => i.kind === 'pet_glb').every((i) => i.icon_url === null)).toBe(true)
    // Icons are re-homed onto the manifest's own origin — the mapping law's flat-art shape.
    expect(with_icon.map((i) => i.icon_url)).toEqual(with_icon.map((i) => `${HOST}/items/${i.id}.png`))
    // No .glb ever becomes an image URL.
    expect(with_icon.every((i) => i.icon_url?.endsWith('.png'))).toBe(true)
  })

  test('aura state is carried in its three honest flavours (declared, pinned, pending)', () => {
    const { items } = parse_airdrop_set(LIVE, MANIFEST_URL)
    const by_id = Object.fromEntries(items.map((i) => [i.id, i]))
    expect(by_id.sui_helmet.aura).toEqual({ color: 'water', status: 'declared' })
    expect(by_id.suicunio.aura).toEqual({ color: 'purple', status: 'pinned' })
    expect(by_id.sam.aura).toBe(null)
    expect(by_id.sam.aura_pending).toBe(true)
    expect(by_id.vaporeon.aura_pending).toBe(false)
  })

  test('internal content prose never reaches the projection', () => {
    const projected = JSON.stringify(parse_airdrop_set(LIVE, MANIFEST_URL))
    for (const leak of ['provenance', 'owner verbatim', 'session', 'seed/', '_ruled', '_art_probe'])
      expect(projected).not.toContain(leak)
  })
})

describe('the manifest is untrusted DATA', () => {
  test('a foreign origin and a path walk both land on our own host; a row with no id is dropped', () => {
    const { items } = parse_airdrop_set(
      {
        items: [
          { id: 'evil', art: { icon: 'https://evil.example/steal.png' }, art_status: { icon: 'present' } },
          { id: 'walker', art: { icon: '../../../etc/passwd.png' }, art_status: { icon: 'present' } },
          { name: 'nameless', art: {}, art_status: {} },
        ],
      },
      MANIFEST_URL
    )
    expect(items.map((i) => i.id)).toEqual(['evil', 'walker'])
    expect(items[0].icon_url).toBe(`${HOST}/steal.png`)
    expect(items[1].icon_url).toBe(`${HOST}/etc/passwd.png`)
  })

  test('every malformed shape folds to an empty set rather than a crash', () => {
    for (const body of [null, undefined, 42, 'nope', [], { items: 'nope' }])
      expect(parse_airdrop_set(body, MANIFEST_URL)).toEqual(EMPTY)
    // A row whose art the host does NOT serve keeps its tile and loses its icon.
    const { items } = parse_airdrop_set(
      { items: [{ id: 'ghost', kind: 'cosmetic', art: { icon: 'items/ghost.png' }, art_status: { icon: 'missing' } }] },
      MANIFEST_URL
    )
    expect(items).toEqual([
      { id: 'ghost', kind: 'cosmetic', name: 'Ghost', icon_url: null, aura: null, aura_pending: false },
    ])
  })

  test('humanize_id builds an honest display name for a row that carries none', () => {
    expect(humanize_id('sui_helmet')).toBe('Sui Helmet')
    expect(humanize_id('anima')).toBe('Anima')
  })
})

describe('the section renders four DISTINCT states — a cold fetch never reads as an empty airdrop', () => {
  test('loading says LOADING and never the empty copy', () => {
    const html = render_section({ status: 'loading', set: EMPTY })
    expect(html).toContain(en.common.loading)
    expect(html).not.toContain(en.airdrop.set.empty)
    expect(html).not.toContain(en.airdrop.set.error)
  })

  test('a failed load says so and offers a retry — it never claims the set is empty', () => {
    const html = render_section({ status: 'error', set: EMPTY })
    expect(html).toContain(en.airdrop.set.error)
    expect(html).toContain(en.airdrop.set.retry)
    expect(html).not.toContain(en.airdrop.set.empty)
  })

  test('a served empty set says the set is unpublished', () => {
    const html = render_section({ status: 'ready', set: EMPTY })
    expect(html).toContain(en.airdrop.set.empty)
    expect(html).not.toContain(en.airdrop.set.error)
  })

  test('the LIVE set renders every row: icons where served, glyph + PREVIEW PENDING where not', () => {
    const set = parse_airdrop_set(LIVE, MANIFEST_URL)
    const html = render_section({ status: 'ready', set })

    for (const item of set.items) expect(html).toContain(item.name)
    for (const item of set.items.filter((i) => i.icon_url)) expect(html).toContain(item.icon_url as string)
    // One PREVIEW PENDING per row without a served icon — no broken image, no blank tile.
    expect(occurrences(html, en.airdrop.set.no_preview)).toBe(set.items.filter((i) => !i.icon_url).length)
    // The unruled row is visible AS unruled, never silently dropped.
    expect(html).toContain('Anima')
    expect(html).toContain(en.airdrop.set.awaiting_ruling)
    // Kinds are localized, the declared aura is shown, and the unruled pairing says pending.
    expect(html).toContain(en.airdrop.set.kind.pet_glb)
    expect(html).toContain(en.airdrop.set.kind.title_relic)
    expect(html).toContain('water')
    expect(html).toContain(en.airdrop.set.aura_pending)
    // Showcase only — this section can never grow a claim control (#803's non-goal).
    expect(html).not.toContain(en.airdrop.claim)
    expect(html).not.toContain('<button type="button" class="btn-gold')
  })
})

describe('i18n law — the showcase copy ships in ALL six locales, same keys', () => {
  const flatten = (value: unknown, prefix = ''): string[] =>
    value && typeof value === 'object'
      ? Object.entries(value as Record<string, unknown>).flatMap(([k, v]) => flatten(v, `${prefix}${k}.`))
      : [prefix.slice(0, -1)]

  const expected = flatten(en.airdrop.set).sort()

  test.each([
    ['fr', fr],
    ['es', es],
    ['de', de],
    ['ja', ja],
    ['uk', uk],
  ])('%s carries the same airdrop.set keys, none empty', (_lang, locale) => {
    const { set } = (locale as typeof en).airdrop
    expect(flatten(set).sort()).toEqual(expected)
    for (const value of Object.values(set)) {
      if (typeof value === 'string') expect(value.trim().length).toBeGreaterThan(0)
      else for (const nested of Object.values(value)) expect(String(nested).trim().length).toBeGreaterThan(0)
    }
  })
})
