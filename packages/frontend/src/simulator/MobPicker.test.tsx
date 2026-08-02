// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// MobPicker.test.tsx — the simulator's mob picker opened EMPTY on edge ("NO RESULTS FOUND · 0/0", driven at
// 95fb7748). Two independent causes, both pinned here:
//
//   (1) NOTHING LOADED THE CORPUS. `load_world_corpus()` had zero production callers — the picker's whole
//       population came from a blob that was never fetched. The boot wiring now sits in main.tsx beside the
//       sibling content blobs; what this file pins is the empty→populated transition that wiring enables.
//   (2) A FROZEN SNAPSHOT. The roster was `useMemo(simulator_mob_roster, [])` over a mutable module object,
//       so even a corpus that DID land could never reach the mounted picker.
//
// WHAT DRIVES WHAT: `useMobPickerContent` is the picker's whole content brain — MobPicker is a
// pass-through shell over it, and renders through `createPortal`, which this repo's SSR harness cannot
// resolve (same split rationale as PetFeedModal.test.jsx). The corpus store is driven the way every
// store-backed component test here drives one (LevelUp.test.jsx): the hook is spied, because zustand's
// `useSyncExternalStore` serves `getInitialState()` under SSR and would hide every later state. The other
// half of the chain — that a settling corpus NOTIFIES its subscribers — is pinned in
// world_corpus_loader.test.ts; together they cover mounted-picker → store → corpus landing.

import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import i18next from 'i18next'
import { I18nextProvider } from 'react-i18next'

import en from '../i18n/locales/en.json'
import fixture from '../pages/encyclopedia/world_corpus.fixture.json'
import * as world_corpus from '../pages/encyclopedia/world_corpus'
import type { WorldCorpusBlob } from '../pages/encyclopedia/world_corpus'

import { simulator_mob_roster, useMobPickerContent } from './MobPicker'

const test_i18n = i18next.createInstance()
void test_i18n.init({
  lng: 'en',
  resources: { en: { translation: en } },
  interpolation: { escapeValue: false },
})

// The REAL store, captured before any spy — the states below are its own derivations, never hand-built.
const store = world_corpus.use_world_corpus
const corpus_state = (blob?: WorldCorpusBlob) => {
  world_corpus.set_world_corpus_for_test(blob)
  return store.getState()
}

/** Prints exactly what the picker hands its modal — the empty line, then one row per listed mob. */
function PickerContent() {
  const { items, empty_label } = useMobPickerContent()
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

/** Render the picker's content against a given corpus state — the mounted picker's only input. */
const render_against = (state: ReturnType<typeof corpus_state>): string => {
  const spy = spyOn(world_corpus, 'use_world_corpus').mockImplementation(
    (selector: (s: typeof state) => unknown) => selector(state) as never
  )
  try {
    return renderToStaticMarkup(
      <I18nextProvider i18n={test_i18n}>
        <PickerContent />
      </I18nextProvider>
    )
  } finally {
    spy.mockRestore()
  }
}

const count_of = (html: string): number => Number(html.match(/<span id="count">(\d+)<\/span>/)?.[1] ?? -1)

afterEach(() => world_corpus.set_world_corpus_for_test())

describe('the simulator mob picker population', () => {
  test('an unloaded corpus reads as LOADING — never the "no results" lie', () => {
    const html = render_against(corpus_state()) // pristine: the state every mount starts in
    expect(html).toContain(en.simulator.mob_roster_loading)
    expect(count_of(html)).toBe(0)
    // the modal's default empty line is what the picker showed forever — suppressed while the blob is coming
    expect(html).not.toContain(en.search_picker.no_results)
  })

  test('the corpus landing populates the roster — the empty→populated transition', () => {
    expect(count_of(render_against(corpus_state()))).toBe(0) // empty first…

    const landed = corpus_state(fixture as WorldCorpusBlob) // …then the blob arrives
    const expected = simulator_mob_roster(landed.worlds)
    expect(expected.length).toBeGreaterThan(0)

    const html = render_against(landed)
    expect(count_of(html)).toBe(expected.length)
    for (const mob of expected) expect(html).toContain(mob.name)
    expect(html).not.toContain(en.simulator.mob_roster_loading) // settled ⇒ the loading line is gone
  })

  test('resource protectors never enter the roster (they are not fightable mobs)', () => {
    const landed = corpus_state(fixture as WorldCorpusBlob)
    for (const mob of simulator_mob_roster(landed.worlds)) expect(mob.role).not.toBe('protector')
  })
})
