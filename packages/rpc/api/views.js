// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// View handlers for the AresRPG RPC read layer (SPEC §14).
//
// Each handler returns a descriptor `{ status, data, headers? }` (see respond.js)
// and reads the Redis read-model the Rust indexer projects from chain events
// (indexer/src/handlers/ares/ — the key shapes are the cross-language CONTRACT,
// mirrored below). `/health` and `/v1/status` are liveness; the game views serve
// real data over that cache. Views take the request's URLSearchParams.
//
// Read-only and re-derivable: everything here is a pure read of public chain
// truth. Money amounts (MIST) travel as strings to survive JSON's 2^53; counts,
// coordinates and levels are numbers.

import { get_json, get_str, mget_json, ping, smembers, zcard, zrange, zrangebyscore, zrevrange } from './redis.js'
import { resolve_names } from './suins.js'

// Redis keys / index sets written by the indexer. Kept in sync BY CONTRACT with
// the Rust side (indexer/src/handlers/ares/project.rs) — no shared constant
// across languages, so this is the documented mirror.
const LATEST_CHECKPOINT_KEY = 'rpc:checkpoint:latest'
const CHECKPOINTS_WATERMARK_KEY = 'rpc:watermark:checkpoints'
const K = {
  character: (id) => `rpc:character:${id}`,
  charOwner: (addr) => `rpc:idx:char_owner:${addr}`,
  charName: (name) => `rpc:idx:char_name:${name}`,
  item: (id) => `rpc:item:${id}`,
  petFeed: (id) => `rpc:pet_feed:${id}`,
  petFeedFoods: 'rpc:idx:pet_feed_foods',
  ownerKiosks: (addr) => `rpc:idx:owner_kiosks:${addr}`, // a wallet → the personal kiosks it owns
  kiosk: (id) => `rpc:kiosk:${id}`, // per-kiosk doc { kiosk_id, cap_id, owner }
  kioskItems: (kiosk) => `rpc:idx:kiosk_items:${kiosk}`, // a kiosk → the item ids held in it (monotonic)
  listing: (id) => `rpc:listing:${id}`,
  listings: 'rpc:idx:listings',
  salesLog: (kiosk) => `rpc:sales_log:${kiosk}`, // per-kiosk marketplace sales log (sorted set, score = sale ts)
  sellerKiosks: (seller) => `rpc:idx:seller_kiosks:${seller}`, // seller → their kiosk(s)
  salesOverTime: 'rpc:sales_over_time', // first-party shop receipts (sorted set, score = purchase ts)
  pool: (id) => `rpc:pool:${id}`,
  poolByTemplate: (t) => `rpc:pool_by_template:${t}`,
  pools: 'rpc:idx:pools',
  sale: (id) => `rpc:sale:${id}`,
  sales: 'rpc:idx:sales',
  world: (id) => `rpc:world:${id}`,
  worlds: 'rpc:idx:worlds',
  zone: (world, m) => `rpc:zone:${world}:${m}`,
  zones: (world) => `rpc:idx:zones:${world}`,
  rareLink: (world, template) => `rpc:rare_link:${world}:${template}`,
  rareLinks: (world) => `rpc:idx:rare_links:${world}`,
  template: (id) => `rpc:template:${id}`,
  templates: 'rpc:idx:templates',
  supply: (template) => `rpc:supply:${template}`, // { template, amount } — NUMINCRBY mint/burn counter (indexer/HANDLERS.md)
  lastsale: (template) => `rpc:lastsale:${template}`, // { template, price_mist, ts } — last realised per-unit sale (shop/pool/kiosk)
  mobTemplate: (id) => `rpc:mob_template:${id}`,
  mobTemplates: 'rpc:idx:mob_templates',
  recipe: (id) => `rpc:recipe:${id}`,
  recipes: 'rpc:idx:recipes',
  config: 'rpc:config',
  creation: 'rpc:creation',
  kolizeum: (id) => `rpc:kolizeum:${id}`,
  kolizeums: 'rpc:idx:kolizeums',
  fight: (id) => `rpc:fight:${id}`,
  fightJournal: (id) => `rpc:fight:${id}:journal`, // per-fight ORDERED event journal (sorted set; score = checkpoint, rank = seq)
  charFight: (c) => `rpc:char_fight:${c}`,
  fights: (world) => `rpc:idx:fights:${world}`,
  groupTemplate: (world, spawn_id) => `rpc:group_template:${world}:${spawn_id}`, // (world,spawn_id) → the fight's mob-group MobTemplate id (zones::MobGroupClaimed) — joined onto a fight to name its mobs

  result: (id) => `rpc:result:${id}`,
  results: (owner) => `rpc:idx:results:${owner}`,
  pendingOutcome: (id) => `rpc:pending_outcome:${id}`,
  pendingOutcomes: (owner) => `rpc:idx:pending_outcomes:${owner}`, // sorted set (score = checkpoint ts)
  petClaims: (owner) => `rpc:petclaims:${owner}`, // one doc per owner: { owner, claims: { "<claim_id>": "<rolled_template>" } }
  run: (pass) => `rpc:run:${pass}`,
  runs: (owner) => `rpc:idx:runs:${owner}`,
  protectorTrigger: (gatherer) => `rpc:protector_trigger:${gatherer}`, // a gatherer → their latest §17.22 ambush signal
  commission: (id) => `rpc:commission:${id}`,
  commissionsByArtisan: (addr) => `rpc:idx:commissions_by_artisan:${addr}`, // commissions offered TO this artisan
  commissionsByCustomer: (addr) => `rpc:idx:commissions_by_customer:${addr}`, // commissions this wallet opened

  taux: (id) => `rpc:taux:${id}`,
  tauxIdx: 'rpc:idx:taux',
  tauxBracket: (b) => `rpc:taux:bracket:${b}`,
  tauxMeta: 'rpc:taux_meta',
}

// CDN treatment for the data views: short shared cache + ETag (added in respond.js).
const CACHE = { 'cache-control': 'public, max-age=5' }
const ok = (data) => ({ status: 200, headers: CACHE, data })
const bad = (message) => ({ status: 400, data: { error: 'bad_request', message } })

// Fetch every doc behind an index set in one JSON.MGET, dropping missing keys.
async function read_index(index_key, doc_key) {
  const ids = await smembers(index_key)
  const docs = await mget_json(ids.map(doc_key))
  return docs.filter(Boolean)
}

// --- liveness ----------------------------------------------------------------

// Process liveness only (never touches Redis, never rate-limited) so orchestrators
// get a truthful "is the API up" signal. Store health lives in /v1/status.
export function handle_health() {
  return { status: 200, data: { status: 'ok', service: 'aresrpg-rpc-api' } }
}

// --- indexer status + lag ----------------------------------------------------

export async function handle_status() {
  if (!(await ping())) {
    return { status: 503, data: { status: 'degraded', redis: 'down' } }
  }

  const latest = await get_json(LATEST_CHECKPOINT_KEY)
  if (!latest) {
    return {
      status: 200,
      data: { status: 'starting', redis: 'up', indexed: false, note: 'no checkpoint ingested yet' },
    }
  }

  const watermark = await get_json(CHECKPOINTS_WATERMARK_KEY)
  const lag_ms = Math.max(0, Date.now() - Number(latest.timestamp_ms))

  return {
    status: 200,
    headers: { 'cache-control': 'public, max-age=2' },
    data: {
      status: 'ok',
      redis: 'up',
      network: latest.network ?? null,
      indexed: true,
      latest_checkpoint: Number(latest.sequence_number),
      epoch: Number(latest.epoch),
      checkpoint_timestamp_ms: Number(latest.timestamp_ms),
      committer_watermark: watermark ? Number(watermark.checkpoint_hi_inclusive) : null,
      lag_ms,
      lag_seconds: Math.round(lag_ms / 1000),
    },
  }
}

// The u8 job index → job SLUG map. The indexer object-snapshots each per-job XP dynamic field
// (character_link::JobXpKey, banked by gather/craft/forgemagie) onto the character doc as
// `jobs: { "<job u8>": <absolute total xp> }` — a numeric-index block, exactly like `stats`. The
// index → slug ordering is the SDK JOBS array (@aresrpg/sdk/jobs — the SINGLE SSOT the JobsDrawer +
// job_progression detector read); mirrored here (not imported, no cross-package dep — the same
// documented-mirror discipline as the stat index → name map) so the served map is keyed by the slug
// the client reads (`character.jobs['miner']`). Append-only: never reorder (it is the on-chain index).
const JOB_IDS = [
  'farmer',
  'herbalist',
  'miner', // gathering (0-2)
  'sword_smith',
  'axe_smith',
  'blunt_smith',
  'staff_carver',
  'bowyer', // weapon (3-7)
  'armorsmith',
  'tailor',
  'tanner',
  'jeweler', // equipment (8-11)
  'alchemist',
  'baker',
  'handyman', // consumable / utility (12-14)
]

// The fields equipment::equipment_stats::deltas can populate in the fight's `spell::Stats` block.
// `critical_chance`/`critical_outcomes` are item-authoring fields but deliberately do not enter combat.
const EQUIPMENT_STAT_KEYS = [
  'vitality',
  'wisdom',
  'strength',
  'intelligence',
  'chance',
  'agility',
  'range',
  'movement',
  'action',
  'critical',
  'raw_damage',
  'earth_resistance',
  'fire_resistance',
  'water_resistance',
  'air_resistance',
]

/** Fight-authoritative equipment contribution: positive cache minus active malus cache. */
export function fold_equipment_stats(positive, malus) {
  if (positive == null) return null
  return Object.fromEntries(
    EQUIPMENT_STAT_KEYS.map((key) => [key, Number(positive[key] ?? 0) - Number(malus?.[key] ?? 0)])
  )
}

/** Withhold cross-pipeline mixtures until the EquipmentMap snapshot reaches the identity event checkpoint. */
export function derive_equipment_stats(character, equipment_count) {
  if (character.gear_positive == null) return equipment_count === 0 ? {} : null
  if (character.equipment_cursor != null) {
    const identity_checkpoint = Number(character.equipment_cursor.checkpoint ?? 0)
    const identity_tx = Number(character.equipment_cursor.tx_index ?? 0)
    const gear_checkpoint = Number(character.gear_cursor?.checkpoint ?? 0)
    const gear_tx = Number(character.gear_cursor?.tx_index ?? 0)
    if (gear_checkpoint < identity_checkpoint || (gear_checkpoint === identity_checkpoint && gear_tx < identity_tx))
      return null
  }
  return fold_equipment_stats(character.gear_positive, character.gear_malus)
}

// The equipped-item categories that render as a WORN GLB on the avatar (SPEC §7.11 — a cosmetic hat
// renders instead of headgear; a cloak on the back). Keyed by the on-chain item `category`
// (equipment.move slot vocab). These are surfaced under the character's `worn` map so the frontend's
// resolve_worn_cosmetics (which reads character.hat / character.cloak) can mount them; combat gear
// (helmet/chestplate/weapons/…) uses the vanilla appearance system, NOT a worn GLB, so it is not here.
const WORN_CATEGORIES = new Set(['hat', 'cloak'])

// Add only the fields owned by the pet-feed projection. An absent per-pet doc is authoritative
// never-fed state (0/0), while food eligibility is exact set membership from FoodPowerSet events.
export function pet_projection_fields(category, feed_state, template_id, allowed_food_templates) {
  if (category === 'pet') {
    return {
      feed_count: Number(feed_state?.feed_count ?? 0),
      next_feed_at_ms: Number(feed_state?.next_feed_at_ms ?? 0),
    }
  }
  if (category === 'resource') {
    return { pet_feed_allowed: allowed_food_templates?.has(template_id) === true }
  }
  return {}
}

// EquipmentMap.pet is the current authority; the sibling Item supplies identity independently.
// `true + null` honestly represents an indexer snapshot gap, while false suppresses stale identity.
// Rebuild the nested object explicitly so this closed view never leaks projection internals.
function character_pet_projection(character) {
  const pet_equipped = character.pet_equipped === true
  const value = character.pet
  const pet =
    pet_equipped &&
    typeof value?.item_id === 'string' &&
    typeof value?.template_id === 'string' &&
    typeof value?.slug === 'string'
      ? { item_id: value.item_id, template_id: value.template_id, slug: value.slug }
      : null
  return { pet, pet_equipped }
}

// --- characters --------------------------------------------------------------
// Bulk profiles for world-presence rendering. `?ids=` (comma-separated ids) or
// `?owner=` (a Sui address). `colors`, `male`, `experience` and `level` are
// object-state fields (the Character's Customization + base experience, no event
// carries them) served by the `ares_snapshot` pipeline; they return null until that
// pipeline has snapshotted the character. `kiosk_id` is the kiosk that holds this
// (always kiosk-locked, §11) character — derived generically from checkpoint object
// ownership by `ares_snapshot` (a kiosk-locked object's owner is its dynamic-object-
// field wrapper, whose owner is the kiosk); null until snapshotted. `owner` is the
// creator until on-chain-owner indexing tracks kiosk transfers. `equipment`/`world`/
// `position` are event-sourced. The §3 allocated stats (vitality/wisdom/strength/
// intelligence/agility/chance) are event-sourced (`stat_allocation::StatRaised`);
// `available_points` is derived from `level` (snapshot) minus the spent allocations. `jobs`
// (`{ [job_slug]: total_xp }`) is object-snapshotted from the per-job JobXpKey DFs (SDK JOBS order
// → slug), absent-safe ({} before the first gather/craft) — the JobsDrawer + job-progression read it.
// `listed` (always computed, never null) is joined against `rpc:listing:{id}` — the SELL/kolizeum
// character picker's "already on the market, exclude me" signal (S-87 — kills the kiosk-SDK sell walk).
export async function handle_characters(params) {
  const ids_param = params.get('ids') ?? params.get('id') // ?id= (single) or ?ids= (list)
  const owner = params.get('owner')

  let ids
  if (ids_param)
    ids = ids_param
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  else if (owner) ids = await smembers(K.charOwner(owner))
  else return bad('provide ?ids=<comma-separated ids> or ?owner=<address>')

  const docs = (await mget_json(ids.map(K.character))).filter(Boolean)

  // Equipped-item CATEGORY join (read-time, exactly like /v1/listings): the `extract::ItemEquipped`
  // event carries only { item, template, amount } — an item's category (hat/cloak/…) lives on the item
  // TEMPLATE object snapshot (`rpc:template:{id}`.category, written by snapshot.rs). Batch-join every
  // equipped template in ONE read, then resolve template → category for the equipment rows + the
  // `worn` cosmetic slots below. A not-yet-snapshotted template → null category (renders the gap).
  const equip_templates = [
    ...new Set(
      docs.flatMap((c) =>
        Object.values(c.equipment ?? {})
          .map((v) => v.template)
          .filter(Boolean)
      )
    ),
  ]
  const equip_item_ids = [...new Set(docs.flatMap((c) => Object.keys(c.equipment ?? {})))]
  // LISTED join (read-time, same idiom): a character is kiosk-locked (§11) and lists exactly like an
  // item (native `0x2::kiosk::ItemListed` — HANDLERS.md "Listings"), so `rpc:listing:{id}` exists under
  // the CHARACTER's own id while it's on the market. This is the SELL/kolizeum picker's "already listed,
  // exclude me" signal — no new projection, just a join against the existing listings doc.
  const [tpl_docs, listing_docs, pet_feed_docs] = await Promise.all([
    equip_templates.length ? mget_json(equip_templates.map(K.template)) : [],
    docs.length ? mget_json(docs.map((c) => K.listing(c.id))) : [],
    equip_item_ids.length ? mget_json(equip_item_ids.map(K.petFeed)) : [],
  ])
  const category_of = new Map(equip_templates.map((t, i) => [t, tpl_docs[i]?.category ?? null]))
  const listed_by_id = new Map(docs.map((c, i) => [c.id, !!listing_docs[i]]))
  const pet_feed_by_id = new Map(equip_item_ids.map((id, i) => [id, pet_feed_docs[i]]))

  const characters = docs.map((c) => {
    // §3 STAT ALLOCATION — the per-stat block is stored indexed 0-5 on the doc (the
    // `stat_allocation::StatRaised` event carries each stat's new absolute total); the
    // index→name map is character_link.move's STAT_* constants. `available_points` is
    // DERIVED here (never banked on-chain): the stat half of the per-level grant
    // ((level−1)×5, level from the object snapshot) MINUS Σ allocations — the flat 1:1
    // cost makes Σ allocations == the points spent. Field names mirror read_character's
    // CharacterFields (vitality/wisdom/strength/intelligence/agility/chance + available_points).
    const stats = c.stats ?? {}
    const alloc = (i) => Number(stats[i] ?? 0)
    const spent = alloc(0) + alloc(1) + alloc(2) + alloc(3) + alloc(4) + alloc(5)
    const earned = c.level != null ? Math.max(0, (Number(c.level) - 1) * 5) : 0
    // §-jobs JOB PROGRESSION — the indexer's numeric-index `jobs` block (`{ "<job u8>": <absolute
    // total xp> }`, object-snapshotted from the character_link::JobXpKey DFs) remapped to the SLUG
    // the client reads. `character.jobs['miner'] = <total xp>`; job_progression derives the level via
    // job_level(xp), so the RAW total is served (never a pre-derived level). Absent → {} (level 1 / 0 xp).
    const jobs = {}
    for (const [idx, xp] of Object.entries(c.jobs ?? {})) {
      const slug = JOB_IDS[Number(idx)]
      if (slug) jobs[slug] = Number(xp) || 0
    }
    // Equipment rows enriched with the joined category (null until the template is snapshotted).
    const equipment = Object.entries(c.equipment ?? {}).map(([item_id, v]) => {
      const category = category_of.get(v.template) ?? null
      return {
        item_id,
        template: v.template,
        category,
        amount: v.amount,
        ...pet_projection_fields(category, pet_feed_by_id.get(item_id), v.template),
      }
    })
    // The SAME aggregate fight folds: allocated base + EquipmentMap.gear − active malus cache. A character
    // with no equipment map and no rows is exactly empty; equipped pre-backfill rows stay honestly null.
    const equipment_stats = derive_equipment_stats(c, equipment.length)
    // WORN COSMETIC SLOTS (hat/cloak) keyed by category — the shape resolve_worn_cosmetics reads once
    // rpc_to_card spreads `worn` onto the render character. `template_id` is the GLB key
    // (cosmetics/<template_id>.glb). Single-slot categories, so a straight category → item map.
    const worn = {}
    for (const e of equipment)
      if (WORN_CATEGORIES.has(e.category))
        worn[e.category] = { item_id: e.item_id, template_id: e.template, category: e.category }
    const { pet, pet_equipped } = character_pet_projection(c)
    return {
      id: c.id,
      owner: c.owner ?? null,
      name: c.name ?? null,
      class: c.class ?? null,
      male: c.male ?? null, // object snapshot — the Display slug is {class}_{male}
      colors: c.colors ?? null, // object snapshot: { color_1, color_2, color_3 }
      level: c.level ?? null, // object snapshot (derived from experience)
      experience: c.experience ?? null, // object snapshot
      kiosk_id: c.kiosk_id ?? null, // object snapshot — the kiosk holding this (kiosk-locked) character
      listed: listed_by_id.get(c.id) ?? false, // joined against rpc:listing:{id} — already on the market?
      world: c.world ?? null,
      position: c.position ?? null,
      // §3 allocated stats (0 before the first raise) + the derived unspent pool
      vitality: alloc(0),
      wisdom: alloc(1),
      strength: alloc(2),
      intelligence: alloc(3),
      agility: alloc(4),
      chance: alloc(5),
      available_points: Math.max(0, earned - spent),
      // LIVE HP — the RAW stored current hp + the lazy-regen last-touch stamp, object-snapshotted from
      // the character_link::Progression DF. The CLIENT runs the §5.4 natural-regen projection; the
      // indexer NEVER pre-computes regen. `equipment_stats` is the signed equipment aggregate; the allocated
      // `vitality` above stays separate, so the client folds both and derives max HP via the chain's formula
      // progression_math::max_hp_from_base = base_hp(class ClassRow) + (level−1)×HP_PER_LEVEL +
      // effective vitality: vitality is added 1:1 (the ×5 is the per-LEVEL slope, HP_PER_LEVEL),
      // and the base is the per-class ClassRow base, not a flat 100. `0` hp (a defeated character)
      // survives `?? null`; derived equipment stays null until the snapshot catches the identity event.
      current_hp: c.current_hp ?? null,
      hp_updated_ms: c.hp_updated_ms ?? null,
      gear_vitality: c.gear_vitality ?? null,
      equipment_stats,
      pet,
      pet_equipped,
      jobs, // { [job_slug]: total_xp } — the JobsDrawer + job-progression detector read this map
      equipment, // [{ item_id, template, category, amount }] — category joined from the template snapshot
      worn, // { [category]: { item_id, template_id, category } } — the GLB-worn cosmetic slots (hat/cloak)
    }
  })
  return ok({ characters })
}

// --- owner items (the loose kiosk-locked bag, per wallet) --------------------
// A wallet's loose (unequipped) Items, UNIONED across the personal kiosks it owns — the
// architectural home of read_staking.js's chain-direct walk (getOwnedKiosks → N× getKiosk →
// batched getObjects). Every Item is personal-kiosk-locked (§11 constitution), so "owned" =
// held by a kiosk whose PersonalKioskCap this wallet owns. The join the indexer set up:
//   owner → kiosks (+cap)   `owner_kiosks` / `kiosk` docs, from PersonalKioskCap ownership
//   kiosk → item ids        `kiosk_items` sets, SADD'd as each Item resolves into a kiosk
//   item id → item doc      name/category/type/amount/level + its CURRENT `kiosk_id`
// The `kiosk_items` sets are MONOTONIC (an item that moved/burned lingers in its old set), so
// every row is RECONCILED against the item doc's live `kiosk_id`: kept only while that kiosk is
// still one THIS wallet owns — a since-moved item (now in someone else's kiosk) and a burned
// item (doc gone) both drop out. `kiosk_cap_id` is threaded from the kiosk doc (the burn/extract
// PTBs — dungeon key-burn, pool crush — target the RIGHT kiosk with it). `listed` (always computed)
// is joined against `rpc:listing:{id}` — the SELL picker's "already on the market, exclude me" signal
// (S-87 — kills the kiosk-SDK sell walk in read_listings.js). `?address=` required.
export async function handle_owner_items(params) {
  const address = params.get('address')
  if (!address) return bad('provide ?address=<address>')

  const kiosks = await smembers(K.ownerKiosks(address))
  if (kiosks.length === 0) return ok({ items: [] })

  const kiosk_docs = await mget_json(kiosks.map(K.kiosk))
  const cap_by_kiosk = new Map(kiosks.map((k, i) => [k, kiosk_docs[i]?.cap_id ?? null]))

  // Union the item-id sets across the wallet's kiosks (dedupe: an item that hopped between two
  // of the wallet's OWN kiosks sits in both sets).
  const id_sets = await Promise.all(kiosks.map((k) => smembers(K.kioskItems(k))))
  const ids = [...new Set(id_sets.flat())]
  if (ids.length === 0) return ok({ items: [] })

  const [docs, listing_docs, pet_feed_docs, allowed_food_templates] = await Promise.all([
    mget_json(ids.map(K.item)),
    mget_json(ids.map(K.listing)),
    mget_json(ids.map(K.petFeed)),
    smembers(K.petFeedFoods),
  ])
  const allowed_foods = new Set(allowed_food_templates)
  const items = []
  ids.forEach((id, i) => {
    const d = docs[i]
    if (!d) return // burned / not-yet-snapshotted → drop (monotonic-set reconciliation)
    const { kiosk_id } = d
    if (!kiosk_id || !cap_by_kiosk.has(kiosk_id)) return // moved out of this wallet's kiosks → drop
    items.push({
      id: d.id,
      template_id: d.template ?? null,
      kiosk_id,
      kiosk_cap_id: cap_by_kiosk.get(kiosk_id),
      name: d.name ?? '',
      // On-chain the field is `category`; the whole client bag keys off `item_category` (the
      // single rename home mirrors read_staking.js). `stackable` is DERIVED client-side.
      item_category: d.category ?? '',
      item_set: '', // no on-chain item_set field on Item (parity with chain-direct `f.item_set ?? ''`)
      item_type: d.item_type ?? '',
      level: Number(d.level ?? 0), // event-sourced scribe level (null → 0 for the unscribed majority)
      amount: Number(d.amount ?? 1),
      listed: !!listing_docs[i],
      // The Item object's OWN Move package id (issue #524 server half — snapshot.rs's
      // map_item_object writes it off the object's own type tag). Lets a dead-universe lineage
      // filter (`is_aresrpg_item`-equivalent) run on THIS primary read path, matching the
      // chain-direct fallback (read_findables.js) that already filters by `.type`.
      package: d.package ?? null,
      ...pet_projection_fields(d.category, pet_feed_docs[i], d.template, allowed_foods),
    })
  })
  return ok({ items })
}

// --- listings ----------------------------------------------------------------
// Kiosk marketplace listings, then filtered / sorted / paginated. The feed is the
// native Sui kiosk event (`0x2::kiosk::ItemListed`), which fires for BOTH items
// and characters (both kiosk-locked, §11). Template/category/amount/level/name are
// joined at read time: an item listing resolves against its existing item snapshot
// (category remains the historical item_type field; item_category is the raw category);
// a character listing has no item doc, so it resolves against the character doc
// (category "character", amount 1, name, and level once object snapshots land).
export async function handle_listings(params) {
  const category = params.get('category')
  const min_level = params.get('min_level') != null ? Number(params.get('min_level')) : null
  const max_level = params.get('max_level') != null ? Number(params.get('max_level')) : null
  const sort = params.get('sort') ?? 'price_asc'
  const limit = Math.min(Math.max(Number(params.get('limit')) || 50, 1), 200)
  const cursor = Number(params.get('cursor')) || 0

  const ids = await smembers(K.listings)
  const [listings, items, characters] = await Promise.all([
    mget_json(ids.map(K.listing)),
    mget_json(ids.map(K.item)),
    mget_json(ids.map(K.character)),
  ])

  let rows = listings
    .map((l, i) => {
      if (!l) return null
      const item = items[i]
      const character = characters[i] // a listed character (no item doc)
      return {
        item_id: l.item_id,
        kiosk_id: l.kiosk,
        // Native ItemListed carries only the object id. The canonical template,
        // stackability category, and live amount already sit on the indexed Item
        // object, so expose that existing read-time join for kiosk-native lot views.
        template_id: item?.template ?? null,
        item_category: item?.category ?? null,
        amount: item?.amount ?? (character ? 1 : null),
        category: item?.item_type ?? (character ? 'character' : null),
        level: item?.level ?? character?.level ?? null,
        name: character?.name ?? null, // characters carry a name; items render from template
        price_mist: l.price_mist,
        seller: l.seller,
      }
    })
    .filter(Boolean)

  if (category) rows = rows.filter((r) => r.category === category)
  if (min_level != null) rows = rows.filter((r) => r.level != null && r.level >= min_level)
  if (max_level != null) rows = rows.filter((r) => r.level != null && r.level <= max_level)

  const by_price = (a, b) => {
    const [x, y] = [BigInt(a.price_mist), BigInt(b.price_mist)]
    return x < y ? -1 : x > y ? 1 : 0
  }
  const cmp = {
    price_asc: by_price,
    price_desc: (a, b) => by_price(b, a),
    level_asc: (a, b) => (a.level ?? 0) - (b.level ?? 0),
    level_desc: (a, b) => (b.level ?? 0) - (a.level ?? 0),
  }
  rows.sort(cmp[sort] ?? cmp.price_asc)

  const page = rows.slice(cursor, cursor + limit)
  const next_cursor = cursor + limit < rows.length ? String(cursor + limit) : null
  return ok({ listings: page, total: rows.length, next_cursor })
}

// --- sales history (marketplace, seller-side) --------------------------------
// A seller's REALISED marketplace sales — "what we sold, when, at what price, to
// whom" + 30d revenue. The feed is the native kiosk purchase event
// (`0x2::kiosk::ItemPurchased { kiosk, id, price }`): the indexer appends each sale
// to a per-KIOSK sorted set (score = sale ts, member = {item,price_mist,buyer,ts})
// and records seller→kiosk at LISTING time — the purchase event carries the kiosk,
// not the seller, and a kiosk is 1:1 with its personal-kiosk owner. So `?seller=`
// resolves seller → kiosk(s) → the sales log. Buyer = the purchase tx sender.
// Item template/category/level are joined from the item doc at read time (like
// /v1/listings); a since-burned item resolves to null category. `revenue_30d_mist`
// is summed (BigInt → string) over the 30d window from the SAME rows — MIST never
// leaves the wire as a number. Retention (indexer contract, HANDLERS.md): newest
// 500 rows per kiosk + a 90d idle TTL, so the set is bounded and self-evicting.
export async function handle_sales_history(params) {
  const seller = params.get('seller')
  if (!seller) return bad('provide ?seller=<address>')
  const limit = Math.min(Math.max(Number(params.get('limit')) || 50, 1), 200)
  const cursor = Number(params.get('cursor')) || 0

  const kiosks = await smembers(K.sellerKiosks(seller))
  const empty = { seller, sales: [], revenue_30d_mist: '0', total: 0, next_cursor: null }
  if (kiosks.length === 0) return ok(empty)

  // One newest-first read per kiosk (each set is capped ≤500). Parse the JSON rows
  // the indexer ZADD'd; a personal seller has one kiosk, so this is ~one small read.
  const rowSets = await Promise.all(kiosks.map((k) => zrevrange(K.salesLog(k))))
  const rows = rowSets
    .flat()
    .map((m) => {
      try {
        return JSON.parse(m)
      } catch {
        return null
      }
    })
    .filter(Boolean)
    .sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0)) // newest first

  // revenue_30d = Σ price over the trailing 30d, from the same rows (BigInt-safe).
  const window_start = Date.now() - 30 * 24 * 60 * 60 * 1000
  let revenue = 0n
  for (const r of rows) {
    if (r.ts >= window_start) {
      try {
        revenue += BigInt(r.price_mist)
      } catch {
        /* skip a malformed row rather than fail the view */
      }
    }
  }

  const total = rows.length
  const page = rows.slice(cursor, cursor + limit)
  const items = await mget_json(page.map((r) => K.item(r.item))) // template/category join
  const sales = page.map((r, i) => ({
    item_id: r.item,
    template_id: items[i]?.template ?? null,
    category: items[i]?.item_type ?? null,
    level: items[i]?.level ?? null,
    price_mist: r.price_mist,
    buyer: r.buyer,
    sold_at_ms: r.ts,
  }))

  const next_cursor = cursor + limit < total ? String(cursor + limit) : null
  return ok({ seller, sales, revenue_30d_mist: revenue.toString(), total, next_cursor })
}

// --- first-party sales over time ---------------------------------------------
// Exact primary-shop revenue history from `shop::SaleBought` receipts. Each
// retained ZSET member is `{sale,item,price_mist,amount,ts}`; the unique minted
// item makes the indexer write replay-safe. `count` is units sold (Σ amount),
// `volume` is exact MIST received (Σ price × amount) and remains a string. The
// UTC calendar-day series is oldest-first and zero-filled for chart consumers.
const DAY_MS = 24 * 60 * 60 * 1000

export function sales_over_time_days(value) {
  const parsed = Math.trunc(Number(value) || 30)
  return Math.min(Math.max(parsed, 1), 365)
}

export function bucket_sales_over_time(members, days, now = Date.now()) {
  const today = Math.floor(now / DAY_MS) * DAY_MS
  const start = today - (days - 1) * DAY_MS
  const buckets = Array.from({ length: days }, (_, i) => ({
    day: new Date(start + i * DAY_MS).toISOString().slice(0, 10),
    count: 0,
    volume: 0n,
  }))
  const by_day = new Map(buckets.map((bucket) => [bucket.day, bucket]))

  for (const member of members) {
    try {
      const receipt = JSON.parse(member)
      const ts = Number(receipt.ts)
      const amount = Number(receipt.amount)
      if (!Number.isSafeInteger(ts) || !Number.isSafeInteger(amount) || amount < 0) continue
      const receipt_volume = BigInt(receipt.price_mist) * BigInt(amount)
      if (receipt_volume < 0n) continue
      const bucket = by_day.get(new Date(ts).toISOString().slice(0, 10))
      if (!bucket) continue
      bucket.count += amount
      bucket.volume += receipt_volume
    } catch {
      // A malformed cache row is skipped rather than taking down the whole view.
    }
  }

  return buckets.map(({ day, count, volume }) => ({ day, count, volume: volume.toString() }))
}

export async function handle_sales_over_time(params) {
  const days = sales_over_time_days(params.get('days'))
  const now = Date.now()
  const today = Math.floor(now / DAY_MS) * DAY_MS
  const window_start = today - (days - 1) * DAY_MS
  const receipts = await zrangebyscore(K.salesOverTime, window_start, now)
  return ok(bucket_sales_over_time(receipts, days, now))
}

// --- pools -------------------------------------------------------------------
// Constant-product AMM pools. `?template=` fetches one; else all. `sui_reserve`
// = virtual + real (the curve reserve); `spot_price_mist` = the marginal buy
// price of one item (curve math, pool-favored ceil) — null when a pool holds ≤1
// item (the last unit is unbuyable, price → ∞).
export async function handle_pools(params) {
  const template = params.get('template')

  let docs
  if (template) {
    const pool_id = await get_json(K.poolByTemplate(template))
    docs = pool_id ? [await get_json(K.pool(pool_id))].filter(Boolean) : []
  } else {
    docs = await read_index(K.pools, K.pool)
  }

  const pools = docs.map((p) => {
    const sui_reserve = BigInt(p.virtual_sui_mist) + BigInt(p.real_sui_mist)
    const n = BigInt(p.item_reserve)
    const spot = n > 1n ? (sui_reserve + (n - 2n)) / (n - 1n) /* ceil(sui_reserve / (n-1)) */ : null
    return {
      pool_id: p.pool,
      template_id: p.template,
      item_reserve: p.item_reserve,
      virtual_sui_mist: p.virtual_sui_mist,
      real_sui_mist: p.real_sui_mist,
      sui_reserve_mist: sui_reserve.toString(),
      spot_price_mist: spot != null ? spot.toString() : null,
      paused: p.paused,
    }
  })
  return ok({ pools })
}

// --- shop --------------------------------------------------------------------
// First-party shop sales. `supply_remaining` = supply − minted (null = unlimited).
// `?active=true` returns only sales that are unpaused, inside their time window,
// and not sold out.
export async function handle_shop(params) {
  const active = params.get('active') === 'true'
  const now = Date.now()

  let sales = (await read_index(K.sales, K.sale)).map((s) => {
    const remaining = s.supply == null ? null : Math.max(0, s.supply - (s.minted ?? 0))
    return {
      sale_id: s.sale,
      template_id: s.template,
      price_mist: s.price_mist,
      minted: s.minted ?? 0,
      supply_remaining: remaining,
      starts_ms: s.start_ms ?? null,
      ends_ms: s.end_ms ?? null,
      paused: s.paused ?? false,
    }
  })

  if (active) {
    sales = sales.filter(
      (s) =>
        !s.paused &&
        (s.starts_ms == null || now >= s.starts_ms) &&
        (s.ends_ms == null || now < s.ends_ms) &&
        (s.supply_remaining == null || s.supply_remaining > 0)
    )
  }
  return ok({ sales })
}

// --- zones -------------------------------------------------------------------
// Per-world discovery / zone state. `?world=` is required. Only discovered zones exist as data
// (SPEC §17.18), so every returned zone is discovered. SEARCH-COST REWORK (2026-07-13): the Zone DF
// stores `{ seed, consumed bitmaps }` — never spawn rows — so this view serves the RAW state and the
// CLIENT derives the rows (`@aresrpg/sim` derive_zone via the frontend zone_rows composer).
// `mob_groups`/`resource_nodes` are the LIVE counts: the ZoneSearched event's DERIVED totals minus the
// consumed-bitmap popcounts. Two forms:
//   ?world=            → the discovered-zone LIST (counts only — the compass/discovery overview)
//   ?world=&zone=zx:zy → ONE zone WITH its raw state (`seed`/`mob_bitmap`/`res_bitmap`) — feed into the
//                        client derivation. `seed` is undefined until the ares_snapshot pipeline has
//                        reached that Zone DF (the event arm lands the skeleton + counts first).
//                        FIGHT-CREATE COMPUTE DIET (2026-07-17): the state form also serves the
//                        search-committed mob-group commitment — `group_root` (the 32-byte Blake2b
//                        duplicate-last Merkle root as a plain byte array) + `group_count` (the FULL
//                        derivation-stream size, consumption-independent) — projected off the
//                        `zones::ZoneGroupRootKey` DF onto this same doc (snapshot.rs
//                        map_group_root_field). The client composes the ≤6-level claim witness from
//                        {seed-derived FULL stream + these two fields} via `@aresrpg/sdk`
//                        `compose_mob_group_proof`, which recomputes the root and FAILS SHUT (null →
//                        the original claim door) on any mismatch — so nulls here (pre-diet zone, or
//                        snapshot not yet landed) degrade cleanly, never break a claim.
const popcount = (bytes) =>
  (bytes ?? []).reduce((n, b) => {
    let v = Number(b) & 255
    while (v) {
      n += v & 1
      v >>= 1
    }
    return n
  }, 0)
const shape_zone = (z, with_state) => {
  const base = {
    zone_id: `${z.zx}:${z.zy}`,
    zx: z.zx,
    zy: z.zy,
    discovered: z.discovered,
    discovered_at_ms: z.discovered_at_ms,
    // LIVE counts = the event's derived totals minus consumed bits (never below 0 — a re-roll resets bits).
    mob_groups: Math.max(0, Number(z.mob_groups ?? 0) - popcount(z.mob_bitmap)),
    resource_nodes: Math.max(0, Number(z.resource_nodes ?? 0) - popcount(z.res_bitmap)),
  }
  // The raw zone state the client derivation consumes. Absent (list form); a pre-snapshot doc (event arm
  // only) has no `seed` yet → the client treats it as not-yet-derivable and retries next poll.
  if (with_state) {
    base.seed = z.seed
    // ABSENCE IS NOT EMPTINESS (cache law). The consumed-bitmaps are the only per-group liveness truth there
    // is, and since #596 a fetched cell REPLACES the client's rows — so serving `[]` for a bitmap that simply
    // has not been projected yet (a half-landed doc while the indexer re-anchors: the event arm wrote the
    // counts, `map_zone_field` has not written the state) would republish every consumed group as authoritative
    // live truth. OMIT the field instead: the client (zone_rows.js `zone_state_resolvable`) then tells
    // "nothing consumed" apart from "consumption unknown" and declines to derive rather than raising ghosts.
    if (Array.isArray(z.mob_bitmap)) base.mob_bitmap = z.mob_bitmap
    if (Array.isArray(z.res_bitmap)) base.res_bitmap = z.res_bitmap
    // The diet's witness ingredients, VERBATIM (never re-encoded — the SDK composer takes number[]).
    // null = no commitment projected (pre-diet zone / snapshot lag) → the client keeps the old door.
    base.group_root = z.group_root ?? null
    base.group_count = z.group_count ?? null
  }
  return base
}

export async function handle_zones(params) {
  const world = params.get('world')
  if (!world) return bad('provide ?world=<world id>')
  const zone = params.get('zone') // "zx:zy" — one zone WITH its raw derivation state

  const world_doc = await get_json(K.world(world))
  const envelope = { world, seed: world_doc?.seed ?? null, biome: world_doc?.biome ?? null }

  // Single-zone state read (the get_zone_spawns replacement) — direct doc GET, no index needed. An
  // undiscovered zone has no doc → empty `zones` array (the honest "unsearched" signal, like the SDK read).
  if (zone) {
    const z = await get_json(K.zone(world, zone))
    return ok({ ...envelope, zones: z ? [shape_zone(z, true)] : [] })
  }

  const discovered = params.get('discovered')
  let zones = []
  if (discovered !== 'false') {
    const members = await smembers(K.zones(world))
    zones = (await mget_json(members.map((m) => K.zone(world, m)))).filter(Boolean).map((z) => shape_zone(z, false))
  }
  return ok({ ...envelope, zones })
}

// --- rare links (§6 golden-gather jackpot legibility) ------------------------
// Which BASE resource templates carry an authored golden-variant link (`world::rare_link`,
// admin-authored per world) + the linked rare template id. Existence here is the "this
// resource can jackpot" truth the encyclopedia needs — the ROLL RATE itself is a fixed
// Move const (gathering.move RARE_BP, never event-projected), published as a UI constant,
// not served by this view. `?world=` scopes to one world; omitted unions every live world's
// links (the worlds set is small — testnet/mainnet scale, never a per-player fan-out).
export async function handle_rare_links(params) {
  const world_param = params.get('world')
  const worlds = world_param ? [world_param] : await smembers(K.worlds)

  const rows = []
  for (const world of worlds) {
    const templates = await smembers(K.rareLinks(world))
    if (templates.length === 0) continue
    const rare_ids = await mget_json(templates.map((t) => K.rareLink(world, t)))
    templates.forEach((template_id, i) => {
      if (rare_ids[i]) rows.push({ world, template_id, rare_template_id: rare_ids[i] })
    })
  }
  return ok({ rare_links: rows })
}

// --- encyclopedia ------------------------------------------------------------
// On-chain liveness of minted templates (SPEC §14 — if it isn't minted, it doesn't
// show). `?kind=items|mobs|worlds|recipes` filters. name/level/category (items) and name/
// level-range/hp/element (mobs) come from the object-snapshot pipeline (the mint
// EVENT carries only ids/item_type — the rest lives in the object contents, exactly
// like character cosmetics; see indexer/HANDLERS.md). Fields the snapshot has not yet
// reached are null/absent — the UI renders the gap, never fabricates it. `spells` is
// intentionally NOT served here: the client resolves minted SpellTemplates directly
// (fight-spells.json from the seed manifest), so no spell liveness view is keyed.
//
// `?ids=<a,b,c>` (items only, issue #219) is the per-id BATCH form — mirrors `/v1/taux?ids=`
// — for a caller that already knows which templates it needs (a shop listing, an inventory
// characteristics tooltip) instead of pulling the full ~1840-row liveness index. Absent →
// the existing full-index behavior, unchanged (additive).
export async function handle_encyclopedia(params) {
  const kind = params.get('kind')
  const want = (k) => !kind || kind === k
  const ids_param = params.get('ids')
  const item_ids = ids_param
    ? ids_param
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : null

  const [items, mobs, worlds, recipes] = await Promise.all([
    want('items')
      ? item_ids
        ? (await mget_json(item_ids.map(K.template))).filter(Boolean)
        : read_index(K.templates, K.template)
      : [],
    want('mobs') ? read_index(K.mobTemplates, K.mobTemplate) : [],
    want('worlds') ? read_index(K.worlds, K.world) : [],
    want('recipes') ? read_index(K.recipes, K.recipe) : [],
  ])

  // Bestiary loot join: each mob doc carries raw loot rows {template_id, chance_bp, min_qty,
  // max_qty} (or `drops: null` when the snapshot could not decode the nested tail — honest
  // "unknown", distinct from an empty `[]` = "no drops"). Resolve every referenced item
  // template's name/category in ONE batched read so the client gets display-ready rows
  // (name + chance% + qty band). A drop whose item is not (yet) snapshotted keeps name/
  // category null — the UI renders the gap, never fabricates it.
  const drop_ids = [...new Set(mobs.flatMap((m) => (m.drops ?? []).map((d) => d.template_id)))]
  const drop_docs = drop_ids.length ? await mget_json(drop_ids.map(K.template)) : []
  const item_by_id = new Map(drop_ids.map((id, i) => [id, drop_docs[i]]))

  // Live on-chain supply join (indexer HANDLERS.md "Item supply"): rpc:supply:{template} is a
  // SEPARATE event-derived counter doc (NUMINCRBY mint/burn), not part of the template's own
  // object-snapshot doc — batched here the same way the mob-drop join resolves referenced items.
  // Missing doc = a template with zero mints/burns ever seen ⇒ an honest 0 (NOT the object-snapshot
  // "hasn't arrived yet" null gap name/level/category use below — supply is fully event-driven, no
  // async convergence lag).
  const supply_docs = items.length ? await mget_json(items.map((t) => K.supply(t.template))) : []
  const supply_by_template = new Map(items.map((t, i) => [t.template, supply_docs[i]?.amount ?? 0]))
  // Last realised per-unit sale price (indexer HANDLERS.md "Last sale"): written by the snapshot
  // pipeline off shop::SaleBought / pool::PoolBuy|Sell / kiosk::ItemPurchased. Missing doc = the
  // template has NEVER sold ⇒ null (the client renders "marketcap unknown" for this case),
  // distinct from supply's honest 0.
  const lastsale_docs = items.length ? await mget_json(items.map((t) => K.lastsale(t.template))) : []
  const lastsale_by_template = new Map(items.map((t, i) => [t.template, lastsale_docs[i]?.price_mist ?? null]))
  // Authored [min,max] roll ranges (issue #219, indexer HANDLERS.md "Item stat ranges"): the
  // StatsMinKey/StatsMaxKey dynamic fields snapshot INDEPENDENTLY onto the SAME template doc as
  // `$.stats_min`/`$.stats_max` (each its own DF, no cross-DF read-modify-write on the indexer
  // side), so this view reshapes them into the served `{field: [min, max]}` object at read time.
  // A field present on only one half renders the other side null (never fabricated) — in
  // practice both land together (`item_stats::attach_ranges` writes both DFs in the SAME PTB).
  // `{}` for a template with no ranges at all (resources/consumables/cosmetics carry none) or
  // whose snapshot has not reached it yet — same "gap, never fabricate" stance as name/level.
  const combine_stat_ranges = (min, max) => {
    if (!min && !max) return {}
    const fields = new Set([...Object.keys(min ?? {}), ...Object.keys(max ?? {})])
    return Object.fromEntries([...fields].map((f) => [f, [min?.[f] ?? null, max?.[f] ?? null]]))
  }
  const join_drops = (rows) =>
    rows == null
      ? null // snapshot did not decode the loot table — honest unknown (not "no drops")
      : rows.map((d) => {
          const it = item_by_id.get(d.template_id)
          return {
            template_id: d.template_id,
            name: it?.name ?? null, // item object snapshot (null until snapshotted)
            category: it?.category ?? null,
            chance_percent: d.chance_bp / 100, // basis points → percent (10000 bp = 100%)
            min_qty: d.min_qty,
            max_qty: d.max_qty,
          }
        })

  return ok({
    items: items.map((t) => ({
      template_id: t.template,
      item_type: t.item_type ?? null,
      name: t.name ?? null, // object snapshot (null until snapshotted)
      description: t.description ?? null, // object snapshot — the create_template EN description (§14); locale overlay is client-side
      level: t.level ?? null, // object snapshot
      category: t.category ?? null, // object snapshot
      supply: supply_by_template.get(t.template) ?? 0, // event-derived mint/burn counter (never null — see join above)
      last_sale_mist: lastsale_by_template.get(t.template) ?? null, // last realised per-unit price (string MIST) — null until the first sale ever
      stats: combine_stat_ranges(t.stats_min, t.stats_max), // {field: [min,max]} authored roll ranges (issue #219, item_stats DF snapshot); {} for templates with none (resources/consumables/cosmetics) or not yet snapshotted
      // Authored weapon damage lines (issue #619 leg 3, item_damages DF snapshot): [{element, from,
      // to, damage_type}] — the EXACT shape `@aresrpg/sdk`'s decode_damages already produces, so
      // every frontend surface built against that shape is a drop-in match. `[]` for non-weapons
      // (no DamagesKey DF) or a template not yet snapshotted — same honest-gap stance as `stats`.
      damages: t.damages ?? [],
    })),
    mobs: mobs.map((m) => ({
      template_id: m.template,
      name: m.name ?? null,
      min_level: m.min_level ?? null,
      max_level: m.max_level ?? null,
      base_hp: m.base_hp ?? null,
      element: m.element ?? null, // raw spell discriminant (0=fire,1=water,2=earth,3=air,255=none)
      // Issue #629: the four resistances, RAW WIRE centered @32768 — the bestiary's
      // `decode_mob_resist` (chain/stat_bias.js) already handles both the decode and the `null`
      // gap (a template snapshot that hasn't landed yet), so this is a pure passthrough.
      earth_resistance: m.earth_resistance ?? null,
      fire_resistance: m.fire_resistance ?? null,
      water_resistance: m.water_resistance ?? null,
      air_resistance: m.air_resistance ?? null,
      drops: join_drops(m.drops ?? null), // display-ready loot rows (name + chance% + qty), or null
    })),
    worlds: worlds.map((w) => ({
      world_id: w.world,
      seed: w.seed,
      biome: w.biome,
      required_level: w.required_level ?? 1,
    })),
    // §14 crafting truth — the object-snapshotted `crafting::Recipe` docs (rpc:recipe:{id},
    // snapshot.rs map_recipe_object — mirror byte-for-byte): the EXACT on-chain ingredient
    // list + output + required job/level + per-craft xp. Ingredient/output NAMES are joined
    // client-side against the `items` list this same view serves (the encyclopedia already
    // holds it), so the rows carry raw template ids — never a fabricated display value.
    recipes: recipes.map((r) => ({
      recipe_id: r.recipe,
      output_template_id: r.output_template,
      output_quantity: r.output_quantity ?? 1,
      required_job: r.required_job ?? 0,
      required_level: r.required_level ?? 1,
      craft_xp: r.craft_xp ?? 0,
      inputs: (r.inputs ?? []).map((i) => ({ template_id: i.template_id, quantity: i.quantity })),
    })),
  })
}

// --- config ------------------------------------------------------------------
// The global game dials (XP/loot multipliers, max level, …), class base stats,
// and the character-creation config (price, available classes, per-class starter
// template) — the bootstrap read a client would otherwise assemble from scans.
//
// `protector_templates` (§17.22 gather-ambush resolver): `{ <seed key>: <MobTemplate id> }`,
// e.g. `{"protector_wheat": "0x…"}` — the id the SDK's gather_ptb passes as the defender.
// NOT chain-projected — it CANNOT be: the on-chain MobTemplate carries no role/slug (the
// seed's `protector_*` key is dropped at mint; the on-chain `name` is a display name like
// "Chaff Sentinel"), World exposes only `protector_bp`, and the protector→resource match is
// a declared gathering.move follow-up. So the source of truth for key→id is the CEREMONY
// SEED MANIFEST (the seed step records each minted template id), deployed to this API as the
// `PROTECTOR_TEMPLATES` env JSON — deploy config like the sponsor cap, never a fabricated
// chain projection (a name-pattern filter would invent a marker the chain does not carry).
// Absent/malformed env → `{}` (the client falls back / declares the gap).
function protector_templates() {
  try {
    const parsed = JSON.parse(process.env.PROTECTOR_TEMPLATES ?? '{}')
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

export async function handle_config() {
  const [config, creation] = await Promise.all([get_json(K.config), get_json(K.creation)])
  return ok({
    enabled: config?.enabled ?? null,
    dials: config?.dials ?? {},
    classes: config?.classes ?? {},
    protector_templates: protector_templates(),
    creation: {
      price_mist: creation?.price_mist ?? null,
      paused: creation?.paused ?? null,
      free: creation?.free ?? null, // sponsor pays creation gas when true
      sponsor: creation?.sponsor ?? null, // the sponsoring gas-station address (null = self-pay)
      classes: Object.keys(creation?.classes ?? {}),
      starters: creation?.starters ?? {},
    },
  })
}

// --- kolizeum ----------------------------------------------------------------
// Kolizeum lobby state. `?id=` fetches one; `?status=open|started|settled|…`
// filters the list (default: all). Lobby rosters / live join counts are object
// state; this serves the lifecycle status + stakes the browse UI needs.
export async function handle_kolizeum(params) {
  const id = params.get('id')
  if (id) {
    const kz = await get_json(K.kolizeum(id))
    return ok({ kolizeums: kz ? [kz] : [] })
  }
  const status = params.get('status')
  let kolizeums = await read_index(K.kolizeums, K.kolizeum)
  if (status) kolizeums = kolizeums.filter((k) => k.status === status)
  return ok({ kolizeums })
}

// --- dungeon runs -------------------------------------------------------------
// A player's ACTIVE dungeon runs — the resume set (§9). `?owner=<address>` lists a
// wallet's runs; `?pass=<id>` fetches one (spectator / direct resume). Each run
// carries its activation-time character, current 1-based room and the fight its room
// is latched to (null between rooms). The bound pass is consumed (DELETED on-chain) when a run ends
// — abandon / defeat / completion — so ended runs leave the read-model entirely,
// and because RunEnded carries the owning address the index is cleaned EXACTLY (no dangling
// ids, unlike the fight/result terminals): a returned run is therefore always live.
//
// Redis doc `rpc:run:{pass}` (projected by the dungeon run handlers):
//   { pass, world, player, character: "0x…"|null, status: "active", room: <u16>, fight: "0x…"|null }
function shape_run(r) {
  return {
    pass_id: r.pass,
    world: r.world ?? null,
    player: r.player ?? null,
    character: r.character ?? null,
    status: r.status ?? null,
    room: r.room ?? null,
    fight_id: r.fight ?? null,
  }
}

const dungeon_run_reads_default = { get_json, read_index }
export async function handle_dungeon_runs(params, dungeon_run_reads = dungeon_run_reads_default) {
  const pass = params.get('pass')
  if (pass) {
    const run_doc = await dungeon_run_reads.get_json(K.run(pass))
    return ok({ runs: run_doc ? [shape_run(run_doc)] : [] })
  }
  const owner = params.get('owner')
  if (!owner) return bad('provide ?owner=<address> or ?pass=<pass id>')
  const runs = (await dungeon_run_reads.read_index(K.runs(owner), K.run)).map(shape_run)
  return ok({ runs })
}

// --- fights -------------------------------------------------------------------
// The shared Fight object — the durable, event-faithful slice a client can't scan
// for: existence, lifecycle status, roster (who holds which seat), the current
// turn cursor, and the board anchor (world + anchor) from which the client
// re-derives the board geometry. The LIVE per-combatant board (cells, HP/AP/MP,
// mob identities, the turn queue) is object/DF state assembled at seat time and
// never carried by an event — it rides the presence layer + the client's own sim
// replay reconciled against the granular event stream (SPEC §14 THE LAW: the
// presence layer carries live motion, the chain referees). So this serves the
// resync PRIMITIVE, not a live board mirror.
//
//   ?id=<fight>       one fight's indexed state (spectator / client resync)
//   ?character=<id>   the fight the character is currently seated in (or empty)
//   ?world=<world id> the world's active fights (browse); ?active=false includes
//                     the brief Victory/Defeat pre-settle window
//
// Redis doc `rpc:fight:{id}` (projected by the indexer's fight handlers):
//   { fight, world, spawn_id (string — u64 id), anchor_x, anchor_z,
//     public_fight, aged_bp, mob_count,
//     status: "placement"|"active"|"victory"|"defeat",   // lifecycle events
//     participants: { "<character id>": <seat number>, … },  // FightJoined, idempotent map
//     current_turn: { is_mob, idx, deadline_ms } | null,     // TurnStarted
//     mob_positions: { "<mob idx>": <cell>, … } }            // MobMoved (latest cell per mob)
// PLUS `group_template` (id | null): NOT on the fight doc — JOINED at read time from
// `rpc:group_template:{world}:{spawn_id}` (indexer `zones::MobGroupClaimed`) so the client can name the
// mobs; null when un-projected (pre-arm fight / ticketless ambush/PvP). See `with_group_template`.
// Settled/Swept DELETE the doc (the on-chain object is destroyed then), so a
// dangling `rpc:char_fight:{character}` pointer (never cleared — terminal events
// omit the roster) resolves to a missing doc → "no active fight". The per-world
// index `rpc:idx:fights:{world}` likewise retains terminal ids (terminal events
// omit the world), so `?world=` drops missing docs and status-filters at read
// time — a monotonic cache wart, clean on a fresh re-index.
function shape_fight(f) {
  return {
    fight_id: f.fight,
    world: f.world ?? null,
    spawn_id: f.spawn_id ?? null,
    anchor: { x: f.anchor_x ?? null, z: f.anchor_z ?? null },
    public: f.public_fight ?? null,
    status: f.status ?? null,
    aged_bp: f.aged_bp ?? null,
    mob_count: f.mob_count ?? null,
    participants: Object.entries(f.participants ?? {})
      .map(([character, seat]) => ({ character, seat }))
      .sort((a, b) => a.seat - b.seat),
    current_turn: f.current_turn ?? null,
    // Each mob's LATEST cell (idx → cell), projected from `fight_events::MobMoved` — a
    // mob has no p2p presence broadcaster, so the client reads its repositions here.
    mob_positions: Object.entries(f.mob_positions ?? {})
      .map(([idx, cell]) => ({ idx: Number(idx), cell }))
      .sort((a, b) => a.idx - b.idx),
  }
}

// Join each served fight's mob-group template id at READ time — exactly the /v1/listings category idiom
// (map is pure; it cannot read Redis). `rpc:group_template:{world}:{spawn_id}` is projected by the
// indexer's `zones::MobGroupClaimed` arm (the id the GroupTicket handed `fight::create` → the fight's
// `group.template`), keyed by the (world, spawn_id) every fight doc also carries. The client resolves the
// id → the mob's display name through its own catalog home. A fight with no projected doc (indexed before
// this arm shipped, or a ticketless ambush/PvP fight that emits no MobGroupClaimed) carries
// `group_template: null` → the honest "Enemies #N" fallback stays. One batched MGET, so `?world=` browse
// stays a single extra round trip regardless of fight count.
async function with_group_template(fights) {
  if (fights.length === 0) return fights
  const docs = await mget_json(fights.map((f) => K.groupTemplate(f.world, f.spawn_id)))
  return fights.map((f, i) => ({ ...f, group_template: docs[i] ?? null }))
}

// Attach each shaped fight's `journal_head` — the ZCARD of its per-fight ordered event
// journal (`rpc:fight:{id}:journal`), i.e. how many events the log extends to. Additive:
// a fight with nothing journalled yet reports `0`. This is the cursor a client learns
// from the SNAPSHOT read so it knows the highest seq it can page the journal up to
// (`/v1/fights/{id}/events`). One ZCARD per fight, issued concurrently (Bun multiplexes).
async function with_journal_head(fights) {
  if (fights.length === 0) return fights
  const heads = await Promise.all(fights.map((f) => zcard(K.fightJournal(f.fight_id))))
  return fights.map((f, i) => ({ ...f, journal_head: heads[i] }))
}

// Both read-time joins a fight snapshot carries: the mob-group template name + the journal head.
const enrich_fights = async (fights) => with_journal_head(await with_group_template(fights))

export async function handle_fights(params) {
  const id = params.get('id')
  const character = params.get('character')
  const world = params.get('world')

  if (id) {
    const f = await get_json(K.fight(id))
    return ok({ fights: await enrich_fights(f ? [shape_fight(f)] : []) })
  }
  if (character) {
    const fid = await get_json(K.charFight(character))
    const f = fid ? await get_json(K.fight(fid)) : null // dangling pointer → missing doc → empty
    return ok({ fights: await enrich_fights(f ? [shape_fight(f)] : []) })
  }
  if (world) {
    const active = params.get('active') !== 'false' // default: only non-terminal
    let fights = (await read_index(K.fights(world), K.fight)).map(shape_fight)
    if (active) fights = fights.filter((f) => f.status === 'placement' || f.status === 'active')
    return ok({ fights: await enrich_fights(fights) })
  }
  return bad('provide ?id=<fight>, ?character=<id>, or ?world=<world id>')
}

// --- fight event journal (the V2 observer-replay transport, #216) -------------
// GET /v1/fights/{id}/events?from={seq}&limit={n} — a CONTIGUOUS, ORDERED page of a
// fight's event journal. `seq` is the per-fight ordinal (0-based RANK in the sorted set
// the indexer appends every board/turn event to, in (checkpoint, tx, event) order); the
// page is `[from, from+limit)`. Each entry is `{ seq, kind, data, digest, version }` —
// `data` is the event's fullnode-`parsedJson`-shaped fields (so a client folds it through
// the SAME decoder its own receipts use), `digest` the tx digest, `version` the fight
// object's post-tx Sui version (string | null for a terminal that destroyed the object).
// `journal_head` (= ZCARD) tells the client how far the log currently extends.
//
// IMMUTABILITY: a page whose whole window is already in the past (`from + limit <= head`)
// can NEVER change — those seqs are permanent — so it is served `immutable`/cache-forever;
// any page that reaches the live head is `no-store` (more events may still append at/after
// it, so a cached copy would strand the client on a stale, incomplete tail).
const JOURNAL_DEFAULT_LIMIT = 200
const JOURNAL_MAX_LIMIT = 512
const IS_OBJECT_ID = /^0x[0-9a-fA-F]{64}$/
const journal_bad = (message) => ({ status: 400, cache: 'no-store', data: { error: 'bad_request', message } })

export async function handle_fight_events(fight_id, params) {
  if (!IS_OBJECT_ID.test(fight_id ?? '')) return journal_bad('fight id must be a 0x-prefixed 32-byte hex object id')
  const from = Math.max(0, Math.floor(Number(params.get('from')) || 0))
  const limit = Math.min(
    Math.max(Math.floor(Number(params.get('limit')) || JOURNAL_DEFAULT_LIMIT), 1),
    JOURNAL_MAX_LIMIT
  )

  const key = K.fightJournal(fight_id)
  const head = await zcard(key)
  const members = from < head ? await zrange(key, from, from + limit - 1) : []
  const events = members.map((m, i) => {
    // member = `{tx:06}:{event:04}|{payload_json}` — the ordinal prefix is the ZSET's
    // sort key; the payload after the first '|' is the stored `{kind, data, digest, version}`.
    const payload = JSON.parse(m.slice(m.indexOf('|') + 1))
    return { seq: from + i, kind: payload.kind, data: payload.data, digest: payload.digest, version: payload.version }
  })

  const immutable = from + limit <= head // the whole window is in the past → permanent
  const cache = immutable ? 'public, max-age=31536000, immutable' : 'no-store'
  // THE CHAIN CLOCK (#2099) — the client compares `Date.now()` to CHAIN timestamps (the turn deadline), and had
  // no skew model at all: a skewed clock silently lost its delta from every turn. This is the only chain-clock
  // reading a fight read can carry — the same `rpc:checkpoint:latest` timestamp `handle_status` reports lag off.
  // Paired with the client's arrival instant it yields `chain_now ≈ Date.now() + offset`. Attached ONLY to the
  // LIVE (`no-store`) page: an `immutable` page is cached forever, and a cached timestamp is a lie by tomorrow.
  // Indexer lag + network latency only ever make this reading OLDER than true chain time, so the client's
  // rolling-max estimator converges from below and can never hand a turn over early (#1808 stays honest).
  const latest = immutable ? null : await get_json(LATEST_CHECKPOINT_KEY)
  const chain_now_ms = Number(latest?.timestamp_ms)
  return {
    status: 200,
    cache,
    data: {
      fight: fight_id,
      events,
      journal_head: head,
      ...(chain_now_ms > 0 ? { chain_now_ms } : {}),
    },
  }
}

// --- protector trigger (§17.22 resource-protector ambush signal) --------------
// A gatherer's LATEST resource-protector ambush trigger — the signal that a gather roll
// spawned an ambush Fight (or SKIPPED it). The ambush Fight itself is discoverable via
// /v1/fights?character= (the gatherer is auto-seated in it); this is the address-keyed
// "your gather triggered an ambush" signal + its where/what context so the client can
// react. `?address=` (the gatherer) required. `spawn_id` is a u64 handle as a string
// ("0" = SKIPPED — the gatherer was already fighting, so no ambush spawned). Latest-wins.
//
// Redis doc `rpc:protector_trigger:{gatherer}` (projected by the gathering handler):
//   { gatherer, world, template, x, z, spawn_id (string), at_ms }
export async function handle_protector_trigger(params) {
  const address = params.get('address')
  if (!address) return bad('provide ?address=<gatherer address>')
  const doc = await get_json(K.protectorTrigger(address))
  return ok({
    trigger: doc
      ? {
          gatherer: doc.gatherer ?? address,
          world: doc.world ?? null,
          template: doc.template ?? null,
          x: doc.x ?? null,
          z: doc.z ?? null,
          spawn_id: doc.spawn_id ?? null,
          at_ms: doc.at_ms ?? null,
        }
      : null,
  })
}

// --- fight results ------------------------------------------------------------
// A wallet's pending FightResults — the soulbound (key-only) settled outcomes a
// player opens to roll loot + write back XP/HP. A wallet cannot cheaply scan its
// owned soulbound objects for these fields, so the indexer keys them by owner.
// `?owner=<address>` is required.
//
// Redis doc `rpc:result:{id}` (projected by the indexer's result handlers) comes
// in TWO disjoint id families (`results::open` consumes the engine FightOutcome
// and mints a NEW core FightResult — no shared id):
//   ResultMinted  → the unopened engine outcome: { result, fight, character,
//     owner, outcome: "victory"|"defeat", xp_share, final_hp,
//     opened: false, loot_units: 0 }
//   ResultOpened  → the core claim ticket (NEW id, owner = tx sender):
//     { result, character, owner, xp_share, opened: true, loot_units,
//       fight/outcome/final_hp: null }
// ResultBurned DELETES the ticket doc; the per-owner index `rpc:idx:results:{owner}`
// retains the burned id (ResultBurned omits owner), so the view drops missing
// docs at read time — the same monotonic-index tradeoff as `?world=` above. The
// outcome doc stays `opened:false` after open (no event links the two ids) — the
// consumed on-chain object is the client's discriminator.
export async function handle_fight_results(params) {
  const owner = params.get('owner')
  if (!owner) return bad('provide ?owner=<address>')

  const results = (await read_index(K.results(owner), K.result)).map((r) => ({
    result_id: r.result,
    fight_id: r.fight ?? null,
    character: r.character ?? null,
    outcome: r.outcome ?? null,
    xp_share: r.xp_share ?? 0,
    final_hp: r.final_hp ?? 0,
    opened: r.opened ?? false,
    loot_units: r.loot_units ?? 0,
  }))
  return ok({ results })
}

// --- commissions (artisan pay-X escrow lifecycle, aresrpg::commission) -------
// Open commissions for a wallet, resolving BOTH roles a wallet can hold: the
// commissions offered TO them as an artisan (to fulfil) and the ones they opened
// themselves as a customer (their own asks). Shaped for a future artisan-modal UI:
// `{ as_artisan: [...], as_customer: [...] }`. `?address=` is required.
//
// Redis doc `rpc:commission:{id}` (projected by the indexer's commission handlers):
//   { commission, customer, artisan, amount_mist, opened_at_ms }
// Claim/cancel DELETE the doc (the on-chain Commission is consumed either way).
// `CommissionCancelled` carries no `artisan` field (commission.move — a refund is
// ownership-gated on the customer alone), so the indexer cannot un-index a cancelled
// commission from the artisan set exactly — `read_index`'s drop-missing (same as the
// fight/result owner indexes above) absorbs that gap since the doc is always gone.
const shape_commission = (c, counterparty) => ({
  commission_id: c.commission,
  counterparty,
  amount_mist: c.amount_mist,
  opened_at_ms: c.opened_at_ms ?? null,
})

export async function handle_commissions(params) {
  const address = params.get('address')
  if (!address) return bad('provide ?address=<address>')

  const [as_artisan, as_customer] = await Promise.all([
    read_index(K.commissionsByArtisan(address), K.commission),
    read_index(K.commissionsByCustomer(address), K.commission),
  ])

  return ok({
    as_artisan: as_artisan.map((c) => shape_commission(c, c.customer)),
    as_customer: as_customer.map((c) => shape_commission(c, c.artisan)),
  })
}

// --- pending fight outcomes (unopened, per owner) ----------------------------
// A wallet's PENDING (unopened) soulbound FightOutcomes — the engine outcomes minted
// at settle and awaiting the `results::open` claim (which consumes them). A
// wallet cannot cheaply scan its owned soulbound objects for these fields, so the
// indexer keys them by owner (object create → add, object delete → remove; §14). This
// is distinct from `/v1/fight-results` (that view also serves the OPENED core tickets);
// this one is exactly the still-openable set.
//
// Redis: per-owner sorted set `rpc:idx:pending_outcomes:{owner}` (score = checkpoint ts,
// member = outcome id, capped to the newest 100) + per-outcome doc `rpc:pending_outcome:
// {id}`. `results::open` deletes the on-chain object → the indexer ZREMs the member and
// DELs the doc (exact, since the owning address rides the deleted object), so a returned outcome is
// always still-openable; a capped-out id resolves to a missing doc and is dropped here.
//
// CONTRACT (frozen — a frontend lane builds against it verbatim): `?owner=<address>` →
// a bare JSON ARRAY of `[{ outcome_id, character_id, fight_id, world_id, pvp, outcome,
// aged_bp }]`, newest first.
export async function handle_pending_outcomes(params) {
  const owner = params.get('owner')
  if (!owner) return bad('provide ?owner=<address>')

  const ids = await zrevrange(K.pendingOutcomes(owner)) // newest-first, ≤100
  const docs = (await mget_json(ids.map(K.pendingOutcome))).filter(Boolean) // drop capped-out/consumed
  return ok(
    docs.map((o) => ({
      outcome_id: o.outcome_id,
      character_id: o.character_id ?? null,
      fight_id: o.fight_id ?? null,
      world_id: o.world_id ?? null,
      pvp: o.pvp ?? false,
      outcome: o.outcome ?? null,
      aged_bp: o.aged_bp ?? null,
    }))
  )
}

// --- pet-box claims (unclaimed rolled pets, per owner) -----------------------
// A wallet's UNCLAIMED `loot_box::PetBoxClaim`s — `open_box` mints a soulbound claim
// recording the roll; `claim_pet` consumes (deletes) it. Soulbound + no kiosk join
// possible (§11), so the indexer object-snapshots create/delete keyed directly by owner
// (indexer/src/handlers/ares/snapshot.rs `map_pet_box_claim_object`/`remove_pet_box_claim`)
// — the last sanctioned chain-direct read this view retires (V1_SWEEP_PLAN.md §3 item 9).
//
// Redis: ONE doc per owner `rpc:petclaims:{owner}` = `{ owner, claims: { "<claim_id>":
// "<rolled_template>" } }` — a map keyed by the claim's own id (not a stored array: JSON.SET
// / JSON.DEL on a keyed sub-path gives idempotent create/delete with no read-modify-write).
//
// CONTRACT: `?owner=<address>` → a bare JSON ARRAY (mirrors `/v1/pending-outcomes`) of
// `[{ claim_id, rolled_template }]`. `[]` for a wallet with nothing pending.
export async function handle_pet_claims(params) {
  const owner = params.get('owner')
  if (!owner) return bad('provide ?owner=<address>')

  const doc = await get_json(K.petClaims(owner))
  const claims = Object.entries(doc?.claims ?? {}).map(([claim_id, rolled_template]) => ({
    claim_id,
    rolled_template,
  }))
  return ok(claims)
}

// --- taux (forgemagie crushing-coefficient inflation) ------------------------
// Per-item-template taux "de brisage" coefficients (milli-percent: 100% = 100000)
// off the shared CrushBoard, projected event-driven from `forgemagie::{BoardCreated,
// Crushed,RecipelessSet}` (the CrushBoard's rows are Table dynamic fields; the Move events
// are designed so coefficients are derivable from events alone).
//
//   /v1/taux                → every TOUCHED template (crushed / recipe-less) + meta
//   /v1/taux?template=<id>  → one template's effective coefficient (neutral default)
//   /v1/taux?ids=<a,b,c>    → bulk (each defaults to neutral when never crushed)
//
// The effective coefficient folds bracket DRIFT at read time: crushing OTHER
// templates in a level bracket inflates its peers, so `effective = stored_coeff +
// (bracket_pressure_now − template_snapshot) × 3/5`, clamped to [1%,4000%], with the
// recipe-less 50% cap. (The sub-5-milli carry the on-chain settle keeps is omitted —
// a <0.005% approximation.) Constants mirror aresrpg_foundation::taux.
const TAUX = {
  FLOOR_MILLI: 1_000, // 1% floor (Retro canon)
  CAP_MILLI: 4_000_000, // 4000% cap
  RECIPELESS_CAP_MILLI: 50_000, // drop/quest-only templates price at min(coeff, 50%)
  PRESSURE_RATE_NUM: 3,
  PRESSURE_RATE_DEN: 5,
  DEFAULT_NEUTRAL_MILLI: 100_000, // fallback if BoardCreated is not yet indexed
}

const clamp_coeff = (c) => (c < TAUX.FLOOR_MILLI ? TAUX.FLOOR_MILLI : c > TAUX.CAP_MILLI ? TAUX.CAP_MILLI : c)

export async function handle_taux(params) {
  const meta = await get_json(K.tauxMeta)
  const neutral_milli = meta?.neutral_milli ?? TAUX.DEFAULT_NEUTRAL_MILLI
  const bracket_size = meta?.bracket_size ?? null

  const ids_param = params.get('ids') ?? params.get('template')
  const ids = ids_param
    ? ids_param
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : await smembers(K.tauxIdx) // no params → every touched template

  const rows = await mget_json(ids.map(K.taux))
  // Bracket pressure is shared by every template in a level bracket — batch the
  // distinct brackets into ONE JSON.MGET instead of a per-row round trip (N+1).
  const brackets = [...new Set(rows.filter((row) => row?.bracket != null).map((row) => row.bracket))]
  const pressures = await mget_json(brackets.map((b) => K.tauxBracket(b)))
  const pressure_by_bracket = new Map(brackets.map((b, i) => [b, pressures[i]]))
  const taux = ids.map((template_id, i) => {
    const row = rows[i]
    if (!row) {
      // never crushed / not recipe-less → prices at the neutral default
      return {
        template_id,
        coeff_milli: neutral_milli,
        coeff_percent: neutral_milli / 1000,
        recipe_less: false,
        source: 'neutral',
      }
    }
    const snapshot = row.snapshot ?? 0
    const pressure_now = row.bracket != null ? (pressure_by_bracket.get(row.bracket) ?? snapshot) : snapshot
    const drift =
      pressure_now > snapshot
        ? Math.floor(((pressure_now - snapshot) * TAUX.PRESSURE_RATE_NUM) / TAUX.PRESSURE_RATE_DEN)
        : 0
    let coeff = clamp_coeff((row.coeff_milli ?? neutral_milli) + drift)
    if (row.recipe_less && coeff > TAUX.RECIPELESS_CAP_MILLI) coeff = TAUX.RECIPELESS_CAP_MILLI
    return {
      template_id,
      coeff_milli: coeff,
      coeff_percent: coeff / 1000,
      recipe_less: row.recipe_less ?? false,
      source: 'crushed',
    }
  })

  return ok({
    taux,
    neutral_milli,
    bracket_size,
    floor_milli: TAUX.FLOOR_MILLI,
    cap_milli: TAUX.CAP_MILLI,
  })
}

// --- names (character name → owner + SuiNS address → name) ------------------
// `?name=` is an exact, case-insensitive CHARACTER-name lookup over the indexer's
// `rpc:idx:char_name:<lowercase>` set. The set member is the character id, which points at the
// `rpc:character:<id>` document carrying the indexed name and owner.
//
// The response is ALWAYS 200 `{ matches: [...] }` — the envelope the sole consumer
// (frontend friends_reads.js:get_owner_by_name → friend_target.js) is built against. A hit yields one
// row `{ name, character_id, owner, level, class }`; a miss (empty index / stale edge / owner-less doc)
// yields `{ matches: [] }`, NOT a 404: rpc_get throws on any non-2xx, so a 404 would surface as the
// generic "couldn't look up that player name" toast instead of the honest "no player by that name". Names
// are globally unique on-chain, but the array is kept so duplicate/corrupt projection rows fail closed
// (the client renders them as "ambiguous" and never auto-picks a wallet) rather than selecting arbitrarily.
//
// The existing `?addresses=` / singular `?address=` branch remains address → default SuiNS @handle for raw
// address display surfaces. Resolution + Redis TTL caching lives in suins.js; misses are null so callers fall
// back to shortened-address rendering.
const name_reads_default = { smembers, mget_json }
export async function handle_names(params, name_reads = name_reads_default) {
  const name_param = params.get('name')
  if (name_param != null) {
    // Mirrors creation.move exactly: 4–19 printable ASCII bytes, no whitespace/control, normalized lowercase.
    // Besides matching chain truth, the fixed grammar/length bounds the Redis key and rejects Unicode/controls
    // before a store command is assembled (Redis arguments are passed separately, never interpolated commands).
    if (!/^[\x21-\x7e]{4,19}$/.test(name_param)) return bad('malformed character name')
    const normalized = name_param.toLowerCase()
    const character_ids = (await name_reads.smembers(K.charName(normalized))).sort()
    const characters = await name_reads.mget_json(character_ids.map(K.character))
    const match = characters
      .map((character, i) => ({ character, character_id: character_ids[i] }))
      .find(
        ({ character, character_id }) =>
          character?.id === character_id &&
          typeof character.name === 'string' &&
          character.name.toLowerCase() === normalized &&
          typeof character.owner === 'string' &&
          character.owner.length > 0
      )

    if (!match) return ok({ matches: [] })
    return ok({
      matches: [
        {
          name: match.character.name,
          character_id: match.character_id,
          owner: match.character.owner,
          level: match.character.level ?? null,
          class: match.character.class ?? null,
        },
      ],
    })
  }

  const addresses_param = params.get('addresses') ?? params.get('address')
  if (!addresses_param) return bad('provide ?name=<character name> or ?addresses=<comma-separated addresses>')

  const addresses = addresses_param
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

  const names = await resolve_names(addresses)
  return ok(names)
}

// --- sponsor daily allowance remaining (the free-gameplay allowance UX) -----
// Makes READABLE the per-zkLogin daily sponsor allowance that api/sponsor.mjs enforces, so the
// client can render "X / 1 SUI free today" and warn before a fight it can't cover. This view is
// the READ side of a counter the SPONSOR owns: on each sponsored grant the sponsor does
// `INCRBY sponsor:spent:{UTC-date}:{addr}` (EXPIREAT next UTC midnight) against the SAME Redis this
// api reads — no indexer involvement, it's a shared money-counter, not chain-projected state.
//   allowance_mist — the env cap the sponsor also reads (SPONSOR_ADDR_DAILY_CAP_MIST, default 1 SUI)
//   spent_mist     — the shared counter (0 when unset / a fresh day / Redis briefly down)
//   remaining_mist — max(0, allowance − spent)
//   resets_at      — next UTC midnight ISO (when the key expires and the allowance refreshes)
// Display-only: this NEVER gates a tx (the sponsor fail-closes the real cap itself); a Redis blip
// here just shows full allowance for a beat. MIST as strings (§14). `?address=` required.
const SPONSOR_ADDR_DAILY_CAP_MIST = BigInt(process.env.SPONSOR_ADDR_DAILY_CAP_MIST || 1_000_000_000)
function next_utc_midnight_iso() {
  const n = new Date()
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate() + 1)).toISOString()
}
export async function handle_sponsor_remaining(params) {
  const address = params.get('address')
  if (!address) return bad('provide ?address=<address>')
  if (!/^0x[0-9a-fA-F]{1,64}$/.test(address)) return bad('malformed address')

  const day = new Date().toISOString().slice(0, 10)
  let spent = 0n
  try {
    const raw = await get_str(`sponsor:spent:${day}:${address.toLowerCase()}`)
    if (raw != null) spent = BigInt(raw)
  } catch {
    /* Redis down → 0 spent (display-only; the sponsor still fail-closes the actual cap). */
  }

  const cap = SPONSOR_ADDR_DAILY_CAP_MIST
  const remaining = spent >= cap ? 0n : cap - spent
  return ok({
    allowance_mist: cap.toString(),
    spent_mist: spent.toString(),
    remaining_mist: remaining.toString(),
    resets_at: next_utc_midnight_iso(),
  })
}
