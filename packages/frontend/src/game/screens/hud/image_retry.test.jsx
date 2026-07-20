// HUD pin-forever image regression (encyclopedia-proven class): a cold Walrus quilt patch
// takes ~2-3s to reconstruct and can fail under a concurrent burst. SpellArt and ItemIcon treated that
// very first transient error as PERMANENT — onError pinned the fallback (tinted initial / category
// glyph) for the component's whole life; only a full page refresh re-attempted. The fix mirrors the
// encyclopedia's landed reducer+ladder (pages/encyclopedia/mob_image.tsx): ONE pure reducer, a bounded
// retry ladder, timers at the edge, stale timer events deduped idempotently.

import { expect, test } from 'bun:test'
import React, { Children, isValidElement } from 'react'
import { configure_walrus_assets } from '@aresrpg/sdk/jobs'

import { SpellArt } from './SpellDetail.jsx'
import { ItemIcon } from './ItemIcon.jsx'
import { IMAGE_RETRY_DELAYS_MS, image_load_state, reduce_image_load } from './image_retry.js'

const AGGREGATOR = 'https://hud-retry.example'
const SPELL_QUILT = 'hud-retry-spell-icons'
const ITEM_QUILT = 'hud-retry-item-icons'
const SPELL_SRC = `${AGGREGATOR}/v1/blobs/by-quilt-id/${SPELL_QUILT}/ikari_haki.png`
const ITEM_SRC = `${AGGREGATOR}/v1/blobs/by-quilt-id/${ITEM_QUILT}/aberrant_faceguard.png`
const ITEM_HD_SRC = `${AGGREGATOR}/v1/blobs/by-quilt-id/${ITEM_QUILT}/aberrant_faceguard_hd.png`

const configure = () =>
  configure_walrus_assets({
    aggregator: AGGREGATOR,
    classes: { spell: { quilt: SPELL_QUILT }, item: { quilt: ITEM_QUILT } },
  })

/** Minimal hook dispatcher (same idiom as mob_image.test.tsx / shop_preview_handler.test.tsx) — useState
 * survives re-renders so a component's own event handlers can be driven without a DOM harness. */
function hook_runner() {
  const slots = []
  let cursor = 0
  const internals = React.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE
  const dispatcher = {
    useState(initial) {
      const index = cursor++
      if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial
      const set_value = (next) => {
        slots[index] = typeof next === 'function' ? next(slots[index]) : next
      }
      return [slots[index], set_value]
    },
  }
  return {
    render(element) {
      if (typeof element.type !== 'function') throw new Error('expected a function component')
      cursor = 0
      const previous = internals.H
      internals.H = dispatcher
      try {
        return element.type(element.props)
      } finally {
        internals.H = previous
      }
    },
  }
}

function find_img(root) {
  if (!isValidElement(root)) return null
  if (root.type === 'img') return root
  for (const child of Children.toArray(root.props.children)) {
    const found = find_img(child)
    if (found) return found
  }
  return null
}

test('SpellArt: a transient first-load failure retries on its own instead of pinning the tinted initial until a refresh', async () => {
  configure()
  const runner = hook_runner()
  const element = <SpellArt icon="ikari_haki" color="#f00" name="Ikari Haki" />

  const first_img = find_img(runner.render(element))
  if (!first_img) throw new Error('expected the first render to attempt the resolved spell icon')
  expect(first_img.props.src).toBe(SPELL_SRC)

  // The cold-edge window: the FIRST request errors.
  first_img.props.onError()

  // Degrading to the tinted initial immediately is fine — but once the first retry deadline has
  // elapsed, a FRESH <img> attempt must exist. The pin-forever behavior only heals on a page refresh.
  await Bun.sleep(1_600)
  const retry_img = find_img(runner.render(element))
  expect(retry_img?.props.src).toBe(SPELL_SRC)
})

test('ItemIcon: a transient thumb failure retries on its own instead of pinning the category glyph until a refresh', async () => {
  configure()
  const runner = hook_runner()
  const element = <ItemIcon item="aberrant_faceguard" alt="Aberrant Faceguard" />

  const first_img = find_img(runner.render(element))
  if (!first_img) throw new Error('expected the first render to attempt the resolved item icon')
  expect(first_img.props.src).toBe(ITEM_SRC)

  first_img.props.onError()

  await Bun.sleep(1_600)
  const retry_img = find_img(runner.render(element))
  expect(retry_img?.props.src).toBe(ITEM_SRC)
})

test('ItemIcon hd: still falls back hd→base immediately, then a fully-failed pass retries the ladder instead of pinning', async () => {
  configure()
  const runner = hook_runner()
  const element = <ItemIcon item="aberrant_faceguard" hd alt="Aberrant Faceguard" />

  const hd_img = find_img(runner.render(element))
  expect(hd_img?.props.src).toBe(ITEM_HD_SRC)

  // The proven hd→base degrade (thumb-only slugs) must stay IMMEDIATE — the real art is one URL away.
  hd_img.props.onError()
  const base_img = find_img(runner.render(element))
  expect(base_img?.props.src).toBe(ITEM_SRC)

  // Both variants failing (cold edge) currently pins the glyph forever; it must retry from hd.
  base_img.props.onError()
  await Bun.sleep(1_600)
  const retry_img = find_img(runner.render(element))
  expect(retry_img?.props.src).toBe(ITEM_HD_SRC)
})

test('the load reducer advances candidates immediately, walks the ladder per failed pass, then pins only on exhaustion', () => {
  const urls = ['https://a/x_hd.png', 'https://a/x.png']
  let state = image_load_state(urls)
  for (const [index] of IMAGE_RETRY_DELAYS_MS.entries()) {
    // one full pass: each candidate error advances immediately (no waiting state between variants)
    state = reduce_image_load(state, { type: 'error' })
    expect(state).toEqual({ urls, candidate: 1, attempt: index, status: 'loading' })
    state = reduce_image_load(state, { type: 'error' })
    expect(state.status).toBe('waiting_retry')
    state = reduce_image_load(state, { type: 'retry_due', attempt: index })
    expect(state).toEqual({ urls, candidate: 0, attempt: index + 1, status: 'loading' })
  }
  state = reduce_image_load(state, { type: 'error' })
  state = reduce_image_load(state, { type: 'error' })
  expect(state.status).toBe('given_up')
})

test('stale timer, duplicate and post-lifecycle events dedupe idempotently; a candidate-list change resets the lifecycle', () => {
  const urls = ['https://a/x.png']
  const initial = image_load_state(urls)
  // retry_due without a pending failure (or for an old attempt) is discarded
  expect(reduce_image_load(initial, { type: 'retry_due', attempt: 0 })).toBe(initial)
  const waiting = reduce_image_load(initial, { type: 'error' })
  // an error while already waiting (a late zero-naturalWidth onLoad after onError) is discarded
  expect(reduce_image_load(waiting, { type: 'error' })).toBe(waiting)
  const retried = reduce_image_load(waiting, { type: 'retry_due', attempt: 0 })
  expect(reduce_image_load(retried, { type: 'retry_due', attempt: 0 })).toBe(retried)
  // an equal candidate list is a no-op (render-time identity reset stays stable); a new list starts fresh
  expect(reduce_image_load(retried, { type: 'urls', urls: ['https://a/x.png'] })).toBe(retried)
  expect(reduce_image_load(retried, { type: 'urls', urls: ['https://a/y.png'] })).toEqual({
    urls: ['https://a/y.png'],
    candidate: 0,
    attempt: 0,
    status: 'loading',
  })
})
