// Pure resolution logic for ONE FightReport victory-card loot tile (FightReport.jsx's LootTile) — split out
// so the D53 rendering CONTRACT (a loot slot must NEVER render as an empty un-hoverable box, no matter how
// broken the drop's metadata is) is unit-testable without mounting the Tooltip's lazy hover portal (its
// <ItemDetailView> body only actually renders once a real DOM fires the hover-intent timer — SSR/renderToStaticMarkup
// never does). Mirrors the deck-key-arm.js / deck-crit-glow.js split next door: DeckCluster keeps pure
// decision logic in a co-located helper so it tests independently of the component tree.
//
// `resolved` names the ONLY two data sources that back a drop: the player's live bag snapshot (`items`,
// keyed by item_type — a real chain-owned instance) and the encyclopedia template map (`template_map`,
// keyed by item_type — the seeded ItemTemplate row). Neither present means the drop is a genuine orphan
// (an item_type that never landed in the read-model AND never got an encyclopedia row — e.g. a QA test
// mob's ad hoc loot template) — the caller then renders the D53 bold-letter fallback (DeckCluster's
// SpellSocket art-fail idiom, ported) instead of <ItemIcon>, never a bare box.

import { to_item_view } from './item-view.js'
import { quality_color } from './quality.js'
import { onchain_template_to_detail_props } from '../../../components/items'

/** A raw item_type slug humanized into words — the fallback name below the template/bag name, above the
 *  literal '?' last resort. Mirrors onchain_template_to_detail_props' OWN last-resort convention (slug →
 *  space-separated words, no title-casing) so the tile's label and the tooltip's header never disagree.
 * @param {string | null | undefined} item_type
 * @returns {string}
 */
const item_type_label = (item_type) => String(item_type ?? '').replace(/_/g, ' ').trim()

/**
 * @typedef {{ item_type: string, name: string, amount: number }} LootEntry
 */

/**
 * Resolve one loot entry against the player's bag + the encyclopedia template map into everything LootTile
 * needs to render: whether it's genuinely backed by data, the best available name, the rarity tint, the
 * category (for ItemIcon's own glyph fallback), and the tooltip's detail props.
 * @param {LootEntry} entry
 * @param {any[]} items live bag snapshot (state.sui.items) — the SAME array the drop's item_type was aggregated from
 * @param {Map<string, any>} template_map encyclopedia item_type → template row (empty until the async fetch lands)
 * @param {((tmpl: any, field: 'name' | 'description') => string) | undefined} tt use_template_t() resolver
 * @param {(key: string, opts?: any) => string} t
 */
export function resolve_loot_tile(entry, items, template_map, tt, t) {
  const raw = items.find((it) => it.item_type === entry.item_type) ?? null
  const view = to_item_view(raw ?? { item_type: entry.item_type, name: entry.name, amount: entry.amount })
  const tmpl = template_map.get(entry.item_type) ?? null
  const resolved = !!raw || !!tmpl
  const name = tmpl?.name || entry.name || item_type_label(entry.item_type) || '?'
  const detail = onchain_template_to_detail_props(
    {
      ...(tmpl ?? {}),
      name,
      item_type: entry.item_type,
      level: tmpl?.level ?? view?.level ?? 0,
      // truly bare (no template row, no bag match, and not even a name rode the wire): say so honestly in
      // the tooltip instead of a blank/garbled description. Any name at all (even without a template) skips
      // the disclaimer — "whatever fields exist" renders as-is, never a false "unavailable" claim.
      display: resolved ? tmpl?.display : { description: entry.name ? undefined : t('fight_end.loot_metadata_unavailable') },
    },
    tt,
  )
  return {
    resolved,
    name,
    tint: view?.tint ?? quality_color('common'),
    category: view?.category ?? tmpl?.category,
    detail,
  }
}
