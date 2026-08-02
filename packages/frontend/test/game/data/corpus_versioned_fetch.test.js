// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// RED-FIRST (#1237): the mutable pointer is the only short-lived URL; corpus payloads are immutable,
// version-stamped objects. Flipping v1 → v2 must become visible on the next client load without a CDN purge.
import { readFileSync } from 'node:fs'

import { afterEach, expect, mock, spyOn, test } from 'bun:test'
import { configure_assets, reset_assets_for_test } from '@aresrpg/sdk/jobs'

import { dismiss_event_toast, event_toast_store } from '../../../src/game/core/toast.js'
import { load_corpus_version } from '../../../src/game/data/corpus_asset.js'
import { get_spell_corpus, load_spell_corpus, set_spell_corpus_for_test } from '../../../src/game/data/spell_corpus.js'
import { load_world_corpus, set_world_corpus_for_test } from '../../../src/pages/encyclopedia/world_corpus.ts'
import world_fixture from '../../../src/pages/encyclopedia/world_corpus.fixture.json'

const host = 'https://assets.example'
const pointer_url = `${host}/data/corpus_version.json`
const rows_by_version = {
  v1: [{ id: 'spell-v1' }],
  v2: [{ id: 'spell-v2' }],
}

const response = (body) => ({ ok: true, json: async () => body })

afterEach(() => {
  set_spell_corpus_for_test()
  set_world_corpus_for_test()
  reset_assets_for_test()
  for (const toast of event_toast_store.get()) dismiss_event_toast(toast.id)
  mock.restore()
})

test('one pointer flip makes both new corpora visible without purging the old URLs', async () => {
  let current_version = 'v1'
  configure_assets({
    aggregator: host,
    classes: {
      spell_corpus: { published: true },
      world_corpus: { published: true },
    },
  })
  const fetch_spy = spyOn(globalThis, 'fetch').mockImplementation(async (input, options) => {
    const url = String(input)
    if (url === pointer_url) {
      expect(options).toEqual({ cache: 'no-store' })
      return response({ version: current_version })
    }
    const version = url.match(/spell_corpus\.(v[12])\.json$/)?.[1]
    if (version) return response(rows_by_version[version])
    if (/world_corpus\.v[12]\.json$/.test(url)) return response(world_fixture)
    throw new Error(`unexpected corpus URL: ${url}`)
  })
  const error_spy = spyOn(console, 'error').mockImplementation(() => {})

  const first_version = load_corpus_version()
  await Promise.all([load_spell_corpus(first_version), load_world_corpus(first_version)])
  expect(get_spell_corpus()).toEqual(rows_by_version.v1)

  set_spell_corpus_for_test()
  set_world_corpus_for_test()
  current_version = 'v2'
  const second_version = load_corpus_version()
  await Promise.all([load_spell_corpus(second_version), load_world_corpus(second_version)])
  expect(get_spell_corpus()).toEqual(rows_by_version.v2)
  expect(fetch_spy.mock.calls.map(([url]) => String(url)).filter((url) => url.startsWith(host))).toEqual([
    pointer_url,
    `${host}/data/spell_corpus.v1.json`,
    `${host}/data/world_corpus.v1.json`,
    pointer_url,
    `${host}/data/spell_corpus.v2.json`,
    `${host}/data/world_corpus.v2.json`,
  ])
  expect(error_spy).not.toHaveBeenCalled()
})

// #1739 — the pointer is the ONE corpus source. There is no bare `data/spell_corpus.json` second home to
// fall back to: the seed publishes the pointer in every ceremony, and the bare object is a stale prior
// publish (measured 2026-08-02: all 240 rows carry a PREVIOUS deployment's `object_id`). So a pointer
// failure REFUSES — typed error to the reporter, toast to the player — instead of silently serving stale ids.
test('a pointer failure refuses loudly and fetches no bare corpus URL', async () => {
  configure_assets({
    aggregator: host,
    classes: {
      spell_corpus: { published: true },
    },
  })
  const fetch_spy = spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input)
    if (url === pointer_url) return { ok: false, status: 404 }
    throw new Error(`unexpected corpus URL: ${url}`)
  })
  const error_spy = spyOn(console, 'error').mockImplementation(() => {})

  // spyOn re-acquires the SAME process-global fetch spy, and its call history outlives
  // afterEach's mock.restore() — clear it so this list is this test's fetches alone.
  fetch_spy.mockClear()
  await load_spell_corpus(load_corpus_version())

  // THE deletion assertion: the pointer is the only URL this loader ever reaches for.
  expect(fetch_spy.mock.calls.map(([url]) => String(url))).toEqual([pointer_url])
  expect(get_spell_corpus()).toEqual([])
  expect(event_toast_store.get()).toEqual([
    expect.objectContaining({
      state: 'error',
      title: 'Spell data unavailable — retrying',
    }),
  ])
  expect(error_spy).toHaveBeenCalledWith(
    '[ares-error]',
    expect.objectContaining({ message: 'corpus pointer HTTP 404' }),
    expect.anything(),
    '',
    expect.objectContaining({ area: 'spell_corpus', action: 'load_pointer' })
  )
})

test('the service worker routes the mutable pointer NetworkFirst before immutable CDN assets', () => {
  const vite_source = readFileSync(new URL('../../../vite.config.ts', import.meta.url), 'utf8')
  const pointer_index = vite_source.indexOf('corpus_version\\.json')
  // The broad CDN rule now lives in sw_cdn_assets_cache.ts (its cache-mode law sits beside an executable
  // fixture instead of untestable config text), so the ORDER law is asserted against the registration site.
  const cdn_assets_index = vite_source.indexOf('cdn_assets_runtime_cache,')
  expect(pointer_index).toBeGreaterThan(-1)
  expect(cdn_assets_index).toBeGreaterThan(pointer_index)
  expect(vite_source.slice(pointer_index, cdn_assets_index)).toContain("handler: 'NetworkFirst'")
})
