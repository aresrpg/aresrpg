// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Shared item-icon — the single home for rendering an item's art across every HUD surface (inventory
// slots/grid, encyclopedia rows/cards/detail, market buckets/rows/confirm/sell, fast-slots, recipe
// ingredient rows). Resolves the URL via the SDK SSOT helper item_icon_url (host-free
// `/assets/items/<template-or-icon-slug>.png`, or the asset-host item quilt once published; `_hd` for large detail) and
// degrades GRACEFULLY: on a failed/blocked <img> it swaps to the item's CATEGORY glyph (a ring, a sword,
// a potion…), with the generic package only when category is absent, so a missing sprite never leaves a blank.
//
// One component, two surfaces: the small inline icon (slots/rows) and the large HD detail render
// (`hd`). Both read the same helper so the URL law lives in exactly one place.
//
// HD icons 404 for thumb-only assets: an `_hd` request that 404s (the icon cache has 61
// thumb-only slugs, e.g. every Fuwa cosmetic) gets ONE immediate retry at the base (non-hd) icon before
// the category-glyph fallback — the item's real art beats a generic glyph. Mirrors ItemImage's own
// `icon_url_base` degrade (components/items.tsx), already proven for the shop vitrines/encyclopedia.
// [design ruling 2026-07-17: pictures must not go missing until refresh] a TRANSIENT failure (cold asset-host edge) no longer
// pins the glyph for the session: the load lifecycle runs through the shared reducer + bounded retry
// ladder (image_retry.js) — the glyph pins only once the ladder exhausts.
import {
  Crown,
  Shirt,
  Gem,
  CircleDot,
  Minus,
  Footprints,
  Sword,
  Swords,
  Wand2,
  Axe,
  Hammer,
  Shovel,
  Pickaxe,
  Fish,
  FlaskConical,
  Sparkles,
  Rabbit,
  Cat,
  Key,
  Star,
  Package,
} from 'lucide-react'

import { item_icon_url } from '@aresrpg/sdk/jobs'

import { use_image_retry } from './image_retry.js'

// On-chain item CATEGORY → a line glyph, keyed by the exact strings item.move::verify_category accepts.
// Shown when the CDN sprite 404s/blocks (art not yet uploaded) so the player still reads the item's KIND
// instead of a meaningless box. Unknown/absent category → DEFAULT_GLYPH.
const CATEGORY_ICONS = {
  // armour + accessories
  hat: Crown,
  cosmetic_helmet: Crown,
  cloak: Shirt,
  cosmetic_cloak: Shirt,
  cosmetic: Shirt,
  cosmetics: Shirt,
  amulet: Gem,
  ring: CircleDot,
  belt: Minus,
  boots: Footprints,
  // weapons + gathering tools
  sword: Sword,
  dagger: Sword,
  bow: Swords,
  wand: Wand2,
  staff: Wand2,
  axe: Axe,
  scythe: Axe,
  hammer: Hammer,
  shovel: Shovel,
  pickaxe: Pickaxe,
  fishingRod: Fish,
  // consumables + misc
  consumable: FlaskConical,
  relic: Sparkles,
  rune: Sparkles,
  mount: Rabbit,
  pet: Cat,
  key: Key,
  title: Star,
  resource: Package,
  misc: Package,
}

// generic line-glyph (currentColor) — the LAST resort, only when the category is unknown/missing too.
const DEFAULT_GLYPH = (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M12 2 3 7v10l9 5 9-5V7z" />
    <path d="M3 7l9 5 9-5M12 12v10" />
  </svg>
)

/** The category glyph for `category` (a verify_category string), or null when unmapped/absent.
 * EXPORTED (D133): ItemImage's terminal fallback reuses this exact glyph family — ONE home for the
 * category→icon map. Lookup is exact-first then lowercased (chain reads carry UPPERCASE categories —
 * read_shop_sales normalizes to 'CONSUMABLE' — while hud items are lowercase/camelCase like `fishingRod`). */
export function category_glyph(/** @type {string | null | undefined} */ category) {
  if (!category) return null
  const key = String(category).trim()
  const Icon = CATEGORY_ICONS[key] ?? CATEGORY_ICONS[key.toLowerCase()]
  return Icon ? <Icon strokeWidth={1.6} aria-hidden="true" /> : null
}

/** Terminal placeholder shared by ItemIcon and ItemImage. A known category gets its semantic line glyph;
 * an absent/unmapped category still gets the generic package glyph, so an asset miss can never become a blank. */
export function item_fallback_glyph(/** @type {string | null | undefined} */ category) {
  return category_glyph(category) ?? DEFAULT_GLYPH
}

/**
 * An item's icon with a graceful fallback. Pass the whole item (it resolves `slug ?? icon ?? id` for the
 * CDN URL and reads `category ?? item_category` for the fallback glyph) OR a raw icon/id string. On load
 * error (404 / blocked) an hd request first retries the BASE icon, then the shared retry ladder re-runs
 * the pass for transient failures; only when it exhausts does the item's CATEGORY glyph pin (a ring, a
 * sword…) — never a broken image or a bare box.
 * @param {{
 *   item: { slug?: string | null, icon?: string | null, id?: string | null, category?: string | null, item_category?: string | null } | string | null | undefined,
 *   alt?: string,
 *   hd?: boolean,
 *   className?: string,
 *   category?: string | null,
 *   glyph?: import('react').ReactNode,
 * }} props
 * @returns {import('react').JSX.Element}
 */
export function ItemIcon({ item, alt = '', hd = false, className, glyph, category }) {
  // Candidate URLs, best first: the requested variant, then (hd only) the BASE icon — an id's `_hd` art
  // isn't always uploaded yet. The shared reducer advances candidates immediately on error and walks the
  // transient-retry ladder only once a whole pass fails.
  let candidates = []
  try {
    candidates = (hd ? [item_icon_url(item, { hd: true }), item_icon_url(item)] : [item_icon_url(item)]).filter(Boolean)
  } catch {
    // A lost template join supplied a Sui object id. The resolver refuses it; render the placeholder below.
  }
  const { url, attempt, on_failed_attempt } = use_image_retry(candidates)
  // fallback precedence: explicit glyph → the item's category glyph → the generic box (last resort).
  const cat = category ?? (typeof item === 'object' && item ? (item.category ?? item.item_category) : null)
  const fallback = glyph ?? item_fallback_glyph(cat)
  return (
    <span className={`item-icon${className ? ` ${className}` : ''}`} aria-hidden={!alt}>
      {!url && <span className="item-icon__glyph">{fallback}</span>}
      {!!url && (
        <img
          key={`${url}#${attempt}`}
          className="item-icon__img"
          src={url}
          alt={alt}
          loading="lazy"
          referrerPolicy="no-referrer"
          draggable={false}
          onError={on_failed_attempt}
          // A missing sprite that 404s fires onError (→ hd-retry-at-base, then the ladder, then glyph).
          // But a CDN/SW response that resolves HTTP-ok with an undecodable body (Cloudflare error page,
          // opaque SW cache) fires onLOAD with naturalWidth 0 and NEVER onError — leaking the browser's
          // native broken-image box (a grey square top-left). Treat a zero-dimension load as a failure too. (#22b)
          onLoad={(e) => {
            if (!e.currentTarget.naturalWidth) on_failed_attempt()
          }}
        />
      )}
    </span>
  )
}
