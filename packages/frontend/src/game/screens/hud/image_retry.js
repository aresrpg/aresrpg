// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// ── first-fetch resilience, the HUD home ("pictures missing unless I refresh") ─────────
// A cold asset-host edge reconstructs each quilt patch in ~2-3s (curl-measured) and can fail under a
// concurrent burst. Any component whose onError PINS its fallback treats that transient first error as
// permanent for the whole session. This module is the shared cure for the HUD pair (SpellArt, ItemIcon),
// mirroring the encyclopedia's landed pattern (pages/encyclopedia/mob_image.tsx — kept local there
// because that lane is live on its files; folding it in here is a follow-up): ONE pure reducer over the
// load lifecycle, a bounded retry ladder, timers at the edge, stale events deduped idempotently.
//
// Generalized over a CANDIDATE LIST so ItemIcon's proven hd→base variant degrade composes with the
// transient ladder: an error advances to the next candidate IMMEDIATELY (a 404'd `_hd` is one URL away
// from the real art); only a fully-failed pass waits on the ladder and re-runs from the first candidate.
// Total passes = 1 + the ladder's length; the fallback pins only when the ladder exhausts.

import { useState } from 'react'

export const IMAGE_RETRY_DELAYS_MS = [1_000, 4_000]

/** @typedef {{ urls: string[], candidate: number, attempt: number, status: 'loading' | 'waiting_retry' | 'given_up' }} ImageLoadState */
/** @typedef {{ type: 'urls', urls: string[] } | { type: 'error' } | { type: 'retry_due', attempt: number }} ImageLoadEvent */

/** @param {string[]} urls @returns {ImageLoadState} */
export const image_load_state = (urls) => ({
  urls,
  candidate: 0,
  attempt: 0,
  status: 'loading',
})

/** @param {string[]} a @param {string[]} b */
const same_urls = (a, b) => a.length === b.length && a.every((url, i) => url === b[i])

/** The ONE pure reducer for an image load lifecycle. Stale events (an old attempt's timer, an error
 * after the lifecycle moved on, a re-render's identical candidate list) dedupe idempotently — a race can
 * reorder inputs but never corrupt the state.
 * @param {ImageLoadState} state @param {ImageLoadEvent} event @returns {ImageLoadState} */
export const reduce_image_load = (state, event) => {
  switch (event.type) {
    case 'urls':
      return same_urls(state.urls, event.urls) ? state : image_load_state(event.urls)
    case 'error': {
      if (state.status !== 'loading') return state
      const next = state.candidate + 1
      if (next < state.urls.length) return { ...state, candidate: next }
      return {
        ...state,
        status: state.attempt < IMAGE_RETRY_DELAYS_MS.length ? 'waiting_retry' : 'given_up',
      }
    }
    case 'retry_due':
      return state.status === 'waiting_retry' && state.attempt === event.attempt
        ? { urls: state.urls, candidate: 0, attempt: state.attempt + 1, status: 'loading' }
        : state
    default:
      return state
  }
}

/**
 * The shared load-lifecycle hook: give it the resolved candidate URLs (already filtered non-null, best
 * first), render the returned `url` (null = show the caller's fallback) keyed by `attempt`, and wire
 * `on_failed_attempt` to the img's onError / zero-naturalWidth onLoad. A changed candidate list resets
 * the lifecycle through the reducer (the sanctioned render-time derived-state idiom); the retry timer
 * lives here — at the edge — and its due event is deduped by the reducer.
 * @param {string[]} urls @returns {{ url: string | null, attempt: number, on_failed_attempt: () => void }}
 */
export function use_image_retry(urls) {
  const [load, set_load] = useState(() => image_load_state(urls))
  const active = reduce_image_load(load, { type: 'urls', urls })
  if (active !== load) set_load(active)

  const on_failed_attempt = () => {
    const { attempt, candidate, urls: active_urls } = active
    set_load((state) => reduce_image_load(state, { type: 'error' }))
    // Arm the ladder only when this error exhausts the pass (the last candidate failed).
    const delay = candidate + 1 >= active_urls.length ? IMAGE_RETRY_DELAYS_MS[attempt] : null
    if (delay != null)
      setTimeout(() => set_load((state) => reduce_image_load(state, { type: 'retry_due', attempt })), delay)
  }

  return {
    url: active.status === 'loading' ? (active.urls[active.candidate] ?? null) : null,
    attempt: active.attempt,
    on_failed_attempt,
  }
}
