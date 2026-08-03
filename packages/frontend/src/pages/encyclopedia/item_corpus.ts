// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// pages/encyclopedia/item_corpus.ts — THE PUBLISHED ITEM CORPUS, subscribed.
//
// Sibling of world_corpus.ts (the published mob/world corpus) and its exact counterpart for items: one home
// for "which item templates does the live game contain", read from `/v1/encyclopedia` — the same door the
// items tab renders from. Any surface that needs to BROWSE items reads it here.
//
// It exists because the alternative kept shipping empty surfaces: the bundled seed catalog
// (`@aresrpg/sdk/items-data`) is `{}` by construction in this repo — the content boundary — so anything
// sourcing a list from it renders blank on every real deployment while the chain holds the full catalog.
// That is the Jobs-drawer bug (#765/#800) and it is what emptied all 20 of the simulator's gear pickers.
//
// Rolls are NOT resolved here. A row carries its authored `[min, max]` ranges verbatim; resolving a ceiling
// is the consumer's own generic resolver (simulator-equip.js's `equip_item` for the max-roll fold).

import { useMemo } from 'react'

import { item_damages_from_v1, item_stats_from_v1 } from '../../chain/read_findables.js'
import { ITEM_STAT_KEY_MAP } from '../../chain/read_templates.js'
import { get_encyclopedia, type RpcError } from '../../rpc/client'
import { useRpcView } from '../../rpc/use_view'
import type { RpcEncyclopediaItem } from '../../rpc/views'

/** One published item template. `item_type` is the authored art slug (the icon key every item surface
 *  resolves through); `category` is the raw Move category, which is what slot legality is decided on. */
export type CorpusItem = {
  id: string
  name: string
  /** The published EN description (chain Display carries EN only — the locale overlay is `useTemplateT`'s
   *  job, keyed by the authored art slug). `''` for a template that authors none. */
  description: string
  category: string
  item_type: string
  level: number
  stats: Record<string, [number, number] | number>
  damages: { from: number; to: number; damage_type: string; element: string }[]
}

/**
 * The KEY VOCABULARY a row's `stats` uses, published with the row it describes. `item_stats_from_v1` decodes
 * through the shared home, which renames every Move `item_stats` field to its UI spelling (`raw_damage` →
 * `rawDamage`, `critical` → `criticalHit`, the four resistances) — so a consumer that reads a row by the
 * chain's own field name silently reads NOTHING. The map is the decode home's own table (UI key → chain
 * field); re-exported here because this module is what hands out the rows, and a consumer must not reach
 * past it to learn how to read one.
 */
export { ITEM_STAT_KEY_MAP }

/** A developer/cheat template never reaches a player's build. Mirrors the SDK predicate, read off the raw
 *  /v1 category (a template row carries no `quality`). */
const is_developer_row = (row: RpcEncyclopediaItem): boolean => (row.category ?? '').toLowerCase() === 'developer'

/**
 * The `/v1/encyclopedia` item rows → the browsable corpus, sorted by level then name (the order every item
 * list in the game already uses).
 *
 * The rows ARE the corpus: `/v1` is the live catalog, so no second id set gets a vote on which of its rows
 * count (#1467 — the build-time seed receipt used to fence this, and a republish that outran a redeploy
 * emptied every consumer). Only the developer/cheat class is dropped, off the row's own category.
 */
export const item_corpus_from_v1 = (rows: readonly RpcEncyclopediaItem[] | null | undefined): CorpusItem[] =>
  (rows ?? [])
    .filter((row) => !is_developer_row(row))
    .map((row) => ({
      id: row.template_id,
      name: row.name ?? '',
      description: row.description ?? '',
      category: (row.category ?? '').toLowerCase(),
      item_type: row.item_type ?? '',
      level: row.level ?? 0,
      stats: item_stats_from_v1(row.stats) as Record<string, [number, number] | number>,
      damages: item_damages_from_v1(row.damages),
    }))
    .sort((left, right) => left.level - right.level || (left.name || left.id).localeCompare(right.name || right.id))

export type ItemCorpus = {
  items: CorpusItem[]
  by_id: ReadonlyMap<string, CorpusItem>
  /** true only before the first /v1 answer lands. Consumers must SAY this rather than render an empty list:
   *  absence is not emptiness (cache law), and the two are indistinguishable once drawn. */
  loading: boolean
  /** The first or latest /v1 read failed. Kept as DATA from useRpcView so an empty consumer can render
   *  degraded instead of asserting that the live game genuinely publishes zero items. */
  error: RpcError | null
}

/** The live corpus, subscribed. One shared app-lifetime read (the client caches `encyclopedia:all`), so a
 *  consumer rides the same fetch the encyclopedia already made. */
export function use_item_corpus(): ItemCorpus {
  const { data, loading, error } = useRpcView((signal) => get_encyclopedia(undefined, signal), { deps: [] })
  const items = useMemo(() => item_corpus_from_v1(data?.items), [data])
  const by_id = useMemo(() => new Map(items.map((item) => [item.id, item])), [items])
  return { items, by_id, loading, error }
}
