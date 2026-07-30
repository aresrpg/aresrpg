// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Pure resolution logic for ONE FightReport victory-card loot tile (FightReport.jsx's LootTile) — split out
// so the D53 rendering CONTRACT (a loot slot must NEVER render as an empty un-hoverable box, no matter how
// broken the drop's metadata is) is unit-testable without mounting the Tooltip's lazy hover portal (its
// <ItemDetailView> body only actually renders once a real DOM fires the hover-intent timer — SSR/renderToStaticMarkup
// never does). Mirrors the deck-key-arm.js / deck-crit-glow.js split next door: DeckCluster keeps pure
// decision logic in a co-located helper so it tests independently of the component tree.
//
// `resolved` names the three honest data sources that can back a drop: the player's live bag snapshot,
// the exact ItemTemplate row, or an injected live template-id → render-slug join. Neither present means the
// drop is a genuine orphan — the caller then renders the D53 bold-letter fallback instead of <ItemIcon>.

import { to_item_view } from './item-view.js'
import { inventory_item_icon } from './inventory-equip.js'
import { onchain_template_to_detail_props } from '../../../components/items'

/** A raw item_type slug humanized into words — the fallback name below the template/bag name, above the
 *  literal '?' last resort. Mirrors onchain_template_to_detail_props' OWN last-resort convention (slug →
 *  space-separated words, no title-casing) so the tile's label and the tooltip's header never disagree.
 * @param {string | null | undefined} item_type
 * @returns {string}
 */
const item_type_label = (item_type) =>
  String(item_type ?? '')
    .replace(/_/g, ' ')
    .trim()

const template_id_of = (item) => String(item?.template_id ?? item?.template ?? '')

const raw_item_of = (entry, items, template_id) => {
  if (entry.item_id) return items.find((item) => item.id === entry.item_id) ?? null
  const matching_items = template_id
    ? items.filter((item) => template_id_of(item) === template_id)
    : items.filter((item) => item.item_type === entry.item_type)
  // Aggregate/legacy rows may still borrow same-template presentation metadata, but never its object id/stats.
  return matching_items[matching_items.length - 1] ?? null
}

const stable_name_key = (name) =>
  String(name ?? '')
    .trim()
    .toLowerCase()

const template_of = (entry, template_map, template_id) => {
  const exact = template_id ? template_map.get(template_id) : null
  if (exact) return exact

  // Template object ids re-mint on every publish, while the fight-result row already carries the authored
  // name. Resolve a stale receipt id against the live catalog by that stable key before considering item_type:
  // several stackable families legitimately carry a generic class word such as "resource" there.
  const name_key = stable_name_key(entry.name)
  if (name_key) {
    const named = [...template_map.values()].find((candidate) => stable_name_key(candidate?.name) === name_key)
    if (named) return named
  }
  return template_map.get(entry.item_type) ?? null
}

const loot_name_of = (entry, raw, template) =>
  [template?.name, raw?.name, entry.name, item_type_label(entry.item_type)].find(Boolean) ?? '?'

const category_of = (raw, view, template) => (raw ? view?.category : (template?.category ?? view?.category))

const icon_of = ({ entry, raw, template, name, category, published_slug }) => {
  const candidate = inventory_item_icon({
    ...(raw ?? {}),
    ...(template ?? {}),
    name,
    item_type: entry.item_type,
    slug: published_slug ?? template?.slug ?? template?.item_type ?? raw?.slug,
  })
  // Generic item classes do not name an asset. With no published slug or authored cosmetic/icon alias,
  // start on ItemIcon's semantic category glyph instead of requesting a known-bad /items/resource.png.
  const generic_class = String(entry.item_type ?? '').toLowerCase() === String(category ?? '').toLowerCase()
  return generic_class && candidate === entry.item_type ? null : candidate
}

/**
 * @typedef {{ item_id?: string, template_id?: string, item_type: string, icon_slug?: string, name: string, amount: number }} LootEntry
 */

/**
 * Resolve one loot entry against the player's bag + the encyclopedia template map into everything LootTile
 * needs to render: whether it's genuinely backed by data, the best available name, the category (for
 * ItemIcon's own glyph fallback), and the tooltip's detail props.
 * @param {LootEntry} entry
 * @param {any[]} items live bag snapshot (state.sui.items), used for exact instance enrichment
 * @param {Map<string, any>} template_map exact template id → chain template row, plus legacy item_type keys
 * @param {((tmpl: any, field: 'name' | 'description') => string) | undefined} tt use_template_t() resolver
 * @param {(key: string, opts?: any) => string} t
 * @param {Record<string, string>} [slug_by_template_id] live ItemTemplate id → authored render slug
 * @param {Record<string, number> | null} [rolled_stats] exact owned instance's centered-u16 StatsKey block
 */
export function resolve_loot_tile(entry, items, template_map, tt, t, slug_by_template_id = {}, rolled_stats = null) {
  const template_id = template_id_of(entry)
  // An item_type such as "resource" is a class, not identity. Once the receipt carries an exact template,
  // never join it to an arbitrary sibling merely because both rows share that class.
  const raw = raw_item_of(entry, items, template_id)
  const view = to_item_view(raw ?? { item_type: entry.item_type, name: entry.name, amount: entry.amount })
  const tmpl = template_of(entry, template_map, template_id)
  const published_slug = template_id ? slug_by_template_id[template_id] : undefined
  const resolved = [raw, tmpl, published_slug].some(Boolean)
  const name = loot_name_of(entry, raw, tmpl)
  const category = category_of(raw, view, tmpl)
  const icon = icon_of({
    entry,
    raw,
    template: tmpl,
    name,
    category,
    published_slug,
  })
  const detail = onchain_template_to_detail_props(
    {
      ...(tmpl ?? {}),
      name,
      item_type: entry.item_type,
      icon_slug: icon,
      level: tmpl?.level ?? view?.level ?? 0,
      // truly bare (no template row, no bag match, and not even a name rode the wire): say so honestly in
      // the tooltip instead of a blank/garbled description. Any name at all (even without a template) skips
      // the disclaimer — "whatever fields exist" renders as-is, never a false "unavailable" claim.
      display: resolved
        ? tmpl?.display
        : { description: entry.name ? undefined : t('fight_end.loot_metadata_unavailable') },
      // OWNED instance, never a template preview — a victory-card loot tile is the drop the player just
      // got (freshly rolled, real), so every stat comes from this exact object's rolled StatsKey block.
      owned: true,
      rolled_stats,
    },
    tt
  )
  return {
    resolved,
    name,
    category,
    icon,
    item_id: entry.item_id ?? null,
    detail,
  }
}
