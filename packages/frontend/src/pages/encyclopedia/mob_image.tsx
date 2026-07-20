// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { Shield } from 'lucide-react'
import { useState } from 'react'

import { encyclopedia_mob_icon_url } from './encyclopedia_assets'

// ── first-fetch resilience (pictures missing unless the page is refreshed) ──────────────────────
// The resolver is correct post-boot (asset_manifest_boot.test.tsx) and the quilt URLs serve 200 — the
// broken window is the FIRST fetch: a cold Walrus edge reconstructs each quilt patch in ~2-3s
// (curl-measured) and can fail under the bestiary's concurrent burst. The old component pinned that very
// first error into the glyph for the whole session (only a full page refresh re-attempted). A failed
// fetch is transient by default: retry on this short ladder, and only when it exhausts pin the honest
// glyph. Total attempts = 1 + the ladder's length.
export const MOB_IMAGE_RETRY_DELAYS_MS = [1_000, 4_000] as const

export interface MobImageLoadState {
  url: string | null
  attempt: number
  status: 'loading' | 'waiting_retry' | 'given_up'
}

export type MobImageLoadEvent =
  { type: 'url'; url: string | null } | { type: 'error' } | { type: 'retry_due'; attempt: number }

export const mob_image_load_state = (url: string | null): MobImageLoadState => ({
  url,
  attempt: 0,
  status: 'loading',
})

/** The ONE pure reducer for the mob-image load lifecycle. Stale timer events (an old attempt, an old
 * url) dedupe idempotently — a race can reorder inputs but never corrupt the state. */
export const reduce_mob_image_load = (state: MobImageLoadState, event: MobImageLoadEvent): MobImageLoadState => {
  switch (event.type) {
    case 'url':
      return state.url === event.url ? state : mob_image_load_state(event.url)
    case 'error':
      return { ...state, status: state.attempt < MOB_IMAGE_RETRY_DELAYS_MS.length ? 'waiting_retry' : 'given_up' }
    case 'retry_due':
      return state.status === 'waiting_retry' && state.attempt === event.attempt
        ? { url: state.url, attempt: state.attempt + 1, status: 'loading' }
        : state
  }
}

/** Walrus-only encyclopedia mob image. A transient fetch failure self-heals through the retry ladder;
 * missing/unpublished art degrades to the established shield glyph only once the ladder exhausts. */
export function EncyclopediaMobImage({
  mob,
  hd,
  className,
  style,
}: {
  mob: { name?: string; variant?: string }
  hd?: boolean
  className?: string
  style?: React.CSSProperties
}) {
  const url = encyclopedia_mob_icon_url(mob, !!hd)
  const [load, set_load] = useState<MobImageLoadState>(() => mob_image_load_state(url))
  // Render-time identity reset (the sanctioned derived-state idiom), routed through the ONE reducer:
  // a different mob/hd starts its own lifecycle; the current render already uses the fresh state.
  const active = reduce_mob_image_load(load, { type: 'url', url })
  if (active !== load) set_load(active)

  const on_failed_attempt = () => {
    const { attempt } = active
    set_load((state) => reduce_mob_image_load(state, { type: 'error' }))
    const delay = MOB_IMAGE_RETRY_DELAYS_MS[attempt]
    if (delay != null)
      setTimeout(() => set_load((state) => reduce_mob_image_load(state, { type: 'retry_due', attempt })), delay)
  }

  if (!url || active.status !== 'loading')
    return (
      <span
        className={`inline-flex items-center justify-center text-muted opacity-40 ${className ?? ''}`}
        style={style}
        aria-hidden="true"
      >
        <Shield size={hd ? 28 : 14} strokeWidth={1.6} />
      </span>
    )

  return (
    <img
      key={`${url}#${active.attempt}`}
      src={url}
      alt=""
      loading={hd ? 'eager' : 'lazy'}
      referrerPolicy="no-referrer"
      className={className}
      style={style}
      onError={on_failed_attempt}
      onLoad={(event) => {
        if (!event.currentTarget.naturalWidth) on_failed_attempt()
      }}
    />
  )
}
