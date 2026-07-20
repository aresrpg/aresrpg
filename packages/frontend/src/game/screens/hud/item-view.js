// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Canonical item presentation model (c143) — the SINGLE normalized shape every item surface renders
// through <ItemCard>: inventory, the encyclopedia detail modal, jobs/crafting, the marketplace. One card,
// one model, identical everywhere. `to_item_view()` maps BOTH a raw on-chain/inventory item (flat stat
// fields, `item_category`) AND a seeded `items.json` ItemDef (`stats: { name: [min,max] }`, `category`)
// into one ItemView, so callers never branch on the source shape.

import { item_icon_url } from '@aresrpg/sdk/jobs'

import action_icon from '../../assets/statistics/action.png'
import movement_icon from '../../assets/statistics/movement.png'
import range_icon from '../../assets/statistics/range.png'
import vitality_icon from '../../assets/statistics/vitality.png'
import wisdom_icon from '../../assets/statistics/wisdom.png'
import strength_icon from '../../assets/statistics/strength.png'
import intelligence_icon from '../../assets/statistics/intelligence.png'
import chance_icon from '../../assets/statistics/chance.png'
import agility_icon from '../../assets/statistics/agility.png'
import crit_icon from '../../assets/statistics/crit.png'
import raw_damage_icon from '../../assets/statistics/raw_damage.png'

import { quality_color } from './quality.js'

// item stat field -> display label, accent colour + stat ICON. Ported 1:1 from the AresRPG donor
// item-description.vue (incl. its resistance->primary icon reuse). Each stat renders as an icon + value +
// name ROW (the donor's format), never a chip.
const STAT_META =
  /** @type {Record<string, { label: string, color: string, icon: string }>} */ ({
    vitality: { label: 'Vitality', color: '#7ee081', icon: vitality_icon },
    wisdom: { label: 'Wisdom', color: '#b07cff', icon: wisdom_icon },
    strength: { label: 'Strength', color: '#c9a24b', icon: strength_icon },
    intelligence: {
      label: 'Intelligence',
      color: '#ff5a3c',
      icon: intelligence_icon,
    },
    chance: { label: 'Chance', color: '#5db4ff', icon: chance_icon },
    agility: { label: 'Agility', color: '#9be37d', icon: agility_icon },
    action: { label: 'AP', color: '#5db4ff', icon: action_icon },
    ap: { label: 'AP', color: '#5db4ff', icon: action_icon },
    movement: { label: 'MP', color: '#7ee081', icon: movement_icon },
    mp: { label: 'MP', color: '#7ee081', icon: movement_icon },
    range: { label: 'Range', color: '#9be37d', icon: range_icon },
    critical: { label: 'Critical', color: '#ffce85', icon: crit_icon },
    raw_damage: { label: 'Damage', color: '#ff8a5c', icon: raw_damage_icon },
    earth_resistance: {
      label: 'Earth res',
      color: '#c9a24b',
      icon: strength_icon,
    },
    fire_resistance: {
      label: 'Fire res',
      color: '#ff5a3c',
      icon: intelligence_icon,
    },
    water_resistance: {
      label: 'Water res',
      color: '#5db4ff',
      icon: chance_icon,
    },
    air_resistance: { label: 'Air res', color: '#9be37d', icon: agility_icon },
  })
const STAT_KEYS = Object.keys(STAT_META)

// element -> colour for the damage lines: the house ramp SSOT, re-exported under the legacy name.
export { ELEMENT_COLORS as ELEMENT_COLOR } from './element-colors.js'

// category key -> human TYPE label for the header. Unmapped keys fall back to a title-cased key.
const TYPE_LABEL = /** @type {Record<string, string>} */ ({
  sword: 'Sword',
  dagger: 'Dagger',
  axe: 'Axe',
  hammer: 'Hammer',
  bow: 'Bow',
  wand: 'Wand',
  staff: 'Staff',
  scythe: 'Scythe',
  shovel: 'Shovel',
  pickaxe: 'Pickaxe',
  // chain category value (item::verify_category) is camelCase `fishingRod`; `fishing_rod` is the
  // seeded items.json fine-category spelling — both resolve to the same label.
  fishingRod: 'Fishing Rod',
  fishing_rod: 'Fishing Rod',
  hat: 'Helmet',
  cloak: 'Cloak',
  amulet: 'Amulet',
  ring: 'Ring',
  belt: 'Belt',
  boots: 'Boots',
  pet: 'Pet',
  mount: 'Mount',
  relic: 'Relic',
  rune: 'Rune',
  title: 'Title',
  consumable: 'Consumable',
  resource: 'Resource',
  pants: 'Trousers',
  chestplate: 'Chestplate',
  gauntlets: 'Gauntlets',
})

const title_case = (/** @type {string} */ s) =>
  String(s ?? '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())

const type_label = (/** @type {string} */ cat) =>
  TYPE_LABEL[cat] ?? title_case(cat)

/**
 * @typedef {{
 *   __view: true,
 *   id: string | null,
 *   name: string,
 *   level: number | null,
 *   category: string,
 *   type_label: string,
 *   tint: string,
 *   icon: string | null,
 *   stats: Array<{ key: string, label: string, color: string, icon: string, min: number, max: number }>,
 *   damages: Array<{ element: string, min: number, max: number }>,
 *   set: string | null,
 *   amount: number | null,
 *   craftable: boolean,
 *   description: string | null,
 * }} ItemView
 */

/** Already a normalized view? (lets ItemCard accept either a view or a raw item without re-mapping.) */
export const is_item_view = (/** @type {any} */ x) => !!x && x.__view === true

/**
 * Normalize a raw inventory item OR a seeded items.json ItemDef into the canonical ItemView.
 * @param {any} raw
 * @returns {ItemView | null}
 */
export function to_item_view(raw) {
  if (!raw) return null
  if (is_item_view(raw)) return raw

  const category = raw.category ?? raw.item_category ?? 'misc'
  const level = typeof raw.level === 'number' ? raw.level : null

  // stats — ItemDef carries `stats: { name: [min,max] }`; a raw item carries flat numeric fields.
  const def_stats =
    raw.stats && typeof raw.stats === 'object' && !Array.isArray(raw.stats)
      ? raw.stats
      : null
  // ItemDef: iterate its OWN stat keys (vocab is `ap`/`mp`/`range`/...) with a graceful fallback for
  // any unmapped key. Raw item: scan the known flat fields (vocab is `action`/`movement`/...).
  const fallback_meta = (/** @type {string} */ key) =>
    STAT_META[key] ?? { label: title_case(key), color: '#a9b4c4', icon: '' }
  const stats = def_stats
    ? Object.entries(def_stats).flatMap(([key, v]) => {
        if (v == null) return []
        const [min, max] = Array.isArray(v) ? v : [v, v]
        if (!min && !max) return []
        const meta = fallback_meta(key)
        return [
          {
            key,
            label: meta.label,
            color: meta.color,
            icon: meta.icon,
            min,
            max,
          },
        ]
      })
    : STAT_KEYS.flatMap(key => {
        const v = raw[key]
        if (!v) return []
        const meta = STAT_META[key]
        return [
          {
            key,
            label: meta.label,
            color: meta.color,
            icon: meta.icon,
            min: v,
            max: v,
          },
        ]
      })

  const damages = (Array.isArray(raw.damages) ? raw.damages : [])
    .map((/** @type {any} */ d) => ({
      element: String(d.element ?? 'neutral').toLowerCase(),
      min: d.min ?? d.from ?? 0,
      max: d.max ?? d.to ?? 0,
    }))
    .filter(d => d.min || d.max)

  const set =
    raw.item_set && raw.item_set !== 'none'
      ? raw.item_set
      : (raw.set ?? raw.item_set_id ?? null)

  const amount = typeof raw.amount === 'number' ? raw.amount : null
  // HIDE the amount when the item is uncraftable. A seeded ItemDef has no live stack; a raw
  // stack carries `amount`. `craftable` defaults from the data (explicit flag wins).
  const craftable =
    raw.craftable ?? raw.is_craftable ?? (raw.recipe != null || amount != null)
  const icon_key = raw.slug ?? raw.icon ?? raw.id ?? null
  const icon = typeof icon_key === 'string' && !/^0x[0-9a-f]+$/i.test(icon_key) ? icon_key : null

  return {
    __view: true,
    id: raw.id ?? null,
    name: raw.name ?? raw.symbol ?? raw.id ?? 'Unknown',
    level,
    category,
    type_label: type_label(category),
    // NO QUALITY TIERS: the residual quality/rarity template field is
    // deliberately dropped here — views are tier-blind; the tint is the one neutral tone.
    tint: quality_color(),
    icon,
    stats,
    damages,
    set,
    amount,
    craftable: !!craftable,
    description: raw.description ?? null,
  }
}

/** Resolve a view's HD icon URL (kept here so the URL law stays in one place). */
export const item_view_icon_url = (/** @type {ItemView} */ view) => item_icon_url(view.icon, { hd: true })
