// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// ITEM → DROPPERS, inverted from the LIVE mob rows. One home for the reverse of the loot projection the
// bestiary already renders forward: a `/v1/encyclopedia` mob row carries its own authoritative `drops`
// (template_id + the basis-point-derived chance), so "who drops this item" is DERIVED from those rows and
// from nothing else.
//
// Issue #1467 — this is the join that used to be fenced through the build-time seed receipt
// (`is_living_mob`, deleted with living_corpus.ts). The receipt is frozen into the deployed bundle, so any
// republish that outran a redeploy took the whole index to zero: measured on the live testnet 2026-07-28,
// ZERO of 383 live mob rows matched the bundled manifest's 374 mob ids, which is exactly why every item read
// "no known drop sources" while the bestiary tab next door listed the droppers. A bundled artifact may seed
// initial paint; it may never be the truth an id-join resolves against.
//
// ABSENCE IS NOT EMPTINESS (cache law): an absent/failed read yields an EMPTY index, and an empty index is
// indistinguishable from "this item has no droppers" — so the caller must gate on the read's own loading /
// error state, never treat `get(id) ?? []` as proof of no drops.

export interface DropperRow {
  id: string
  name: string
  minLevel: number
  maxLevel: number
  chance_percent: number
}

/** A live `/v1/encyclopedia` mob row, narrowed to what the inversion reads. */
export interface DroppingMob {
  template_id: string
  name?: string | null
  min_level?: number | null
  max_level?: number | null
  drops?: { template_id: string; chance_percent: number }[] | null
}

/**
 * Invert live mob rows into `item template id → droppers`, each item's sources sorted best-chance-first.
 * Pure: `display_name` is injected (the mob-name override table is a rendering concern, not a join one).
 */
export function invert_mob_drops(
  mobs: readonly DroppingMob[] | null | undefined,
  display_name: (name?: string | null) => string = (name) => name ?? ''
): Map<string, DropperRow[]> {
  const index = new Map<string, DropperRow[]>()
  for (const mob of mobs ?? []) {
    if (!mob?.template_id || !mob.drops) continue
    for (const drop of mob.drops) {
      if (!drop?.template_id) continue
      const rows = index.get(drop.template_id) ?? []
      rows.push({
        id: mob.template_id,
        name: display_name(mob.name) || '',
        minLevel: mob.min_level ?? 0,
        maxLevel: mob.max_level ?? 0,
        chance_percent: drop.chance_percent,
      })
      index.set(drop.template_id, rows)
    }
  }
  for (const rows of index.values()) rows.sort((left, right) => right.chance_percent - left.chance_percent)
  return index
}
