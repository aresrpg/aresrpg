// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// pages/encyclopedia/item_lookup.ts — RESOLVING ONE published template from the key a surface happens to hold.
//
// item_corpus.ts answers "which item templates does the live game contain"; this answers "which row is THIS
// key", for the surfaces that hold a single item instead of browsing the catalog: the bag / marketplace
// tooltips, the shared item detail card, and the shop. It is a PROJECTION over that one door — no second
// fetch, no second liveness filter — and it exists because those surfaces resolved their template out of the
// bundled seed catalog (`@aresrpg/sdk/items-data`), which is `{}` by construction in this repo (the content
// boundary), so each of them printed a raw slug where a published name belongs (#856 — the items half of the
// class #765 / #800 / #821 closed for jobs, recipes and unlocks).
//
// TWO KEYS, ONE INDEX. `/v1` keys a template by its on-chain OBJECT ID, but a minted Item instance carries
// only the authored art SLUG (`item_type`) — chain/read_findables.js keeps a by-item_type map for exactly
// that reason. Both are indexed here because a surface cannot always tell which one it holds: a shop sale
// carries both, a bag/listing item carries the slug, a consumable's roll table carries whatever it was
// authored with. The two key spaces cannot collide — an object id is 0x-hex, an art slug is an authored word.
//
// The corpus module is imported as a NAMESPACE deliberately: `use_item_corpus` is the ONE seam this repo's
// SSR test harness can spy for the whole class (same reason simulator/LoadoutSection.tsx does it), so every
// surface built on this lookup stays drivable through a cold corpus and a landed one.

import { useCallback, useMemo } from 'react'

import { use_template_t } from '../../i18n/template_t'

import * as item_corpus from './item_corpus'
import type { CorpusItem } from './item_corpus'

/** A published row in the shape `use_template_t` reads: the lazy item-description catalog is keyed by the
 *  authored art slug, which on a published row is `item_type`. */
export type LocalizableItem = CorpusItem & { desc_key: string }

/** The honest last resort when the corpus holds no row for a key: the key itself, made readable. */
const humanize = (key: string): string => key.replace(/_/g, ' ')

export type ItemLookup = {
  /** Every living published row (the corpus, verbatim) — for the callers that need the LIST, not one row. */
  items: CorpusItem[]
  /** The row for a template object id OR an authored art slug. `undefined` while the corpus is still cold
   *  and for a template the live game no longer mints — both are honest gaps, never a fabricated row. */
  find: (key: string | null | undefined) => LocalizableItem | undefined
  /** The row's localized name; else `fallback` (the instance's own chain-carried name, where the surface has
   *  one); else the humanized key. Never blank — a nameless cell is the empty render this door ends. */
  name_of: (key: string | null | undefined, fallback?: string | null) => string
  /** true only before the first /v1 answer lands: absence is not emptiness (cache law). A surface that draws
   *  a whole LIST off this door has to say LOADING rather than paint the empty one. */
  loading: boolean
}

export function use_item_lookup(): ItemLookup {
  const tt = use_template_t()
  const { items, loading } = item_corpus.use_item_corpus()

  const index = useMemo(() => {
    const map = new Map<string, LocalizableItem>()
    for (const item of items) {
      const row: LocalizableItem = { ...item, desc_key: item.item_type }
      map.set(item.id, row)
      if (item.item_type) map.set(item.item_type, row)
    }
    return map
  }, [items])

  const find = useCallback((key: string | null | undefined) => (key ? index.get(key) : undefined), [index])

  // Not memoized on purpose: `tt` is a fresh closure per render (it closes over the active language), so a
  // cache here would serve the previous locale's name for one render after a language switch.
  const name_of = (key: string | null | undefined, fallback?: string | null): string => {
    const row = find(key)
    return (row && tt(row, 'name')) || fallback || humanize(key ?? '')
  }

  return { items, find, name_of, loading }
}
