// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Shared item image + fallback ladder. Kept as a leaf so item lists and item detail views can both render the
// same image without importing one another.

import { useState } from 'react'
import { canonical_asset_url, item_icon_url, asset_url, ASSET_BASE } from '@aresrpg/sdk/jobs'

import { use_image_version } from '../stores/image_version'
// D133: the terminal fallback glyph family — ONE home (ItemIcon.jsx owns the category→icon map). The bag
// already degrades to a category glyph (the accepted flask fallback); ItemImage surfaces (shop/marketplace)
// previously degraded to visibility:hidden = a BLANK slot on the sale card.
import { item_fallback_glyph } from '../game/screens/hud/ItemIcon.jsx'

export function ItemImage({
  id,
  image_url,
  appearance,
  category,
  className,
  style,
  hd,
  eager,
}: {
  id: string
  /** DISPLAY-FIRST: the on-chain Display `image_url` (wallet-grade, instance-correct). When present it wins;
   * the slug-built URL is only the fallback for reads that can't resolve Display (kiosk-wrapped/nested). */
  image_url?: string
  appearance?: string
  /** D133: when every image candidate 404s, render this category's glyph (the bag's accepted degradation)
   * instead of a blank slot. Omit ⇒ legacy hidden behavior (surfaces that layer their own placeholder). */
  category?: string | null
  className?: string
  style?: React.CSSProperties
  hd?: boolean
  eager?: boolean
}) {
  const v = use_image_version((s) => s.image_versions[id])
  const [exhausted, set_exhausted] = useState(false)
  // ONE item-URL home: the SDK resolver owns Walrus shard selection, host-free fallback, HD naming, and the
  // object-address guard. A bad runtime key is an honest missing candidate here, never a render-time crash.
  const resolve_icon = (high_definition: boolean) => {
    try {
      return item_icon_url(id, { hd: high_definition })
    } catch {
      return null
    }
  }
  const icon_url = resolve_icon(!!hd)
  // hd callers (the shop vitrines) degrade to the BASE icon before vanilla/glyph — an id whose _hd art isn't
  // published must still show its own icon. The onLoad hook below re-pixelates when a base png actually lands.
  const icon_url_base = hd ? resolve_icon(false) : null
  const vanilla_url = appearance
    ? (asset_url('vanilla', `${appearance}.png`) ?? `${ASSET_BASE}/vanilla/${appearance}.png`)
    : null
  // HD DETAIL ("the detail page still points to /items/<slug>.png, not the _hd variant"): a
  // Display `image_url` is the BASE `.png`, so when it's present it used to win the whole race and the _hd
  // variant was never requested. In hd mode, derive the `_hd.png` twin of the Display url and try it FIRST; the
  // base Display url stays right behind it, so a missing _hd object (server-side 404 — most items today) flips
  // straight back to the base render. Skipped when the url isn't a `.png` or is already an _hd url.
  // A chain Display may already carry a Walrus blob path. Re-home it through the configured manifest base so
  // a Display published with a raw origin cannot bypass the app CDN. Host-free/data URLs stay local; any other
  // absolute host is discarded and the manifest-backed slug builder below wins.
  const display_url =
    image_url?.startsWith('/') || image_url?.startsWith('data:') ? image_url : canonical_asset_url(image_url)
  const image_url_hd =
    hd && display_url && /\.png(\?|$)/i.test(display_url) && !/_hd\.png/i.test(display_url)
      ? display_url.replace(/\.png(\?|$)/i, '_hd.png$1')
      : null
  // Ordered fallback: (hd) Display _hd → canonical Display url → slug icon (→ base icon when hd) →
  // vanilla appearance → hidden.
  const candidates = [image_url_hd, display_url, icon_url, icon_url_base, vanilla_url].filter(Boolean) as string[]
  const base = candidates[0] ?? null
  const primary = base && v ? `${base}?v=${v}` : base
  // Advance the ordered fallback (Display url → slug icon → vanilla appearance → hidden). Shared by
  // onError (404 / blocked) AND onLoad-with-naturalWidth-0: a CDN/SW response that resolves HTTP-ok with an
  // undecodable body (Cloudflare error page, opaque SW cache) fires onLOAD — never onError — and leaks the
  // browser's native broken-image box (a WHITE BORDER + a top-left SQUARE placeholder). ItemIcon.jsx guards
  // this exact case (#22b); ItemImage is its sibling root, so every ItemImage surface (shop / marketplace /
  // loot-roll pickers / the shared onchain hover tooltip over the bag + equipment) inherits the guard here. (D11)
  const advance = (img: HTMLImageElement) => {
    const next = Number(img.dataset.fbidx ?? '0') + 1
    if (next < candidates.length) {
      img.dataset.fbidx = String(next)
      img.src = candidates[next]
    } else {
      img.style.visibility = 'hidden' // same-tick belt-and-braces; the glyph branch below re-renders
      set_exhausted(true)
    }
  }
  // Every candidate failed (or the resolver rejected an object address): use the shared semantic/category
  // placeholder, with its generic package glyph as the final fallback. No item icon surface may stay blank.
  const glyph = exhausted || !primary ? item_fallback_glyph(category) : null
  if (glyph)
    return (
      <span
        className={`inline-flex items-center justify-center text-muted opacity-60 ${className ?? ''}`}
        style={style}
        aria-hidden="true"
      >
        {glyph}
      </span>
    )
  return (
    <img
      src={primary ?? undefined}
      alt=""
      loading={eager ? 'eager' : 'lazy'}
      referrerPolicy="no-referrer"
      className={className}
      style={{ ...(hd ? {} : { imageRendering: 'pixelated' as const }), ...style }}
      data-fbidx="0"
      onError={(e) => advance(e.currentTarget)}
      onLoad={(e) => {
        if (!e.currentTarget.naturalWidth) advance(e.currentTarget)
        // hd request resolved onto a non-hd candidate (base/local/vanilla): a small pixel-art png scaled large
        // must render pixelated, not smoothed to mush.
        else if (hd && !/_hd\./.test(e.currentTarget.currentSrc)) e.currentTarget.style.imageRendering = 'pixelated'
      }}
    />
  )
}
