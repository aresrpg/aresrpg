// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// T64 TEMPLATE reads — chain-direct (no server) readers for the game-content catalog: `template::MobTemplate`
// and `template::ItemTemplate` (both SHARED objects, so there's no "list owned objects" shortcut — we replay
// the mint events to discover every template id ever minted, then batch-fetch the live objects). Feeds the
// admin TEMPLATES tab (mob/item sub-tabs) — replaces the dead backend `fetch_templates('mob'|'item')` WS call.
//
// IMPORTANT SCOPE NOTE (flagged for owner review): the on-chain MobTemplate/ItemTemplate shape is a MUCH
// thinner content model than the legacy reference-backend template schema the admin editors were built for
// (mob_editor.tsx / item_editor.tsx). Several UI fields have NO on-chain equivalent at all (mob: appearance,
// boss, xpReward/karesReward, respawn timers, behavior/phases, equipment slots, i18n; item: description,
// quality, tradeable, appearance, recipe/gathering/consumable JSON, i18n) — normalize_* below simply omits
// them, so the editor renders those inputs empty. See write_templates.js for the write-side gaps (category
// vocabulary mismatch, stat fields with no UI slot).

import { normalizeStructTag } from '@mysten/sui/utils'

import { STAT_BIAS, decode_stat } from './stat_bias'
import { get_sdk } from './sdk'
import { replay_events } from './query_events'

/** spell::Stats element discriminants (spell.move: FIRE=0, WATER=1, EARTH=2, AIR=3, NONE=255). The mob editor's
 * ELEMENTS dropdown only offers EARTH/FIRE/WATER/AIR (no NONE option) — a NONE-element template normalizes to
 * '' (unselected) rather than fabricating a choice. */
const ELEMENT_NAMES = ['FIRE', 'WATER', 'EARTH', 'AIR']

// ORPHAN-TEMPLATE GUARD (permanent robustness filter, not a one-off cleanup): event-replay discovery means
// get_mob_templates/get_item_templates surface EVERY id ever minted, including stray/legacy objects from
// pre-fix seed scripts that don't match the CURRENT on-chain shape (e.g. a pre-fix item with an uppercase
// "RING" category, or a pre-v2 mob missing the level-range/hp fields). The fresh publish's clean seed makes
// today's orphans moot, but a future re-seed or partial migration could reintroduce them — this guard is
// the permanent safety net so a stray/legacy template never renders as real content in the encyclopedia/admin.

// Mirrors item.move's `verify_category` lowercase domain EXACTLY (the on-chain assert the mint path enforces).
// An ItemTemplate whose `item_category` isn't in this set can only be a pre-fix orphan (verify_category would
// have rejected it on a live mint), so it's filtered rather than surfaced as real content.
const VALID_ITEM_CATEGORIES = new Set([
  'misc',
  'consumable',
  'relic',
  'rune',
  'mount',
  'hat',
  'cloak',
  'cosmetic_helmet',
  'cosmetic_cloak',
  'amulet',
  'ring',
  'belt',
  'boots',
  'bow',
  'wand',
  'staff',
  'dagger',
  'scythe',
  'axe',
  'hammer',
  'shovel',
  'sword',
  'fishingRod',
  'pickaxe',
  'key',
  'resource',
  'pet',
  'title',
])

function normalize_element(el) {
  return ELEMENT_NAMES[Number(el)] ?? ''
}

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
 * Normalize a MobTemplate's decoded `fields` into the flat shape mob_editor.tsx / templates_tab.tsx expect.
 * @param {Record<string, any>} f  the MobTemplate struct's decoded `fields`
 * @param {string} id  the MobTemplate object id
 */
export function normalize_mob_template(f, id) {
  // on-chain `level` is a SINGLE u16, but the editor has a minLevel/maxLevel RANGE — both are set to the same
  // value (GUESS: there is no on-chain min/max spread to recover). Flagged for owner review.
  const level = Number(f.level ?? 0)
  // #23 gRPC json:true flattens nested structs (no `.fields` wrapper) — keep the legacy `.fields` path for jsonRpc.
  const stats = f.stats?.fields ?? f.stats ?? {}
  // post-#22-A ABI: `loot` is a `vector<MobLootEntry>` — each entry a struct
  // { item_template: ID, chance_bp: u16 (0..10000), min_qty: u16, max_qty: u16 }. Sui's showContent
  // decodes a nested struct as `{ type, fields }`, so read the fields off `entry.fields` (falling back to
  // `entry` for a flat shape). Map into the { item, chance, amount } shape the LootEditor/ReadOnlyView expect:
  // item = item_template id, chance = chance_bp/10000 (0..1 fraction), amount = [min_qty, max_qty].
  const loot_entries = (f.loot ?? []).map((entry) => {
    const lf = entry?.fields ?? entry ?? {}
    return {
      // `item_template` is an `ID` inside the MobLootEntry struct: gRPC json:true gives a flat string, but
      // jsonRpc showContent can wrap it as `{ fields: { id } }` — mirror read_dungeon.get_mob_loot_item_templates.
      item: String(lf.item_template?.fields?.id ?? lf.item_template ?? ''),
      chance: Number(lf.chance_bp ?? 0) / 10000,
      amount: [Number(lf.min_qty ?? 1), Number(lf.max_qty ?? 1)],
    }
  })
  return {
    id,
    name: String(f.name ?? ''),
    minLevel: level,
    maxLevel: level,
    health: Number(f.hp ?? 0),
    element: normalize_element(f.element),
    strength: Number(stats.strength ?? 0),
    intelligence: Number(stats.intelligence ?? 0),
    chance: Number(stats.chance ?? 0),
    agility: Number(stats.agility ?? 0),
    rawDamage: Number(stats.raw_damage ?? 0),
    criticalHit: Number(stats.critical_hit ?? 0),
    // Resistances are CENTERED @32768 (item_stats stat-neutral law) — decode through the single stat_bias home
    // so the editor / ReadOnlyView / bestiary render the REAL signed value (e.g. 32775 → +7), not the raw biased
    // int. A missing field reads STAT_BIAS → 0 (neutral), matching decoded_tuple's default above.
    earthResistance: decode_stat(stats.earth_resistance ?? STAT_BIAS),
    fireResistance: decode_stat(stats.fire_resistance ?? STAT_BIAS),
    waterResistance: decode_stat(stats.water_resistance ?? STAT_BIAS),
    airResistance: decode_stat(stats.air_resistance ?? STAT_BIAS),
    // xp awarded on a winning fight (dungeon_mob scales off it); a mob minted before xp_reward existed reads 0.
    xpReward: Number(f.xp_reward ?? 0),
    // REAL per-entry loot metadata now that MobLootEntry structs carry chance_bp + qty range (see loot_entries).
    lootJson: JSON.stringify(loot_entries),
    // raw attached item-template ids, so the write layer can diff "already on-chain" vs "newly added" loot
    // (add_loot_to_mob is APPEND-ONLY — there is no remove/replace on the live ABI).
    _onchain_loot_ids: loot_entries.map((e) => e.item),
  }
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

/** Replay the package-scoped Move event feed, returning every `template` id emitted. (#23 GraphQL event-replay.) */
async function collect_template_ids(graphql_client, event_type) {
  const rows = await replay_events(graphql_client, event_type)
  const ids = []
  for (const { parsedJson } of rows) {
    const id = parsedJson?.template
    if (id) ids.push(String(id))
  }
  return ids
}

/**
 * Batch-fetch objects by id (chunk at 50) with content+type+display.
 * #23 gRPC: fetches via `get_sdk().grpc_client.core.getObjects({include:{json,display}})` (was the jsonRpc batch
 * read) — the event-replay discovery lane (collect_template_ids) stays jsonRpc for P2's GraphQL.
 * Returns the raw gRPC `Object|Error` entries; callers read `.json` / `.objectId` / `.display.output`.
 */
async function multi_get_content(ids) {
  const { grpc_client } = await get_sdk()
  const out = []
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50)
    const { objects } = await grpc_client.core.getObjects({
      objectIds: chunk,
      include: { json: true, display: true },
    })
    out.push(...(objects ?? []))
  }
  return out
}

/**
 * Every `MobTemplate` ever minted on `package_id` — replays `MobTemplateCreated` events for the ids (shared
 * objects have no "list all of type X" RPC), then batch-fetches + normalizes the live objects.
 * @param {import('@mysten/sui/graphql').SuiGraphQLClient} graphql_client  (GraphQL client — used ONLY for the event-replay discovery lane; objects are fetched via gRPC internally, #23)
 * @param {string} package_id  the live T62 package id
 */
export async function get_mob_templates(graphql_client, package_id) {
  let event_type
  try {
    event_type = normalizeStructTag(`${package_id}::template::MobTemplateCreated`)
  } catch {
    return []
  }
  const ids = await collect_template_ids(graphql_client, event_type)
  if (ids.length === 0) return []
  const objects = await multi_get_content(ids)
  return objects
    .map((o) => {
      // #23 gRPC: entries are `Object|Error`; json:true exposes the flat struct. unresolved (deleted/wrapped/miss) → drop.
      if (o instanceof Error) return null
      const f = o?.json
      if (!f) return null
      // orphan TAG (not drop): pre-v2 mobs predate template.move's min_level/max_level/base_hp fields — a decoded
      // object missing any of them is a stale/legacy template. We TAG `_orphan` rather than drop, so the ADMIN
      // editor still lists ALL on-chain templates (it can badge orphans); only the ENCYCLOPEDIA excludes them
      // (useOnchainTemplates {orphans:'exclude'}). Dropping in the shared reader hid the admin list entirely.
      const _orphan = f.min_level === undefined || f.max_level === undefined || f.base_hp === undefined
      return { ...normalize_mob_template(f, o.objectId), _orphan }
    })
    .filter(Boolean)
}

/**
 * Every `ItemTemplate` ever minted on `package_id` — same replay-events-then-fetch approach as
 * `get_mob_templates`.
 * @param {import('@mysten/sui/graphql').SuiGraphQLClient} graphql_client  (GraphQL client — used ONLY for the event-replay discovery lane; objects are fetched via gRPC internally, #23)
 * @param {string} package_id  the live T62 package id
 */
export async function get_item_templates(graphql_client, package_id) {
  let event_type
  try {
    // ROOT-CAUSE FIX (2026-07-14): item.move's module is `item`, and the event it emits is `TemplateCreated`
    // (item.move:104) — there is no `template` module and no `ItemTemplateCreated` struct on the merged
    // package. The stale `template::ItemTemplateCreated` filter matched zero events, so every
    // get_template_map()/get_template_by_item_type_map() consumer (equip/consumable/crush/lootbox/marketplace/
    // scribe/admin-editor) silently resolved an EMPTY template map — surfaced as "[lootbox] could not resolve
    // the box template (item_type=pet_lootbox)". craft_actions.js already documented + worked around this exact
    // mismatch (proven on-chain 2026-07-11) instead of fixing the shared reader; this is the root-cause fix.
    event_type = normalizeStructTag(`${package_id}::item::TemplateCreated`)
  } catch {
    return []
  }
  const ids = await collect_template_ids(graphql_client, event_type)
  if (ids.length === 0) return []
  const objects = await multi_get_content(ids)
  return objects
    .map((o) => {
      // #23 gRPC: entries are `Object|Error`; json:true exposes the flat struct. unresolved (deleted/wrapped/miss) → drop.
      if (o instanceof Error) return null
      const f = o?.json
      if (!f) return null
      // orphan TAG (not drop): item.move's `verify_category` is lowercase-only, so a template whose category
      // isn't in the domain (e.g. a pre-fix uppercase "RING") is a stray/legacy seed object. TAG `_orphan` so
      // the ADMIN editor still lists it (badge-able); only the ENCYCLOPEDIA excludes it ({orphans:'exclude'}).
      const _orphan = !VALID_ITEM_CATEGORIES.has(String(f.item_category ?? ''))
      // #23 gRPC: Display is `object.display.output` (was jsonRpc `o.data.display.data`) — the interpolated field map.
      return { ...normalize_item_template(f, o.objectId, o.display?.output), _orphan }
    })
    .filter(Boolean)
}
