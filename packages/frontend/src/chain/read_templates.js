// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Shared ItemTemplate normalization for the SDK detail reader and the `/v1` encyclopedia projection.

import { STAT_BIAS, decode_stat } from './stat_bias'

// S-61: UI (camelCase, ITEM_STAT_FIELDS) -> on-chain item_stats field (snake_case). ALL 17 `ItemStatistics`
// fields now have a UI slot, so this is a complete 1:1 mirror of the merged `item_stats::ItemStatistics` block.
// `criticalHit` is the UI alias for chain `critical`; `criticalChance`/`criticalOutcomes` are the crit split.
// Dead legacy keys (`heal`/`stamina`/`summons`/`pods`) have no on-chain analog and are simply absent.
export const ITEM_STAT_KEY_MAP = {
  vitality: 'vitality',
  wisdom: 'wisdom',
  strength: 'strength',
  intelligence: 'intelligence',
  chance: 'chance',
  agility: 'agility',
  range: 'range',
  movement: 'movement',
  action: 'action',
  criticalHit: 'critical',
  rawDamage: 'raw_damage',
  criticalChance: 'critical_chance',
  criticalOutcomes: 'critical_outcomes',
  earthResistance: 'earth_resistance',
  fireResistance: 'fire_resistance',
  waterResistance: 'water_resistance',
  airResistance: 'air_resistance',
}

// Every on-chain item_stats field now maps through ITEM_STAT_KEY_MAP (the full 17-field mirror), so no read-only
// "extra" fields remain. Kept as an (empty) export for the read/write round-trip contract in normalize_item_template.
export const ITEM_STAT_EXTRA_KEYS = []

// DECODE HOME: turn a biased on-chain stat pair into a real signed [min,max], or `null` when it's the
// neutral [32768,32768] sentinel (a missing chain field is neutral too → decode(STAT_BIAS)=0). Neutral
// stats are DROPPED from statsJson so every downstream surface (editor, tooltip, encyclopedia, admin
// readonly) renders real values only — no per-surface decode, no zero-stat clutter. write_templates.js
// re-encodes (real → +32768), defaulting dropped keys back to neutral, so the round trip is lossless.
function decoded_tuple(min_fields, max_fields, chain_key) {
  const lo = decode_stat(min_fields[chain_key] ?? STAT_BIAS)
  const hi = decode_stat(max_fields[chain_key] ?? STAT_BIAS)
  // item_stats.move's roll_field treats hi <= lo as DEGENERATE — the roll is FIXED at lo, never a real
  // spread. Mirror that collapse here, or a half-absent field (the /v1 projection's null-half-is-neutral
  // convention) or a misauthored template decodes into an inverted line ("+3 to 0 Vitality", live-reported
  // issue #437: min 32771 → +3, the absent max half defaulted to neutral 0 independently of it).
  const [min, max] = hi <= lo ? [lo, lo] : [lo, hi]
  if (min === 0 && max === 0) return null
  return [min, max]
}

/**
 * The SHARED item-stat decode: two BIASED on-chain stat blocks (`min`, `max`, each `{ chain_key: u16 }`)
 * → the real-valued `{ uiKey: [min, max] }` characteristics object every item surface renders (camelCase
 * UI keys via ITEM_STAT_KEY_MAP, neutral [0,0] stats dropped). This is the ONE decode home reused by both
 * the SDK read path (normalize_item_template) and the /v1 stat projection (read_findables.get_template_map,
 * issue #219) — so the +32768 un-bias, the snake→camel rename, and the neutral-drop live exactly once.
 * @param {Record<string, number>} min biased min-half block, keyed by on-chain (snake_case) stat name
 * @param {Record<string, number>} max biased max-half block
 * @returns {Record<string, [number, number]>}
 */
export function decode_item_stat_ranges(min, max) {
  const stats_json = {}
  const put = (key, tuple) => {
    if (tuple) stats_json[key] = tuple
  }
  for (const [ui_key, chain_key] of Object.entries(ITEM_STAT_KEY_MAP)) put(ui_key, decoded_tuple(min, max, chain_key))
  for (const chain_key of ITEM_STAT_EXTRA_KEYS) put(chain_key, decoded_tuple(min, max, chain_key))
  return stats_json
}

/**
 * The SHARED weapon-damage decode (issue #619): the on-chain `item_damages::ItemDamages` lines — from the SDK's
 * canonical template read or the identical `/v1/encyclopedia` projection — normalized for display. Only the
 * `element` slug is touched (uppercased to the one convention ELEMENT_COLORS and the seed catalog rows already
 * use); `damage_type` stays the chain's own lowercase slug, which ItemDetailView keys its life_steal label off.
 * A template with no DamagesKey field decodes to `[]` — honest-empty, never a fabricated line.
 * @param {Array<{ from?: number, to?: number, damage_type?: string, element?: string }> | null | undefined} lines
 * @returns {Array<{ from: number, to: number, damage_type: string, element: string }>}
 */
export function decode_item_damages(lines) {
  return (Array.isArray(lines) ? lines : []).map((line) => ({
    from: Number(line?.from ?? 0),
    to: Number(line?.to ?? 0),
    damage_type: String(line?.damage_type ?? ''),
    element: String(line?.element ?? '').toUpperCase(),
  }))
}

/**
 * Normalize an ItemTemplate's decoded `fields` into the flat shape item_editor.tsx / templates_tab.tsx expect.
 * @param {Record<string, any>} f  the ItemTemplate struct's decoded `fields`
 * @param {string} id  the ItemTemplate object id
 */
export function normalize_item_template(f, id, display) {
  // #23 gRPC json:true flattens the nested ItemStatistics structs (no `.fields` wrapper) — keep `.fields` for jsonRpc.
  const min = f.stats_min?.fields ?? f.stats_min ?? {}
  const max = f.stats_max?.fields ?? f.stats_max ?? {}
  const stats_json = decode_item_stat_ranges(min, max)
  return {
    id,
    name: String(f.name ?? ''),
    // D240 — the consumable heal MAGNITUDE, so every item surface can answer "how much does this potion grant?".
    // D135 add-HP consumables carry it as the TEMPLATE's `effect_amount` (what character_health::consume reads);
    // the legacy/dungeon path reads the item's `heal_amount` (stamped from the same template field on mint). Both
    // agree for a well-seeded potion, so surface `effect_amount` first, `heal_amount` as the back-compat fallback.
    // Emitted as the SAME `{ type:'LIFE_REGEN', amount }` shape the WS consumable_json used, so ConsumableEffectLine
    // renders it unchanged (single decode home). Non-heal / 0-heal items get null (no effect line).
    consumable_effect: (() => {
      const amount = Number(f.effect_amount ?? 0) || Number(f.heal_amount ?? 0)
      return amount > 0 ? { type: 'LIFE_REGEN', amount } : null
    })(),
    // the asset SLUG (e.g. "white_whool") — ItemImage builds `items/{item_type}.png`. Distinct from the object
    // `id`; passing the object id to ItemImage 404s (the WorldCard bug). Encyclopedia + world cards pass this.
    item_type: String(f.item_type ?? ''),
    // #619 — the SDK's canonical template read (`get_item_template`) already decodes the DamagesKey DF into
    // `{from,to,damage_type,element}`; carry it so the chain-direct surfaces that skip /v1 (the recall/receipt
    // detail map) render a weapon's damage block too. Raw gRPC template json has no such field (it is a DF) → [].
    damages: decode_item_damages(f.damages),
    // MISMATCH (flagged, see write_templates.js): the on-chain category domain (item.move's verify_category —
    // lowercase: misc/consumable/relic/rune/mount/hat/cloak/cosmetic_helmet/cosmetic_cloak/amulet/ring/belt/
    // boots/bow/wand/staff/dagger/scythe/axe/hammer/shovel/sword/fishingRod/pickaxe/key/resource/pet/title) is
    // a DIFFERENT vocabulary from the UI's ITEM_CATEGORIES (HELMET/CHESTPLATE/LONGSWORD/BATTLEAXE/TOOL_*/etc,
    // the legacy reference gear-slot taxonomy). We just uppercase whatever's on-chain so it round-trips through
    // the dropdown as text — it will often not match any ITEM_CATEGORIES option exactly.
    // FIELD-NAME FIX (2026-07-14, discovered fixing the event-type bug above): item.move's ItemTemplate struct
    // field is `category` (item.move:83-91) — there is no `item_category` field on this struct (that name is
    // the on-chain ITEM's field, a different type). Reading the wrong key meant `category` decoded to '' for
    // every template once the event filter actually returned rows, which also mistagged every template
    // `_orphan` (VALID_ITEM_CATEGORIES never matches '').
    category: String(f.category ?? '').toUpperCase(),
    level: Number(f.level ?? 0),
    statsJson: JSON.stringify(stats_json),
    // DISPLAY-FIRST: the on-chain Display resolution (name/image_url/description) from the read layer
    // (o.data.display?.data). Surfaces prefer this over slug-built URLs; null for reads without showDisplay.
    display: display ? { name: display.name, image_url: display.image_url, description: display.description } : null,
  }
}
