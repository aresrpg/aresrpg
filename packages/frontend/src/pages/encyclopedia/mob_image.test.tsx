// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { afterAll, expect, test } from 'bun:test'
import React, { Children, isValidElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { configure_walrus_assets } from '@aresrpg/sdk/jobs'

import { set_catalog_for_test } from '../../game/data/mob_catalog.js'

import {
  EncyclopediaMobImage,
  MOB_IMAGE_RETRY_DELAYS_MS,
  mob_image_load_state,
  reduce_mob_image_load,
} from './mob_image'

afterAll(() => set_catalog_for_test())

test('EncyclopediaMobImage uses the shield glyph when no Walrus icon can be resolved', () => {
  const html = renderToStaticMarkup(<EncyclopediaMobImage mob={{ name: 'Definitely Not A Mob' }} />)
  expect(html).toContain('<svg')
  expect(html).not.toContain('<img')
  expect(html).not.toContain('/sprites/')
})

// ── first-navigation transient-failure repro: the encyclopedia doesn't display mob pictures unless the
// page is refreshed. The resolver is correct post-boot (asset_manifest_boot.test.tsx)
// and the URLs serve 200 — the broken window is the FIRST fetch itself: a cold CDN edge can take a beat
// and fail under the bestiary's concurrent burst. The component must treat
// that as transient (bounded retry), never pin the very first error into a glyph until a full reload. ──

const AGGREGATOR = 'https://first-nav.example'
const HD_SRC = `${AGGREGATOR}/mobs/alley_bunny_hd.png`

type StateSetter<T> = (next: T | ((current: T) => T)) => void
type ReactInternals = { H: unknown }

/** Minimal hook dispatcher (same idiom as shop_preview_handler.test.tsx) — useState survives re-renders
 * so a component's own event handlers can be driven without a DOM harness. */
function hook_runner() {
  const slots: unknown[] = []
  let cursor = 0
  const internals = (
    React as unknown as { __CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE: ReactInternals }
  ).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE
  const dispatcher = {
    useState<T>(initial: T | (() => T)): [T, StateSetter<T>] {
      const index = cursor++
      if (!(index in slots)) slots[index] = typeof initial === 'function' ? (initial as () => T)() : initial
      const set_value: StateSetter<T> = (next) => {
        slots[index] = typeof next === 'function' ? (next as (current: T) => T)(slots[index] as T) : next
      }
      return [slots[index] as T, set_value]
    },
  }
  return {
    render(element: ReactElement): ReactElement {
      if (typeof element.type !== 'function') throw new Error('expected a function component')
      cursor = 0
      const previous = internals.H
      internals.H = dispatcher
      try {
        return (element.type as (props: unknown) => ReactElement)(element.props)
      } finally {
        internals.H = previous
      }
    },
  }
}

function find_img(root: ReactNode): ReactElement | null {
  if (!isValidElement(root)) return null
  if (root.type === 'img') return root
  for (const child of Children.toArray((root.props as { children?: ReactNode }).children)) {
    const found = find_img(child)
    if (found) return found
  }
  return null
}

test('a transient first-load failure retries on its own instead of pinning the glyph until a refresh', async () => {
  // MISSING-ARTIFACT (#117): get_mob_icon_url resolves the name->glb join through mob_catalog.js's
  // get_catalog(), a runtime-published census (load_mob_catalog) never fetched in this headless test.
  // set_catalog_for_test is the sanctioned seam (mirrors set_spell_corpus_for_test) — seed the one row this
  // test's mob needs so it exercises the REAL resolution path, not a skip (the fact IS testable).
  set_catalog_for_test({ alley_bunny: { appearance: null, glb: 'hy_bunny' } })
  configure_walrus_assets({ aggregator: AGGREGATOR })
  const runner = hook_runner()
  const element = <EncyclopediaMobImage mob={{ name: 'Alley Bunny' }} hd />

  const first = runner.render(element)
  const first_img = find_img(first)
  if (!first_img) throw new Error('expected the first render to attempt the resolved asset-host icon')
  expect(first_img.props.src).toBe(HD_SRC)

  // The cold-edge window: the FIRST request errors (exactly the first-navigation symptom above).
  ;(first_img.props as { onError: () => void }).onError()

  // Degrading to the glyph immediately after the error is fine…
  // …but once the first retry deadline has elapsed, a FRESH <img> attempt must exist — the current
  // pin-forever behavior only ever heals through a full page refresh.
  await Bun.sleep(1_600)
  const healed = runner.render(element)
  const retry_img = find_img(healed)
  expect(retry_img?.props.src).toBe(HD_SRC)
})

test('the load reducer retries through the ladder, then pins the glyph only when it exhausts', () => {
  let state = mob_image_load_state('https://a/x.png')
  for (const [index] of MOB_IMAGE_RETRY_DELAYS_MS.entries()) {
    state = reduce_mob_image_load(state, { type: 'error' })
    expect(state.status).toBe('waiting_retry')
    state = reduce_mob_image_load(state, { type: 'retry_due', attempt: index })
    expect(state).toEqual({ url: 'https://a/x.png', attempt: index + 1, status: 'loading' })
  }
  state = reduce_mob_image_load(state, { type: 'error' })
  expect(state.status).toBe('given_up')
})

test('stale timer and duplicate events dedupe idempotently; a url change resets the lifecycle', () => {
  const initial = mob_image_load_state('https://a/x.png')
  // retry_due without a pending failure (or for an old attempt) is discarded
  expect(reduce_mob_image_load(initial, { type: 'retry_due', attempt: 0 })).toBe(initial)
  const waiting = reduce_mob_image_load(initial, { type: 'error' })
  const retried = reduce_mob_image_load(waiting, { type: 'retry_due', attempt: 0 })
  expect(reduce_mob_image_load(retried, { type: 'retry_due', attempt: 0 })).toBe(retried)
  // same url is a no-op; a new url starts a fresh lifecycle
  expect(reduce_mob_image_load(retried, { type: 'url', url: 'https://a/x.png' })).toBe(retried)
  expect(reduce_mob_image_load(retried, { type: 'url', url: 'https://a/y.png' })).toEqual({
    url: 'https://a/y.png',
    attempt: 0,
    status: 'loading',
  })
})
