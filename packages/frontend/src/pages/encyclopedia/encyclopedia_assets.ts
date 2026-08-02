// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { item_icon_url, mob_icon_url } from '@aresrpg/sdk/jobs'

import { cosmetic_icon_of } from '../../game/cosmetic_icons'
import { chain_icon_slug, icon_asset_class } from '../../game/item_classification'
import { catalog_name_of } from '../../content/mob_name_overrides'

import live_population from './mob_slugs.json'

type ItemIconResolver = (slug: string, options?: { asset_class?: 'item' | 'cosmetic_icon' }) => string | null
type MobIconResolver = (filename: string) => string | null

interface EncyclopediaItemAssetInput {
  id: string
  slug?: string
  item_type?: string
  name?: string
  display?: { image_url?: string } | null
}

/**
 * Cosmetics are authored with underscore template slugs but several uploaded identifiers use hyphens. The shared
 * cosmetic resolver owns that alias map; this final step also sends those identifiers to their actual quilt class
 * instead of asking the item quilt for a file that only exists in `cosmetic_icon`. That class still depends on the
 * item's category — HAT/CLOAK render through the worn-mannequin `cosmetic_icon` quilt, but TITLE cosmetics (e.g.
 * the veteran scroll) publish under the ordinary `item` quilt, same split `shop_item_icon` uses for shop sales.
 */
export function encyclopedia_item_asset(
  item: EncyclopediaItemAssetInput,
  resolve_icon: ItemIconResolver = item_icon_url
) {
  const cosmetic_identifier = cosmetic_icon_of(item)
  const asset_class = icon_asset_class(item.item_type)
  // Production ships an EMPTY seed catalog (virtual:item_catalog — see vite.config.ts), so `item.slug` is
  // absent for every /v1 row and the key comes from `item_type` — the authored art slug (chain_icon_slug),
  // unique on every one of the 1854 live rows; the generic family word is `category`, never item_type. A row
  // with no item_type degrades to '' (the glyph), never a guess from the display name. Chain-truth twin:
  // inventory_item_icon threads the same chain_icon_slug so bag and encyclopedia can never diverge.
  const icon = cosmetic_identifier ?? item.slug ?? chain_icon_slug(item)
  return {
    // The art `id` deliberately never falls back to `item.id` (the runtime Sui object address is not an art
    // identity — that path 404'd every icon); an underivable icon degrades to '' so ItemImage paints the glyph.
    id: icon ?? '',
    image_url: (cosmetic_identifier && resolve_icon(cosmetic_identifier, { asset_class })) || item.display?.image_url,
  }
}

// ── mob portraits (#1880) ────────────────────────────────────────────────────────────────────────
// A `/v1` mob row carries `template_id` + `name` and NO key, so a name must become a key somewhere.
// `mob_slugs.json` is that map and the population boundary in one: 374 rows, one unique key each,
// exactly the /v1 mob names, and every one of its keys serves 200 as `mobs/<key>.png` (probed
// 2026-08-02). It is therefore the ONLY thing this resolver may consult.
//
// What it replaces, and why neither half was a boundary: the old path slugified the display name
// (`Aragog's child` -> `aragog_s_child`, 404 — the real key is `aragog_child`) and then gated the
// result on the published mob_catalog blob. That blob is a 779-key HISTORICAL UNION in which all 779
// entries carry a `glb`, so the gate rejected nothing and every derived key reached the network: 135
// of the 374 live mobs asked for a key that does not exist, each miss tripled by mob_image's retry
// ladder. A name transform can only ever approximate a key; the map IS the key.
//
// The 404 wall was never an out-of-population problem. Every name #1880 cited as "not in the live
// population" is a live mob whose SLUGIFIED key 404'd — Fire Goblin is `firegoblin` (not
// `fire_goblin`), Shore Gull is `gull_campcaw`, Plaza Chicklet is `plaza_pecker`. They are recovered
// here, not degraded. The only live rows with no portrait are the 9 hand-authored bosses whose art
// does not exist yet; they resolve to null and paint the glyph until it lands.
//
// Staleness fails SAFE for the same reason: a mob published after this map's last refresh resolves to
// null and paints the glyph (zero requests, one aggregated warn) instead of hammering the CDN.
//
// Null-prototype: mob names come off-chain, and a row named `constructor`/`toString` would otherwise
// inherit an Object.prototype member and compose a garbage URL out of a function.
const PORTRAIT_KEYS: Record<string, string> = Object.assign(Object.create(null), live_population)

/** A mob's own published-portrait key, or null when the live population has no portrait for it.
 * `catalog_name_of` first: /v1 serves the DISPLAY string for an overridden mob ('Shambling Draugr')
 * while the map is keyed by the raw chain name ('Retarded Draugr' -> `draugr_retarded`). */
export function mob_portrait_key(name?: string | null): string | null {
  return PORTRAIT_KEYS[catalog_name_of(name)] ?? null
}

// Unresolved names are reported ONCE, aggregated: the bestiary renders a whole page in one tick and
// the retry ladder re-renders each miss, so a per-mob warn is a console flood. Names already reported
// never warn again; a later burst gets its own single line.
const pending_misses = new Set<string>()
const reported_misses = new Set<string>()
let flush_queued = false

function flush_portrait_misses(): void {
  flush_queued = false
  if (!pending_misses.size) return
  const names = [...pending_misses].sort()
  for (const name of names) reported_misses.add(name)
  pending_misses.clear()
  console.warn(
    `[mob-portrait] ${names.length} mob(s) have no published portrait — rendering the fallback glyph: ${names.join(', ')}`
  )
}

function note_portrait_miss(name: string): void {
  if (reported_misses.has(name) || pending_misses.has(name)) return
  pending_misses.add(name)
  if (flush_queued) return
  flush_queued = true
  queueMicrotask(flush_portrait_misses)
}

/** Encyclopedia mob art has one permitted origin: the MinIO asset host's `mobs` family. */
export function encyclopedia_mob_icon_url(
  mob: { name?: string },
  hd = false,
  resolve_icon: MobIconResolver = mob_icon_url
): string | null {
  const key = mob_portrait_key(mob.name)
  if (!key) {
    if (mob.name) note_portrait_miss(mob.name)
    return null
  }
  return resolve_icon(`${key}${hd ? '_hd' : ''}.png`)
}

/** Test seam (mirrors set_catalog_for_test): forget every reported/pending miss. */
export function reset_portrait_misses_for_test(): void {
  pending_misses.clear()
  reported_misses.clear()
  flush_queued = false
}
