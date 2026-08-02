// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The Jobs drawer's shared render primitives — the pieces every jobs section draws with (the category
// glyph, the item art, the covered-category label). Split out of JobsDrawer.jsx (issue #2052) so each
// section file stays inside the 600-LoC house budget; the components themselves are unchanged.
import { useState } from 'react'

import { JOB_CATEGORY, item_icon_url } from '@aresrpg/sdk/jobs'

import './jobs.css'

/** Per-category accent glyph (inline SVG, currentColor). */
const CATEGORY_GLYPH = {
  [JOB_CATEGORY.GATHERING]: <path d="M2 22 16 8M17 7l5-5M14 4l6 6M9 9l4 4" />,
  [JOB_CATEGORY.WEAPON]: <path d="M14.5 17.5 3 6V3h3l11.5 11.5M13 19l6-6M16 16l4 4" />,
  [JOB_CATEGORY.EQUIPMENT]: <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />,
  [JOB_CATEGORY.CONSUMABLE]: <path d="M5 3h14l-1 7a6 6 0 0 1-12 0zM12 17v4M8 21h8" />,
}

/** @param {{ kind: keyof typeof CATEGORY_GLYPH }} props */
export function JobGlyph({ kind }) {
  return (
    <svg
      className="jobs__glyph"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {CATEGORY_GLYPH[kind]}
    </svg>
  )
}

/**
 * An item icon — the REAL aresrpg asset art (assets CDN) with a graceful fallback. Mirrors the
 * companion `ItemImage`: tries `${ASSETS_URL}/items/<icon>.png` with `referrerPolicy="no-referrer"`,
 * and on load error swaps to a tasteful diamond GLYPH in the neutral steel tone (so a blocked or
 * missing asset never renders a broken-image box). FLAG: the assets bucket currently returns
 * AccessDenied to non-companion origins, so confirmed real art needs the house asset pipeline — the
 * glyph is the live fallback until then.
 * @param {{ icon: string, size?: number }} props
 */
export function ItemIcon({ icon, size = 28 }) {
  const [failed, set_failed] = useState(false)
  const url = item_icon_url(icon)
  if (!url || failed) {
    return (
      <span className="jobs__item-glyph" style={{ width: size, height: size }} aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <path d="M12 3 21 12 12 21 3 12Z" strokeWidth="1.6" strokeLinejoin="round" />
        </svg>
      </span>
    )
  }
  return (
    <img
      className="jobs__item-img"
      src={url}
      alt=""
      crossOrigin="anonymous"
      width={size}
      height={size}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => set_failed(true)}
    />
  )
}

/** A capitalized covered-category label, e.g. ['longsword','sword'] -> "Longsword, Sword". */
export const covers_label = (/** @type {string[]} */ covers) =>
  covers.map((c) => c.replace(/_/g, ' ').replace(/^\w/, (m) => m.toUpperCase())).join(', ')
