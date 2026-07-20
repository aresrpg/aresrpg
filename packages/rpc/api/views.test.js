// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// View tests over a seeded Redis 8 (JSON + query modules), exercising the REAL
// read path: each view issues the same JSON.MGET / SMEMBERS / JSON.GET the API
// serves in production. Point REDIS_URL at a throwaway redis:8 and run:
//
//   docker run -d --rm -p 6399:6379 redis:8
//   REDIS_URL=redis://127.0.0.1:6399 bun test
//
// The suite FLUSHes and reseeds, so it needs a dedicated instance (never a live
// cache). Flushing goes EXCLUSIVELY through `flush_test_redis()` — the gate that
// re-validates REDIS_URL on every call (a raw FLUSHALL here is a defect; the
// import-time throw alone failed to stop incident #2, see assert_test_redis.js).
// It mirrors the exact key shapes the Rust indexer projects.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'

import { flush_test_redis } from './assert_test_redis.js'
import { redis } from './redis.js'
import {
  handle_characters,
  handle_commissions,
  handle_config,
  handle_dungeon_runs,
  handle_encyclopedia,
  handle_fight_results,
  handle_fights,
  handle_kolizeum,
  handle_listings,
  handle_names,
  handle_owner_items,
  handle_pending_outcomes,
  handle_pet_claims,
  handle_pools,
  handle_protector_trigger,
  handle_rare_links,
  handle_sales_history,
  handle_shop,
  handle_taux,
  handle_zones,
} from './views.js'

const P = (q) => new URLSearchParams(q)
const setj = (key, obj) => redis.send('JSON.SET', [key, '$', JSON.stringify(obj)])
const sadd = (key, ...members) => redis.send('SADD', [key, ...members])
// Append a sale row exactly as the indexer's ItemPurchased arm ZADDs it (score = ts).
const zadd_sale = (kiosk, ts, member) =>
  redis.send('ZADD', [`rpc:sales_log:${kiosk}`, String(ts), JSON.stringify(member)])
const canonical_id = (suffix) => `0x${suffix.padStart(64, '0')}`

// Padded-hex ids mirroring the indexer's to_canonical_string(true).
const CH = '0x00000000000000000000000000000000000000000000000000000000000000c1'
const CH2 = '0x00000000000000000000000000000000000000000000000000000000000000c2'
const LONER = '0x00000000000000000000000000000000000000000000000000000000000000c3'
const OWNER = '0x00000000000000000000000000000000000000000000000000000000000005e1'
const ITEM_A = '0x000000000000000000000000000000000000000000000000000000000000a001'
const ITEM_B = '0x000000000000000000000000000000000000000000000000000000000000a002'
const ITEM_HAT = '0x000000000000000000000000000000000000000000000000000000000000a003' // an equipped cosmetic hat
const TPL_HAT = '0x0000000000000000000000000000000000000000000000000000000000007a04' // its template (category 'hat')
const PET_ITEM = canonical_id('a004')
const PET_TEMPLATE = canonical_id('7a05')
const WORLD = '0x0000000000000000000000000000000000000000000000000000000000000e01'
const FIGHT_A = '0x0000000000000000000000000000000000000000000000000000000000000f1a'
const GONE_FIGHT = '0x000000000000000000000000000000000000000000000000000000000000dead'
const MOB_TPL = '0x0000000000000000000000000000000000000000000000000000000000007c01' // FIGHT_A's mob-group MobTemplate (group_template join)
const RES_OPEN = '0x00000000000000000000000000000000000000000000000000000000000ab001'
const RES_NEW = '0x00000000000000000000000000000000000000000000000000000000000ab002'
const RES_BURNED = '0x00000000000000000000000000000000000000000000000000000000000ab003'
const CHL = '0x00000000000000000000000000000000000000000000000000000000000000c4' // a character listed for sale
const CH_PET_GAP = canonical_id('c5')
const CH_PET_LEGACY = canonical_id('c6')
const RUN_PASS = '0x000000000000000000000000000000000000000000000000000000000000da01'
const RUN_GONE = '0x000000000000000000000000000000000000000000000000000000000000da02' // indexed but no doc (drop-missing)
const RUN_FIGHT = '0x000000000000000000000000000000000000000000000000000000000000da0f'
const TPL_CRUSHED = '0x0000000000000000000000000000000000000000000000000000000000007a01' // a crushed gear template (taux row)
const TPL_RECIPELESS = '0x0000000000000000000000000000000000000000000000000000000000007a02' // a drop-only template (50% cap)
const TPL_UNTOUCHED = '0x0000000000000000000000000000000000000000000000000000000000007a03' // never crushed → neutral
const SELLER_A = '0x0000000000000000000000000000000000000000000000000000000000005a01' // a marketplace seller
const KIOSK_A = '0x0000000000000000000000000000000000000000000000000000000000005a0f' // their personal kiosk
const BUYER_1 = '0x0000000000000000000000000000000000000000000000000000000000005b01'
const BUYER_2 = '0x0000000000000000000000000000000000000000000000000000000000005b02'
const SOLD_GONE = '0x000000000000000000000000000000000000000000000000000000000000a0ff' // sold, item doc since gone
const WORLD_B = '0x0000000000000000000000000000000000000000000000000000000000000e02'
const TPL_ORE = '0x0000000000000000000000000000000000000000000000000000000000007b01' // gatherable resource
const TPL_GOLDEN_ORE = '0x0000000000000000000000000000000000000000000000000000000000007b02' // its rare variant
const PEND_OWNER = '0x00000000000000000000000000000000000000000000000000000000000005e2' // wallet with pending outcomes
const GATHERER = '0x00000000000000000000000000000000000000000000000000000000000005e4' // wallet with a protector-ambush trigger
// commissions: ARTISAN_A holds BOTH roles — artisan on COMM_1/COMM_2 (offered to them by
// CUSTOMER_A/CUSTOMER_B) and customer on COMM_3 (their own ask toward OTHER_ARTISAN). COMM_GONE
// is indexed under ARTISAN_A's artisan-set with NO doc — the CommissionCancelled monotonic gap
// (cancel carries no artisan field) the view's drop-missing must absorb.
const ARTISAN_A = '0x000000000000000000000000000000000000000000000000000000000000c701'
const CUSTOMER_A = '0x000000000000000000000000000000000000000000000000000000000000c702'
const CUSTOMER_B = '0x000000000000000000000000000000000000000000000000000000000000c703'
const OTHER_ARTISAN = '0x000000000000000000000000000000000000000000000000000000000000c704'
const COMM_1 = '0x000000000000000000000000000000000000000000000000000000000000cc01'
const COMM_2 = '0x000000000000000000000000000000000000000000000000000000000000cc02'
const COMM_3 = '0x000000000000000000000000000000000000000000000000000000000000cc03'
const COMM_GONE = '0x000000000000000000000000000000000000000000000000000000000000cc04'
const OUT_A = '0x000000000000000000000000000000000000000000000000000000000000ab0a' // newest pending outcome
const OUT_B = '0x000000000000000000000000000000000000000000000000000000000000ab0b' // older pending outcome
const OUT_GONE = '0x000000000000000000000000000000000000000000000000000000000000ab0c' // indexed but doc consumed (drop-missing)
// pet-box claims: CLAIM_OWNER has two unclaimed rolled pets; LONER (reused from pending outcomes) has none.
const CLAIM_OWNER = '0x00000000000000000000000000000000000000000000000000000000000005e5'
const CLAIM_A = '0x000000000000000000000000000000000000000000000000000000000000cb0a'
const CLAIM_B = '0x000000000000000000000000000000000000000000000000000000000000cb0b'
const ROLLED_A = '0x0000000000000000000000000000000000000000000000000000000000007c01'
const ROLLED_B = '0x0000000000000000000000000000000000000000000000000000000000007c02'
// owner-items: a MULTI-KIOSK wallet (BAG_OWNER) with two personal kiosks it owns + a foreign one it doesn't.
const BAG_OWNER = '0x00000000000000000000000000000000000000000000000000000000000005e3'
const BK_A = '0x000000000000000000000000000000000000000000000000000000000000ba0a' // kiosk A (cap CAP_A)
const BK_B = '0x000000000000000000000000000000000000000000000000000000000000ba0b' // kiosk B (cap CAP_B)
const CAP_A = '0x000000000000000000000000000000000000000000000000000000000000ca0a'
const CAP_B = '0x000000000000000000000000000000000000000000000000000000000000ca0b'
const FOREIGN_K = '0x000000000000000000000000000000000000000000000000000000000000ba0f' // a kiosk BAG_OWNER does NOT own
const BAG_SWORD = '0x000000000000000000000000000000000000000000000000000000000000b101' // in BK_A (sword, amount 1)
const BAG_POTION = '0x000000000000000000000000000000000000000000000000000000000000b102' // in BK_A (consumable, amount 5)
const BAG_KEY = '0x000000000000000000000000000000000000000000000000000000000000b103' // in BK_B (key, scribed level 12)
const BAG_MOVED = '0x000000000000000000000000000000000000000000000000000000000000b104' // in BK_A's set, doc now → FOREIGN_K
const BAG_BURNED = '0x000000000000000000000000000000000000000000000000000000000000b105' // in BK_B's set, doc gone

// Add a pending-outcome index member exactly as the indexer's ZADD does (score = checkpoint ts).
const zadd_pending = (owner, ts, id) => redis.send('ZADD', [`rpc:idx:pending_outcomes:${owner}`, String(ts), id])

beforeAll(async () => {
  await flush_test_redis()

  // characters — colors/male/level/experience come from the object-snapshot pipeline;
  // `stats` is the §3 allocated block (indexed 0-5, from stat_allocation::StatRaised):
  // 10 vitality (idx 0) + 5 strength (idx 2) = 15 spent. Level 12 → earned (12-1)*5 = 55,
  // so available_points = 55 - 15 = 40.
  await setj(`rpc:character:${CH}`, {
    id: CH,
    owner: OWNER,
    name: 'Aiden',
    class: 'sram',
    male: true,
    colors: { color_1: 16777215, color_2: 13935180, color_3: 9136404 },
    level: 12,
    experience: 32600,
    stats: { 0: 10, 2: 5 },
    // per-job xp block (numeric index → absolute total, object-snapshotted from the JobXpKey DFs):
    // miner (idx 2) @ 1911 xp = job level 10, farmer (idx 0) @ 50 xp = job level 2.
    jobs: { 0: 50, 2: 1911 },
    // live-progression DF snapshot (RAW current hp + the lazy-regen stamp) + the NET GEAR vitality
    // cache (equipment DF fold) — distinct from the allocated `vitality` (stats idx 0 = 10) above.
    current_hp: 137,
    hp_updated_ms: 1700000000123,
    gear_vitality: 20,
    pet_equipped: true,
    pet: { item_id: PET_ITEM, template_id: PET_TEMPLATE, slug: 'pet_bouloute', ignored: 'closed nested view' },
    kiosk_id: KIOSK_A, // object snapshot — the kiosk holding this (kiosk-locked) character
    world: WORLD,
    position: { x: 10, z: 20, zone: 'spawn' },
    // ITEM_A's template ('0xtpl') has no template doc → category null (the graceful-null join path);
    // ITEM_HAT's template (TPL_HAT) is snapshotted below with category 'hat' → resolves to a worn slot.
    equipment: { [ITEM_A]: { template: '0xtpl', amount: 1 }, [ITEM_HAT]: { template: TPL_HAT, amount: 1 } },
  })
  await sadd(`rpc:idx:char_owner:${OWNER}`, CH)
  await sadd('rpc:idx:char_name:aiden', CH)
  // Marketplace fixtures also project the character's current kiosk; name lookup deliberately returns the
  // owner recorded on the indexed character document, independent of that kiosk edge.
  await setj(`rpc:kiosk:${KIOSK_A}`, { kiosk_id: KIOSK_A, owner: SELLER_A })

  // items (listing enrichment: category + level)
  await setj(`rpc:item:${ITEM_A}`, {
    id: ITEM_A,
    template: '0xtplsword',
    item_type: 'weapon',
    category: 'sword',
    amount: 1,
    level: 40,
  })
  // template doc for the equipped hat — the read-time category join for equipment/worn (like /v1/listings).
  await setj(`rpc:template:${TPL_HAT}`, {
    template: TPL_HAT,
    item_type: 'sui_helmet',
    name: 'Sui Helmet',
    category: 'hat',
    level: 1,
  })
  await setj(`rpc:item:${ITEM_B}`, {
    id: ITEM_B,
    template: '0xtplhelm',
    item_type: 'armor',
    category: 'resource',
    amount: 10,
    level: 80,
  })

  // owner-items: BAG_OWNER owns BK_A + BK_B (each with a cap doc). BK_A holds a sword + a potion
  // + a since-MOVED item (its doc's kiosk_id now points at FOREIGN_K → dropped at read time); BK_B
  // holds a key + a since-BURNED item (no doc → dropped). Item docs carry the snapshot's display
  // fields + their CURRENT kiosk_id (the reconciliation key).
  await sadd(`rpc:idx:owner_kiosks:${BAG_OWNER}`, BK_A, BK_B)
  await setj(`rpc:kiosk:${BK_A}`, { kiosk_id: BK_A, cap_id: CAP_A, owner: BAG_OWNER })
  await setj(`rpc:kiosk:${BK_B}`, { kiosk_id: BK_B, cap_id: CAP_B, owner: BAG_OWNER })
  await sadd(`rpc:idx:kiosk_items:${BK_A}`, BAG_SWORD, BAG_POTION, BAG_MOVED)
  await sadd(`rpc:idx:kiosk_items:${BK_B}`, BAG_KEY, BAG_BURNED)
  await setj(`rpc:item:${BAG_SWORD}`, {
    id: BAG_SWORD,
    name: 'Iron Sword',
    item_type: 'sword_iron',
    category: 'sword',
    amount: 1,
    level: null,
    kiosk_id: BK_A,
  })
  await setj(`rpc:item:${BAG_POTION}`, {
    id: BAG_POTION,
    name: 'Life Potion',
    item_type: 'potion_life',
    category: 'consumable',
    amount: 5,
    level: null,
    kiosk_id: BK_A,
  })
  await setj(`rpc:item:${BAG_KEY}`, {
    id: BAG_KEY,
    name: 'Crypt Key',
    item_type: 'crypt_key',
    category: 'key',
    amount: 1,
    level: 12, // a scribed level — proves the doc's level passes through
    kiosk_id: BK_B,
  })
  // MOVED: still SADD'd in BK_A's set, but its doc's live kiosk_id is a kiosk BAG_OWNER does NOT own.
  await setj(`rpc:item:${BAG_MOVED}`, {
    id: BAG_MOVED,
    name: 'Traded Away',
    item_type: 'x',
    category: 'sword',
    amount: 1,
    kiosk_id: FOREIGN_K,
  })
  // BAG_BURNED: intentionally NO item doc (burned) — its stale set membership must drop at read.

  // BAG_KEY is ALSO on the market (S-87 `listed` join test) — the SELL picker must exclude it, unlike
  // BAG_SWORD/BAG_POTION which stay unlisted. Deliberately NOT SADD'd into the global `rpc:idx:listings`
  // (the listings describe block's fixture set below) — handle_owner_items joins `rpc:listing:{id}`
  // directly per-item, never via that index, so this doc alone is the correct, isolated fixture.
  await setj(`rpc:listing:${BAG_KEY}`, { item_id: BAG_KEY, kiosk: BK_B, price_mist: '500', seller: BAG_OWNER })

  // a character listed on the marketplace: same kiosk index, NO item doc — resolves
  // against the character doc (category "character" + name).
  await setj(`rpc:character:${CHL}`, {
    id: CHL,
    owner: OWNER,
    name: 'Vendor',
    class: 'iop',
    pet_equipped: false,
    // Stale sibling identity must be suppressed by the authoritative EquipmentMap boolean.
    pet: { item_id: PET_ITEM, template_id: PET_TEMPLATE, slug: 'pet_bouloute' },
  })
  await setj(`rpc:character:${CH_PET_GAP}`, {
    id: CH_PET_GAP,
    pet_equipped: true,
    // A partial sibling snapshot is not enough to invent identity; the boolean remains authoritative.
    pet: { item_id: PET_ITEM, template_id: PET_TEMPLATE },
  })
  await setj(`rpc:character:${CH_PET_LEGACY}`, {
    id: CH_PET_LEGACY,
    // A pre-projection doc has no EquipmentMap boolean. Even stale-looking identity must stay suppressed.
    pet: { item_id: PET_ITEM, template_id: PET_TEMPLATE, slug: 'pet_bouloute' },
  })

  // listings (two items + one character, all on the native kiosk index)
  await setj(`rpc:listing:${ITEM_A}`, { item_id: ITEM_A, kiosk: '0xk1', price_mist: '1200', seller: OWNER })
  await setj(`rpc:listing:${ITEM_B}`, { item_id: ITEM_B, kiosk: '0xk2', price_mist: '999', seller: OWNER })
  await setj(`rpc:listing:${CHL}`, { item_id: CHL, kiosk: '0xk3', price_mist: '2000', seller: OWNER })
  await sadd('rpc:idx:listings', ITEM_A, ITEM_B, CHL)

  // sales history: SELLER_A owns KIOSK_A with three realised sales. Two are inside the
  // 30d revenue window (1500 + 800), one is 40d old (excluded from revenue, still
  // listed in the feed). ITEM_A/ITEM_B reuse the item docs above for the template join;
  // SOLD_GONE has NO item doc (a since-burned item → null category, the degraded path).
  const sales_now = Date.now()
  const DAY = 24 * 60 * 60 * 1000
  await sadd(`rpc:idx:seller_kiosks:${SELLER_A}`, KIOSK_A)
  await zadd_sale(KIOSK_A, sales_now - 1 * DAY, {
    item: ITEM_A,
    price_mist: '1500',
    buyer: BUYER_1,
    ts: sales_now - 1 * DAY,
  })
  await zadd_sale(KIOSK_A, sales_now - 2 * DAY, {
    item: ITEM_B,
    price_mist: '800',
    buyer: BUYER_2,
    ts: sales_now - 2 * DAY,
  })
  await zadd_sale(KIOSK_A, sales_now - 40 * DAY, {
    item: SOLD_GONE,
    price_mist: '9999',
    buyer: BUYER_1,
    ts: sales_now - 40 * DAY,
  })

  // pools
  await setj('rpc:pool:0xpoolA', {
    pool: '0xpoolA',
    template: '0xtplwood',
    item_reserve: 100,
    virtual_sui_mist: '1000000',
    real_sui_mist: '500000',
    paused: false,
  })
  await sadd('rpc:idx:pools', '0xpoolA')
  await setj('rpc:pool_by_template:0xtplwood', '0xpoolA')

  // shop sales: one active-and-stocked, one paused
  const now = Date.now()
  await setj('rpc:sale:0xsaleLive', {
    sale: '0xsaleLive',
    template: '0xtplpotion',
    price_mist: '250',
    supply: 10,
    minted: 3,
    paused: false,
    start_ms: now - 1000,
    end_ms: now + 100000,
  })
  await setj('rpc:sale:0xsalePaused', {
    sale: '0xsalePaused',
    template: '0xtplscroll',
    price_mist: '500',
    supply: null,
    minted: 0,
    paused: true,
    start_ms: null,
    end_ms: null,
  })
  await sadd('rpc:idx:sales', '0xsaleLive', '0xsalePaused')

  // worlds + zones + templates (encyclopedia)
  await setj(`rpc:world:${WORLD}`, { world: WORLD, seed: '42', biome: 'glacial', required_level: 60 })
  await sadd('rpc:idx:worlds', WORLD)
  await setj(`rpc:zone:${WORLD}:7:9`, {
    world: WORLD,
    zx: 7,
    zy: 9,
    discovered: true,
    discovered_at_ms: 1700000000000,
    mob_groups: 5,
    resource_nodes: 12,
  })
  await sadd(`rpc:idx:zones:${WORLD}`, '7:9')
  // A discovered zone WITH its raw STATE (Zone-DF snapshot, snapshot.rs map_zone_field — search-cost
  // rework: seed + consumed-bitmaps, never rows). Read via ?zone= (a direct doc GET, not the index), so
  // it does NOT perturb the count-only list above. seed is a STRING (full u64); mob_groups/resource_nodes
  // are the event arm's DERIVED totals — the view subtracts the bitmap popcounts to serve LIVE counts
  // (mob_bitmap [5] = bits 0+2 set → 2 consumed of 3; res_bitmap [1] = 1 consumed of 2).
  await setj(`rpc:zone:${WORLD}:3:4`, {
    world: WORLD,
    zx: 3,
    zy: 4,
    discovered: true,
    discovered_at_ms: 1700000009000,
    mob_groups: 3,
    resource_nodes: 2,
    seed: '18446744073709551615',
    mob_bitmap: [5],
    res_bitmap: [1],
    // The fight-create diet's search-committed mob-group commitment (snapshot.rs
    // map_group_root_field — merged onto this SAME doc): the 32-byte Blake2b root as a plain byte
    // array + the derivation-stream group count. The ?zone= form serves both VERBATIM — the client's
    // compose_mob_group_proof (@aresrpg/sdk) recomputes the root from the seed-derived stream and
    // fails shut to the original claim door on any mismatch.
    group_root: [...Array(32).keys()],
    group_count: 3,
    // Simulate stale fields left by the retired materialised-roster projection. The current view
    // must ignore them; snapshot backfill can enrich this doc in place without clearing zone keys.
    mobs: [],
    resources: [],
  })

  // §6 golden-gather rare links: one authored link in WORLD, a second world (WORLD_B) with
  // no links at all (exercises the omitted-?world= union + the empty-set skip).
  await setj(`rpc:rare_link:${WORLD}:${TPL_ORE}`, TPL_GOLDEN_ORE)
  await sadd(`rpc:idx:rare_links:${WORLD}`, TPL_ORE)
  await sadd('rpc:idx:worlds', WORLD_B)

  // item template: event arm sets item_type+live, object snapshot adds name/level/category
  await setj('rpc:template:0xtplsword', {
    template: '0xtplsword',
    item_type: 'weapon',
    name: 'Bronze Sword',
    level: 12,
    category: 'sword',
    live: true,
  })
  await sadd('rpc:idx:templates', '0xtplsword')
  // supply arm: the event-derived mint/burn counter (indexer HANDLERS.md "Item supply") —
  // a SEPARATE doc from the template above, joined at read time by handle_encyclopedia.
  await setj('rpc:supply:0xtplsword', { template: '0xtplsword', amount: 7 })
  // last-sale arm (marketcap): the snapshot pipeline's latest-wins price doc — price_mist is a
  // STRING (2^53 money law); a template with no doc (never sold) serves last_sale_mist null.
  await setj('rpc:lastsale:0xtplsword', { template: '0xtplsword', price_mist: '2000000000', ts: 1700000042000 })
  // mob template: object-snapshot prefix (name/level-range/hp/element) + raw loot rows the
  // indexer decodes from the MobTemplate object's loot vector. One row joins to the Bronze
  // Sword item doc above (name/category); one references a since-gone item (name/category
  // null — the honest gap). chance_bp is basis points → the view derives chance_percent.
  await setj('rpc:mob_template:0xmobgob', {
    template: '0xmobgob',
    name: 'Goblin',
    min_level: 3,
    max_level: 7,
    base_hp: 90,
    element: 2,
    drops: [
      { template_id: '0xtplsword', chance_bp: 5000, min_qty: 1, max_qty: 2 },
      { template_id: '0xtplmissing', chance_bp: 10000, min_qty: 1, max_qty: 1 },
    ],
    live: true,
  })
  await sadd('rpc:idx:mob_templates', '0xmobgob')
  // recipe: object-snapshotted crafting::Recipe doc (snapshot.rs map_recipe_object) — the
  // EXACT on-chain ingredient list + output + job/level/xp. One input references the live
  // Bronze Sword template; the client joins names itself off the items list.
  await setj('rpc:recipe:0xrcp1', {
    recipe: '0xrcp1',
    output_template: '0xtplsword',
    output_quantity: 1,
    required_job: 11,
    required_level: 1,
    craft_xp: 23,
    inputs: [
      { template_id: '0xtplore', quantity: 3 },
      { template_id: '0xtplwood', quantity: 1 },
    ],
    live: true,
  })
  await sadd('rpc:idx:recipes', '0xrcp1')

  // config + creation
  await setj('rpc:config', {
    enabled: true,
    dials: { xp_multiplier: 2, max_reachable_level: 200 },
    classes: { 1: { base_hp: 50, base_ap: 6, base_mp: 3 } },
  })
  await setj('rpc:creation', {
    price_mist: '5000',
    paused: false,
    free: true,
    sponsor: '0x00000000000000000000000000000000000000000000000000000000000abcde',
    classes: { sram: true, iop: true },
    starters: { sram: '0xtplsword' },
  })

  // kolizeum lobbies
  await setj('rpc:kolizeum:0xkzOpen', { kolizeum: '0xkzOpen', status: 'open', format_slots: 3, pledge_mist: '10000' })
  await setj('rpc:kolizeum:0xkzDone', { kolizeum: '0xkzDone', status: 'settled', pot_mist: '60000', winners: 3 })
  await sadd('rpc:idx:kolizeums', '0xkzOpen', '0xkzDone')

  // dungeon runs: one ACTIVE run (in room 2, latched to a fight); the per-owner index
  // also holds a consumed id (RUN_GONE — no doc) to exercise drop-missing.
  await setj(`rpc:run:${RUN_PASS}`, {
    pass: RUN_PASS,
    world: WORLD,
    player: OWNER,
    status: 'active',
    room: 2,
    fight: RUN_FIGHT,
  })
  await sadd(`rpc:idx:runs:${OWNER}`, RUN_PASS, RUN_GONE)

  // fights: one ACTIVE fight (two seats) + a per-world index that also holds a
  // terminal/deleted id (GONE_FIGHT — no doc) to exercise read-time drop-missing.
  await setj(`rpc:fight:${FIGHT_A}`, {
    fight: FIGHT_A,
    world: WORLD,
    spawn_id: '77',
    anchor_x: 100,
    anchor_z: 200,
    public_fight: true,
    aged_bp: 500,
    mob_count: 3,
    status: 'active',
    participants: { [CH]: 0, [CH2]: 1 },
    current_turn: { is_mob: false, idx: 0, deadline_ms: 1700000000000 },
    mob_positions: { 2: 15 }, // mob at slot idx 2 last moved to cell 15 (fight_events::MobMoved)
  })
  await setj(`rpc:char_fight:${CH}`, FIGHT_A)
  await setj(`rpc:char_fight:${CH2}`, FIGHT_A)
  await setj(`rpc:char_fight:${LONER}`, GONE_FIGHT) // dangling pointer: fight doc deleted on settle
  await sadd(`rpc:idx:fights:${WORLD}`, FIGHT_A, GONE_FIGHT)
  // FIGHT_A's mob-group template id (rpc:group_template:{world}:{spawn_id}, indexer zones::MobGroupClaimed),
  // keyed by FIGHT_A's (WORLD, spawn_id '77'). The fights view joins it at read time so the client names the
  // mobs; a fight with NO such doc (e.g. the placement NOMOB fight below, or a ticketless ambush) serves null.
  await setj(`rpc:group_template:${WORLD}:77`, MOB_TPL)

  // fight results: one opened (loot rolled), one fresh (defeat); the per-owner index
  // also holds a burned id (RES_BURNED — no doc) to exercise drop-missing.
  await setj(`rpc:result:${RES_OPEN}`, {
    result: RES_OPEN,
    fight: FIGHT_A,
    character: CH,
    owner: OWNER,
    outcome: 'victory',
    xp_share: 1200,
    final_hp: 45,
    opened: true,
    loot_units: 3,
  })
  await setj(`rpc:result:${RES_NEW}`, {
    result: RES_NEW,
    fight: FIGHT_A,
    character: CH2,
    owner: OWNER,
    outcome: 'defeat',
    xp_share: 0,
    final_hp: 0,
    opened: false,
    loot_units: 0,
  })
  await sadd(`rpc:idx:results:${OWNER}`, RES_OPEN, RES_NEW, RES_BURNED)

  // taux: board meta (100% neutral, 20-wide brackets) + one crushed template (in
  // bracket 2, coeff 72% at snapshot pressure 10000, bracket now at 15000 → drift
  // (15000-10000)*3/5 = 3000 milli → effective 75000) + one recipe-less template
  // whose settled coeff exceeds the 50% cap (clamped to 50000).
  await setj('rpc:taux_meta', { neutral_milli: 100000, bracket_size: 20 })
  await setj(`rpc:taux:${TPL_CRUSHED}`, {
    template: TPL_CRUSHED,
    coeff_milli: 72000,
    bracket: 2,
    snapshot: 10000,
    recipe_less: false,
  })
  await setj(`rpc:taux:${TPL_RECIPELESS}`, {
    template: TPL_RECIPELESS,
    coeff_milli: 300000,
    bracket: 5,
    snapshot: 0,
    recipe_less: true,
  })
  await setj('rpc:taux:bracket:2', 15000)
  await setj('rpc:taux:bracket:5', 0)
  await sadd('rpc:idx:taux', TPL_CRUSHED, TPL_RECIPELESS)

  // pending outcomes: PEND_OWNER has two openable outcomes (OUT_A newest, OUT_B older) plus
  // an index member whose doc was consumed (OUT_GONE — the capped-out / just-opened case the
  // view drops). Newest-first by the sorted-set score (= checkpoint ts).
  await zadd_pending(PEND_OWNER, 3000, OUT_A)
  await zadd_pending(PEND_OWNER, 2000, OUT_B)
  await zadd_pending(PEND_OWNER, 1000, OUT_GONE)
  await setj(`rpc:pending_outcome:${OUT_A}`, {
    outcome_id: OUT_A,
    character_id: CH,
    fight_id: FIGHT_A,
    world_id: WORLD,
    pvp: false,
    outcome: 2,
    aged_bp: 500,
  })
  await setj(`rpc:pending_outcome:${OUT_B}`, {
    outcome_id: OUT_B,
    character_id: CH2,
    fight_id: FIGHT_A,
    world_id: WORLD,
    pvp: true,
    outcome: 3,
    aged_bp: 0,
  })

  // pet-box claims: CLAIM_OWNER opened two boxes and hasn't collected either roll yet — the
  // indexer's map_pet_box_claim_object idiom (id-keyed map, not a stored array).
  await setj(`rpc:petclaims:${CLAIM_OWNER}`, {
    owner: CLAIM_OWNER,
    claims: { [CLAIM_A]: ROLLED_A, [CLAIM_B]: ROLLED_B },
  })

  // protector trigger: GATHERER's last gather spawned an ambush fight (spawn_id "88").
  await setj(`rpc:protector_trigger:${GATHERER}`, {
    gatherer: GATHERER,
    world: WORLD,
    template: TPL_ORE,
    x: 42,
    z: 77,
    spawn_id: '88',
    at_ms: 1700000005000,
  })

  // commissions: ARTISAN_A is offered two (COMM_1 from CUSTOMER_A, COMM_2 from CUSTOMER_B) and
  // separately opened one of their own toward OTHER_ARTISAN (COMM_3) — proves a single wallet
  // resolves both roles independently. COMM_GONE sits in ARTISAN_A's artisan-index with no doc.
  await setj(`rpc:commission:${COMM_1}`, {
    commission: COMM_1,
    customer: CUSTOMER_A,
    artisan: ARTISAN_A,
    amount_mist: '2000000000',
    opened_at_ms: 1700000001000,
  })
  await setj(`rpc:commission:${COMM_2}`, {
    commission: COMM_2,
    customer: CUSTOMER_B,
    artisan: ARTISAN_A,
    amount_mist: '500000000',
    opened_at_ms: 1700000002000,
  })
  await setj(`rpc:commission:${COMM_3}`, {
    commission: COMM_3,
    customer: ARTISAN_A,
    artisan: OTHER_ARTISAN,
    amount_mist: '750000000',
    opened_at_ms: 1700000003000,
  })
  await sadd(`rpc:idx:commissions_by_artisan:${ARTISAN_A}`, COMM_1, COMM_2, COMM_GONE)
  await sadd(`rpc:idx:commissions_by_artisan:${OTHER_ARTISAN}`, COMM_3)
  await sadd(`rpc:idx:commissions_by_customer:${CUSTOMER_A}`, COMM_1)
  await sadd(`rpc:idx:commissions_by_customer:${CUSTOMER_B}`, COMM_2)
  await sadd(`rpc:idx:commissions_by_customer:${ARTISAN_A}`, COMM_3)
  // Generous timeout: seeding is tiny, but a busy CI host / cold connect must not flake.
}, 30000)

afterAll(async () => {
  await flush_test_redis()
}, 30000)

describe('characters', () => {
  test('by ids returns profile with equipment as an array + snapshot cosmetics', async () => {
    const { status, data } = await handle_characters(P({ ids: CH }))
    expect(status).toBe(200)
    expect(data.characters).toHaveLength(1)
    const [c] = data.characters
    expect(c.name).toBe('Aiden')
    expect(c.owner).toBe(OWNER)
    // object-snapshot fields (the "others render as default dolls" fix)
    expect(c.male).toBe(true)
    expect(c.colors).toEqual({ color_1: 16777215, color_2: 13935180, color_3: 9136404 })
    expect(c.level).toBe(12)
    expect(c.experience).toBe(32600)
    expect(c.kiosk_id).toBe(KIOSK_A) // generic kiosk discovery (mandated behavior)
    expect(c.pet_equipped).toBe(true)
    expect(c.pet).toEqual({ item_id: PET_ITEM, template_id: PET_TEMPLATE, slug: 'pet_bouloute' })
    // equipment rows carry the joined category (null for ITEM_A whose template isn't snapshotted; 'hat'
    // for ITEM_HAT whose template doc carries category). Order = the doc's insertion order.
    expect(c.equipment).toEqual([
      { item_id: ITEM_A, template: '0xtpl', category: null, amount: 1 },
      { item_id: ITEM_HAT, template: TPL_HAT, category: 'hat', amount: 1 },
    ])
  })

  test('resolves equipped cosmetics into worn slots (hat/cloak) keyed by category', async () => {
    const { data } = await handle_characters(P({ ids: CH }))
    // The equipped hat surfaces under `worn.hat` with template_id (the GLB key) — the exact shape
    // rpc_to_card spreads onto the render character for resolve_worn_cosmetics. The non-cosmetic ITEM_A
    // (null category) is NOT a worn slot, so `worn` holds only the hat.
    expect(data.characters[0].worn).toEqual({ hat: { item_id: ITEM_HAT, template_id: TPL_HAT, category: 'hat' } })
  })

  test('character with no equipped cosmetics → worn is {} (additive, back-compat)', async () => {
    const { data } = await handle_characters(P({ ids: CHL })) // CHL has no equipment block
    expect(data.characters[0].worn).toEqual({})
  })

  test('EquipmentMap false suppresses a stale pet identity', async () => {
    const { data } = await handle_characters(P({ ids: CHL }))
    expect(data.characters[0]).toMatchObject({ pet: null, pet_equipped: false })
  })

  test('EquipmentMap true survives an incomplete sibling identity snapshot', async () => {
    const { data } = await handle_characters(P({ ids: CH_PET_GAP }))
    expect(data.characters[0]).toMatchObject({ pet: null, pet_equipped: true })
  })

  test('a legacy document defaults to unequipped and suppresses stale identity', async () => {
    const { data } = await handle_characters(P({ ids: CH_PET_LEGACY }))
    expect(data.characters[0]).toMatchObject({ pet: null, pet_equipped: false })
  })

  test('serves §3 allocated stats (named) + derived available_points', async () => {
    const { data } = await handle_characters(P({ ids: CH }))
    const [c] = data.characters
    // stats: {0:10,2:5} → vitality 10, strength 5, the rest 0.
    expect(c.vitality).toBe(10)
    expect(c.strength).toBe(5)
    expect(c.wisdom).toBe(0)
    expect(c.intelligence).toBe(0)
    expect(c.agility).toBe(0)
    expect(c.chance).toBe(0)
    // available = (level 12 − 1) × 5 earned − 15 spent = 40.
    expect(c.available_points).toBe(40)
  })

  test('un-allocated / un-snapshotted character → all stats 0, available_points 0', async () => {
    const { data } = await handle_characters(P({ ids: CHL })) // no stats, no level
    const [c] = data.characters
    expect(c.vitality).toBe(0)
    expect(c.available_points).toBe(0)
  })

  test('maps the numeric job-xp block to slug-keyed jobs (the JobsDrawer shape)', async () => {
    const { data } = await handle_characters(P({ ids: CH }))
    const [c] = data.characters
    // jobs: {0:50, 2:1911} → farmer 50 xp, miner 1911 xp; the client derives the level via job_level(xp).
    // RAW totals (never a pre-derived level), keyed by the SDK job slug the JobsDrawer reads.
    expect(c.jobs).toEqual({ farmer: 50, miner: 1911 })
  })

  test('character with no job-xp block → jobs is {} (feature stays at level 1 / 0 xp)', async () => {
    const { data } = await handle_characters(P({ ids: CHL })) // CHL has no jobs block
    expect(data.characters[0].jobs).toEqual({})
  })

  test('serves the live HP block + net-gear vitality (T76 party-frame HP bars / max_hp)', async () => {
    const { data } = await handle_characters(P({ ids: CH }))
    const [c] = data.characters
    // RAW stored hp + the lazy-regen stamp (the client owns the §5.4 projection) + the NET GEAR
    // vitality cache — distinct from the allocated `vitality` (10) above; both feed character_max_hp.
    expect(c.current_hp).toBe(137)
    expect(c.hp_updated_ms).toBe(1700000000123)
    expect(c.gear_vitality).toBe(20)
  })

  test('un-snapshotted character → null HP block + gear_vitality (additive, back-compat)', async () => {
    const { data } = await handle_characters(P({ ids: CHL })) // CHL has no progression/equipment DF snapshot
    const [c] = data.characters
    expect(c.current_hp).toBeNull()
    expect(c.hp_updated_ms).toBeNull()
    expect(c.gear_vitality).toBeNull()
  })

  test('un-snapshotted character returns null cosmetics + kiosk (additive, back-compat)', async () => {
    const { data } = await handle_characters(P({ ids: CHL })) // CHL has no colors/male/kiosk
    expect(data.characters[0]).toMatchObject({ colors: null, male: null, level: null, kiosk_id: null })
  })

  test('surfaces `listed` joined against rpc:listing:{id} (S-87 SELL/kolizeum picker signal)', async () => {
    const { data } = await handle_characters(P({ ids: `${CH},${CHL}` }))
    // CHL carries a listing doc (the "listings" fixture below); CH does not.
    expect(data.characters.find((c) => c.id === CH).listed).toBe(false)
    expect(data.characters.find((c) => c.id === CHL).listed).toBe(true)
  })

  test('resolving by owning address via the per-owner index', async () => {
    const { data } = await handle_characters(P({ owner: OWNER }))
    expect(data.characters.map((c) => c.id)).toEqual([CH])
  })

  test('accepts a single ?id= alias', async () => {
    const { data } = await handle_characters(P({ id: CH }))
    expect(data.characters.map((c) => c.id)).toEqual([CH])
  })

  test('missing params is a 400', async () => {
    const { status } = await handle_characters(P({}))
    expect(status).toBe(400)
  })
})

describe('names by character name', () => {
  test('a valid name with no projected index returns an empty matches array (200)', async () => {
    const { status, data } = await handle_names(P({ name: 'Nobody' }))
    expect(status).toBe(200)
    expect(data).toEqual({ matches: [] })
  })

  test('an exact hit returns the indexed character owner inside matches', async () => {
    const { status, data } = await handle_names(P({ name: 'Aiden' }))
    expect(status).toBe(200)
    expect(data).toEqual({ matches: [{ name: 'Aiden', character_id: CH, owner: OWNER, level: 12, class: 'sram' }] })
  })

  test('character-name lookup is case-insensitive', async () => {
    const { data } = await handle_names(P({ name: 'AiDeN' }))
    expect(data.matches[0].character_id).toBe(CH)
  })

  test.each(['', 'a'.repeat(20), '英雄'])('rejects a malformed name before lookup: %p', async (name) => {
    const { status, data } = await handle_names(P({ name }))
    expect(status).toBe(400)
    expect(data.error).toBe('bad_request')
  })
})

describe('owner items (loose kiosk-locked bag)', () => {
  test('unions items across the wallet’s kiosks, threading each row’s source kiosk + cap', async () => {
    const { status, data } = await handle_owner_items(P({ address: BAG_OWNER }))
    expect(status).toBe(200)
    // sword + potion (BK_A) + key (BK_B). The MOVED item (doc → foreign kiosk) and the BURNED item
    // (no doc) both drop out via read-time reconciliation.
    expect(data.items.map((i) => i.id).sort()).toEqual([BAG_SWORD, BAG_POTION, BAG_KEY].sort())

    const sword = data.items.find((i) => i.id === BAG_SWORD)
    expect(sword).toEqual({
      id: BAG_SWORD,
      template_id: null, // no `template` on the seed doc → views.js `d.template ?? null`
      kiosk_id: BK_A,
      kiosk_cap_id: CAP_A,
      name: 'Iron Sword',
      item_category: 'sword', // on-chain `category` → client `item_category`
      item_set: '',
      item_type: 'sword_iron',
      level: 0, // null doc level → 0 (parity with the chain-direct bag)
      amount: 1,
      listed: false,
    })
    // the potion carries its stack amount; the key sits in the SIBLING kiosk with its own cap AND is
    // ALREADY LISTED (S-87 join against rpc:listing:{id}) — the SELL picker excludes it, this view doesn't.
    expect(data.items.find((i) => i.id === BAG_POTION)).toMatchObject({
      amount: 5,
      item_category: 'consumable',
      listed: false,
    })
    expect(data.items.find((i) => i.id === BAG_KEY)).toMatchObject({
      kiosk_id: BK_B,
      kiosk_cap_id: CAP_B,
      level: 12,
      listed: true,
    })
  })

  test('a wallet with no personal kiosks returns an empty bag', async () => {
    const { status, data } = await handle_owner_items(P({ address: LONER }))
    expect(status).toBe(200)
    expect(data.items).toEqual([])
  })

  test('missing ?address= is a 400', async () => {
    const { status } = await handle_owner_items(P({}))
    expect(status).toBe(400)
  })
})

describe('pending outcomes', () => {
  test('by owner returns openable outcomes newest-first in the exact frozen shape', async () => {
    const { status, data } = await handle_pending_outcomes(P({ owner: PEND_OWNER }))
    expect(status).toBe(200)
    // Frozen contract: a BARE JSON array; drop-missing removed OUT_GONE; newest (OUT_A) first.
    expect(Array.isArray(data)).toBe(true)
    expect(data.map((o) => o.outcome_id)).toEqual([OUT_A, OUT_B])
    expect(data[0]).toEqual({
      outcome_id: OUT_A,
      character_id: CH,
      fight_id: FIGHT_A,
      world_id: WORLD,
      pvp: false,
      outcome: 2,
      aged_bp: 500,
    })
    // Exactly the 7 frozen keys — no more, no less (the frontend lane depends on it).
    expect(Object.keys(data[0]).sort()).toEqual(
      ['aged_bp', 'character_id', 'fight_id', 'outcome', 'outcome_id', 'pvp', 'world_id'].sort()
    )
  })

  test('unknown owner returns an empty array', async () => {
    const { data } = await handle_pending_outcomes(P({ owner: LONER }))
    expect(data).toEqual([])
  })

  test('missing owner is a 400', async () => {
    const { status } = await handle_pending_outcomes(P({}))
    expect(status).toBe(400)
  })
})

describe('pet claims', () => {
  test('by owner returns the unclaimed rolled pets as a bare array', async () => {
    const { status, data } = await handle_pet_claims(P({ owner: CLAIM_OWNER }))
    expect(status).toBe(200)
    expect(Array.isArray(data)).toBe(true)
    expect(data).toHaveLength(2)
    expect(data).toEqual(
      expect.arrayContaining([
        { claim_id: CLAIM_A, rolled_template: ROLLED_A },
        { claim_id: CLAIM_B, rolled_template: ROLLED_B },
      ])
    )
  })

  test('unknown owner returns an empty array', async () => {
    const { data } = await handle_pet_claims(P({ owner: LONER }))
    expect(data).toEqual([])
  })

  test('missing owner is a 400', async () => {
    const { status } = await handle_pet_claims(P({}))
    expect(status).toBe(400)
  })
})

describe('listings', () => {
  test('sorts by price ascending by default (joins item category/level)', async () => {
    const { data } = await handle_listings(P({}))
    expect(data.listings.map((l) => l.price_mist)).toEqual(['999', '1200', '2000'])
    expect(data.listings[0]).toMatchObject({
      item_id: ITEM_B,
      template_id: '0xtplhelm',
      item_category: 'resource',
      amount: 10,
      category: 'armor',
      level: 80,
    })
  })

  test('surfaces a listed character (no item doc) as category "character" with its name', async () => {
    const { data } = await handle_listings(P({ category: 'character' }))
    expect(data.listings).toHaveLength(1)
    expect(data.listings[0]).toMatchObject({ item_id: CHL, category: 'character', name: 'Vendor', level: null })
  })

  test('filters by category and level range', async () => {
    const { data } = await handle_listings(P({ category: 'weapon', min_level: '30', max_level: '50' }))
    expect(data.listings).toHaveLength(1)
    expect(data.listings[0].item_id).toBe(ITEM_A)
  })

  test('paginates with a cursor', async () => {
    const { data } = await handle_listings(P({ limit: '1' }))
    expect(data.listings).toHaveLength(1)
    expect(data.next_cursor).toBe('1')
  })
})

describe('pools', () => {
  test('computes sui_reserve and spot price from reserves', async () => {
    const { data } = await handle_pools(P({}))
    const [p] = data.pools
    expect(p.sui_reserve_mist).toBe('1500000') // 1_000_000 virtual + 500_000 real
    // ceil(1_500_000 / (100 - 1)) = ceil(15151.51) = 15152
    expect(p.spot_price_mist).toBe('15152')
  })

  test('by template fetches the single pool', async () => {
    const { data } = await handle_pools(P({ template: '0xtplwood' }))
    expect(data.pools).toHaveLength(1)
    expect(data.pools[0].pool_id).toBe('0xpoolA')
  })
})

describe('shop', () => {
  test('computes supply_remaining and lists all by default', async () => {
    const { data } = await handle_shop(P({}))
    const live = data.sales.find((s) => s.sale_id === '0xsaleLive')
    expect(live.supply_remaining).toBe(7) // 10 - 3
    expect(data.sales).toHaveLength(2)
  })

  test('active filter drops paused/out-of-window sales', async () => {
    const { data } = await handle_shop(P({ active: 'true' }))
    expect(data.sales.map((s) => s.sale_id)).toEqual(['0xsaleLive'])
  })
})

describe('zones', () => {
  test('requires a world', async () => {
    const { status } = await handle_zones(P({}))
    expect(status).toBe(400)
  })

  test('returns discovered zones with the world seed/biome', async () => {
    const { data } = await handle_zones(P({ world: WORLD }))
    expect(data.biome).toBe('glacial')
    expect(data.zones).toEqual([
      {
        zone_id: '7:9',
        zx: 7,
        zy: 9,
        discovered: true,
        discovered_at_ms: 1700000000000,
        mob_groups: 5,
        resource_nodes: 12,
      },
    ])
  })

  test('the list form carries NO per-zone state (counts only)', async () => {
    const { data } = await handle_zones(P({ world: WORLD }))
    expect(data.zones.every((z) => z.seed === undefined && z.mob_bitmap === undefined)).toBe(true)
  })

  test('?zone= returns the one zone WITH its raw state; live counts subtract the consumed bits', async () => {
    const { data } = await handle_zones(P({ world: WORLD, zone: '3:4' }))
    expect(data.zones).toHaveLength(1)
    const [z] = data.zones
    // totals 3/2 minus popcounts (mob [5] → 2 bits, res [1] → 1 bit) = live 1/1
    expect(z).toMatchObject({ zone_id: '3:4', zx: 3, zy: 4, mob_groups: 1, resource_nodes: 1 })
    // The raw state feeds the client derivation verbatim (seed stays a STRING — 2^53 law).
    expect(z.seed).toBe('18446744073709551615')
    expect(z.mob_bitmap).toEqual([5])
    expect(z.res_bitmap).toEqual([1])
    expect(z.mobs).toBeUndefined()
    expect(z.resources).toBeUndefined()
  })

  test('?zone= serves the group commitment verbatim (the fight-create diet witness ingredient)', async () => {
    const { data } = await handle_zones(P({ world: WORLD, zone: '3:4' }))
    const [z] = data.zones
    // The 32-byte Blake2b root as the plain byte array the indexer projected (never re-encoded —
    // the SDK composer consumes number[]); the count is the FULL derivation-stream size (all 3
    // groups), independent of the consumed-bitmap live count served above (1).
    expect(z.group_root).toEqual([...Array(32).keys()])
    expect(z.group_count).toBe(3)
  })

  test('a zone WITHOUT a commitment serves nulls (pre-diet search → the old claim door)', async () => {
    const { data } = await handle_zones(P({ world: WORLD, zone: '7:9' }))
    const [z] = data.zones
    expect(z.group_root).toBeNull()
    expect(z.group_count).toBeNull()
  })

  test('the list form never carries the commitment (state form only)', async () => {
    const { data } = await handle_zones(P({ world: WORLD }))
    expect(data.zones.every((z) => z.group_root === undefined && z.group_count === undefined)).toBe(true)
  })

  test('?zone= for an undiscovered zone returns an empty array (the unsearched signal)', async () => {
    const { data } = await handle_zones(P({ world: WORLD, zone: '99:99' }))
    expect(data.zones).toEqual([])
    expect(data.biome).toBe('glacial') // the world seed/biome envelope still rides along
  })
})

describe('rare links', () => {
  test("?world= returns that world's authored base→rare links", async () => {
    const { data } = await handle_rare_links(P({ world: WORLD }))
    expect(data.rare_links).toEqual([{ world: WORLD, template_id: TPL_ORE, rare_template_id: TPL_GOLDEN_ORE }])
  })

  test('a world with no authored links returns an empty array (no error)', async () => {
    const { data } = await handle_rare_links(P({ world: WORLD_B }))
    expect(data.rare_links).toEqual([])
  })

  test("omitted ?world= unions every live world's links", async () => {
    const { data } = await handle_rare_links(P({}))
    expect(data.rare_links).toEqual([{ world: WORLD, template_id: TPL_ORE, rare_template_id: TPL_GOLDEN_ORE }])
  })
})

describe('encyclopedia', () => {
  test('serves minted item + mob templates (name/level from object snapshot) + server-joined mob drops + worlds', async () => {
    const { data } = await handle_encyclopedia(P({}))
    expect(data.items).toEqual([
      {
        template_id: '0xtplsword',
        item_type: 'weapon',
        name: 'Bronze Sword',
        description: null, // object snapshot — the fixture doc below sets no description
        level: 12,
        category: 'sword',
        supply: 7,
        last_sale_mist: '2000000000', // lastsale doc joined (string MIST); null when never sold
      },
    ])
    // mob prefix + display-ready drops: the first row joins the Bronze Sword item doc
    // (name/category), the second references a since-gone item → null gap (never fabricated);
    // chance_bp 5000/10000 → chance_percent 50/100.
    expect(data.mobs).toEqual([
      {
        template_id: '0xmobgob',
        name: 'Goblin',
        min_level: 3,
        max_level: 7,
        base_hp: 90,
        element: 2,
        drops: [
          {
            template_id: '0xtplsword',
            name: 'Bronze Sword',
            category: 'sword',
            chance_percent: 50,
            min_qty: 1,
            max_qty: 2,
          },
          { template_id: '0xtplmissing', name: null, category: null, chance_percent: 100, min_qty: 1, max_qty: 1 },
        ],
      },
    ])
    expect(data.worlds).toEqual([{ world_id: WORLD, seed: '42', biome: 'glacial', required_level: 60 }])
    // recipes: the object-snapshotted crafting truth, values verbatim (ids raw — the client
    // joins names off the items list above; never a server-fabricated display value).
    expect(data.recipes).toEqual([
      {
        recipe_id: '0xrcp1',
        output_template_id: '0xtplsword',
        output_quantity: 1,
        required_job: 11,
        required_level: 1,
        craft_xp: 23,
        inputs: [
          { template_id: '0xtplore', quantity: 3 },
          { template_id: '0xtplwood', quantity: 1 },
        ],
      },
    ])
  })

  test('?kind=mobs returns only the mob templates', async () => {
    const { data } = await handle_encyclopedia(P({ kind: 'mobs' }))
    expect(data.mobs.map((m) => m.name)).toEqual(['Goblin'])
    expect(data.items).toEqual([])
    expect(data.worlds).toEqual([])
    expect(data.recipes).toEqual([])
  })

  test('?kind=recipes returns only the recipe rows (existence ⇔ a live on-chain Recipe doc)', async () => {
    const { data } = await handle_encyclopedia(P({ kind: 'recipes' }))
    expect(data.recipes.map((r) => r.recipe_id)).toEqual(['0xrcp1'])
    expect(data.items).toEqual([])
    expect(data.mobs).toEqual([])
    expect(data.worlds).toEqual([])
  })
})

describe('config', () => {
  test('merges game dials, classes and creation config', async () => {
    const { data } = await handle_config(P({}))
    expect(data.dials.xp_multiplier).toBe(2)
    expect(data.creation.price_mist).toBe('5000')
    expect(data.creation.classes.sort()).toEqual(['iop', 'sram'])
  })

  test('surfaces free-creation state (free + sponsor) for the create UI / ceremony assertion', async () => {
    const { data } = await handle_config(P({}))
    expect(data.creation.free).toBe(true)
    expect(data.creation.sponsor).toBe('0x00000000000000000000000000000000000000000000000000000000000abcde')
  })

  test('serves protector_templates from the ceremony-manifest env (PROTECTOR_TEMPLATES)', async () => {
    // The §17.22 gather-ambush resolver: seed key → minted MobTemplate id. Env-fed deploy
    // config (the ceremony seed manifest records the ids) — NOT chain-projected, the chain
    // carries no protector marker (no role/slug on MobTemplate; name is a display name).
    const prev = process.env.PROTECTOR_TEMPLATES
    process.env.PROTECTOR_TEMPLATES = JSON.stringify({ protector_wheat: TPL_ORE })
    try {
      const { data } = await handle_config(P({}))
      expect(data.protector_templates).toEqual({ protector_wheat: TPL_ORE })
    } finally {
      if (prev === undefined) delete process.env.PROTECTOR_TEMPLATES
      else process.env.PROTECTOR_TEMPLATES = prev
    }
  })

  test('absent or malformed PROTECTOR_TEMPLATES env → empty map (never a 500)', async () => {
    const prev = process.env.PROTECTOR_TEMPLATES
    try {
      delete process.env.PROTECTOR_TEMPLATES
      expect((await handle_config(P({}))).data.protector_templates).toEqual({})
      process.env.PROTECTOR_TEMPLATES = 'not-json{'
      expect((await handle_config(P({}))).data.protector_templates).toEqual({})
      process.env.PROTECTOR_TEMPLATES = '["an","array"]' // wrong shape → {}
      expect((await handle_config(P({}))).data.protector_templates).toEqual({})
    } finally {
      if (prev === undefined) delete process.env.PROTECTOR_TEMPLATES
      else process.env.PROTECTOR_TEMPLATES = prev
    }
  })
})

describe('kolizeum', () => {
  test('lists lobbies and filters by status', async () => {
    const all = await handle_kolizeum(P({}))
    expect(all.data.kolizeums).toHaveLength(2)
    const open = await handle_kolizeum(P({ status: 'open' }))
    expect(open.data.kolizeums.map((k) => k.kolizeum)).toEqual(['0xkzOpen'])
  })

  test('by id fetches one', async () => {
    const { data } = await handle_kolizeum(P({ id: '0xkzDone' }))
    expect(data.kolizeums[0].status).toBe('settled')
  })
})

describe('dungeon runs', () => {
  test('by owner returns active runs (room + latched fight) and drops consumed ids', async () => {
    const { status, data } = await handle_dungeon_runs(P({ owner: OWNER }))
    expect(status).toBe(200)
    expect(data.runs).toHaveLength(1) // RUN_GONE in the index but no doc → dropped
    expect(data.runs[0]).toMatchObject({
      pass_id: RUN_PASS,
      world: WORLD,
      player: OWNER,
      status: 'active',
      room: 2,
      fight_id: RUN_FIGHT,
    })
  })

  test('by pass fetches one', async () => {
    const { data } = await handle_dungeon_runs(P({ pass: RUN_PASS }))
    expect(data.runs.map((r) => r.pass_id)).toEqual([RUN_PASS])
  })

  test('an unknown/consumed pass returns empty', async () => {
    const { data } = await handle_dungeon_runs(P({ pass: RUN_GONE }))
    expect(data.runs).toEqual([])
  })

  test('missing params is a 400', async () => {
    const { status } = await handle_dungeon_runs(P({}))
    expect(status).toBe(400)
  })
})

describe('fights', () => {
  test('by id returns the fight with a seat-sorted roster and turn cursor', async () => {
    const { status, data } = await handle_fights(P({ id: FIGHT_A }))
    expect(status).toBe(200)
    expect(data.fights).toHaveLength(1)
    const [f] = data.fights
    expect(f.fight_id).toBe(FIGHT_A)
    expect(f.status).toBe('active')
    expect(f.spawn_id).toBe('77')
    expect(f.anchor).toEqual({ x: 100, z: 200 })
    expect(f.participants).toEqual([
      { character: CH, seat: 0 },
      { character: CH2, seat: 1 },
    ])
    expect(f.current_turn).toEqual({ is_mob: false, idx: 0, deadline_ms: 1700000000000 })
    // MobMoved projection: each mob's latest cell, idx-sorted (a mob has no p2p presence).
    expect(f.mob_positions).toEqual([{ idx: 2, cell: 15 }])
    // group_template JOIN (read-time, rpc:group_template:{world}:{spawn_id}): the client resolves this id →
    // the mob display name. Without the join a fight serves mob_count only → "Enemies #N" placeholders.
    expect(f.group_template).toBe(MOB_TPL)
  })

  test('a fight with no mob moves yet returns an empty mob_positions array + null group_template (back-compat)', async () => {
    // An isolated placement fight with no mob_positions field (never added to a world index,
    // so no other test sees it) — proves a pre-MobMoved doc still shapes cleanly. It also has NO
    // group_template doc (no matching (world, spawn_id)) → the join serves null → the honest fallback.
    const NOMOB = '0x0000000000000000000000000000000000000000000000000000000000000f1b'
    await setj(`rpc:fight:${NOMOB}`, { fight: NOMOB, world: WORLD, status: 'placement' })
    const { data } = await handle_fights(P({ id: NOMOB }))
    expect(data.fights[0].mob_positions).toEqual([])
    expect(data.fights[0].group_template).toBeNull()
  })

  test('by character resolves via the char→fight pointer', async () => {
    const { data } = await handle_fights(P({ character: CH2 }))
    expect(data.fights.map((f) => f.fight_id)).toEqual([FIGHT_A])
  })

  test('by character with a dangling pointer (fight settled) returns empty', async () => {
    const { data } = await handle_fights(P({ character: LONER }))
    expect(data.fights).toEqual([])
  })

  test('by world returns active fights and drops missing/terminal ids', async () => {
    const { data } = await handle_fights(P({ world: WORLD }))
    expect(data.fights.map((f) => f.fight_id)).toEqual([FIGHT_A]) // GONE_FIGHT has no doc → dropped
  })

  test('missing params is a 400', async () => {
    const { status } = await handle_fights(P({}))
    expect(status).toBe(400)
  })
})

describe('protector trigger', () => {
  test('by gatherer address returns the latest ambush signal', async () => {
    const { status, data } = await handle_protector_trigger(P({ address: GATHERER }))
    expect(status).toBe(200)
    expect(data.trigger).toEqual({
      gatherer: GATHERER,
      world: WORLD,
      template: TPL_ORE,
      x: 42,
      z: 77,
      spawn_id: '88', // u64 handle as a string ("0" would mean skipped)
      at_ms: 1700000005000,
    })
  })

  test('a gatherer with no trigger returns null', async () => {
    const { status, data } = await handle_protector_trigger(P({ address: LONER }))
    expect(status).toBe(200)
    expect(data.trigger).toBeNull()
  })

  test('missing ?address= is a 400', async () => {
    const { status } = await handle_protector_trigger(P({}))
    expect(status).toBe(400)
  })
})

describe('commissions', () => {
  test('by address resolves both roles: as_artisan (offered to them) and as_customer (their own asks)', async () => {
    const { status, data } = await handle_commissions(P({ address: ARTISAN_A }))
    expect(status).toBe(200)
    expect(data.as_artisan.map((c) => c.commission_id).sort()).toEqual([COMM_1, COMM_2].sort())
    expect(data.as_customer.map((c) => c.commission_id)).toEqual([COMM_3])

    // as artisan: counterparty is the customer who opened it.
    const c1 = data.as_artisan.find((c) => c.commission_id === COMM_1)
    expect(c1).toEqual({
      commission_id: COMM_1,
      counterparty: CUSTOMER_A,
      amount_mist: '2000000000',
      opened_at_ms: 1700000001000,
    })

    // as customer: counterparty is the artisan the wallet commissioned.
    const [c3] = data.as_customer
    expect(c3).toEqual({
      commission_id: COMM_3,
      counterparty: OTHER_ARTISAN,
      amount_mist: '750000000',
      opened_at_ms: 1700000003000,
    })
  })

  test('a claimed/cancelled commission lingering in the artisan index (no doc) drops at read time', async () => {
    const { data } = await handle_commissions(P({ address: ARTISAN_A }))
    expect(data.as_artisan.map((c) => c.commission_id)).not.toContain(COMM_GONE)
  })

  test('a wallet that only ever customers returns an empty as_artisan array', async () => {
    const { data } = await handle_commissions(P({ address: CUSTOMER_B }))
    expect(data.as_artisan).toEqual([])
    expect(data.as_customer.map((c) => c.commission_id)).toEqual([COMM_2])
  })

  test('an address with no commissions in either role returns empty arrays, not an error', async () => {
    const { status, data } = await handle_commissions(P({ address: LONER }))
    expect(status).toBe(200)
    expect(data).toEqual({ as_artisan: [], as_customer: [] })
  })

  test('missing ?address= is a 400', async () => {
    const { status } = await handle_commissions(P({}))
    expect(status).toBe(400)
  })
})

describe('fight results', () => {
  test('by owner lists the wallet results and drops burned/missing ids', async () => {
    const { status, data } = await handle_fight_results(P({ owner: OWNER }))
    expect(status).toBe(200)
    expect(data.results).toHaveLength(2) // RES_BURNED in the index but no doc → dropped
    const open = data.results.find((r) => r.result_id === RES_OPEN)
    expect(open).toMatchObject({ outcome: 'victory', xp_share: 1200, final_hp: 45, opened: true, loot_units: 3 })
    const fresh = data.results.find((r) => r.result_id === RES_NEW)
    expect(fresh).toMatchObject({ outcome: 'defeat', opened: false, loot_units: 0 })
  })

  test('unknown owner returns empty', async () => {
    const { data } = await handle_fight_results(P({ owner: '0xnobody' }))
    expect(data.results).toEqual([])
  })

  test('missing owner is a 400', async () => {
    const { status } = await handle_fight_results(P({}))
    expect(status).toBe(400)
  })
})

describe('taux', () => {
  test('no params lists every touched template + board meta', async () => {
    const { status, data } = await handle_taux(P({}))
    expect(status).toBe(200)
    expect(data.neutral_milli).toBe(100000)
    expect(data.bracket_size).toBe(20)
    expect(data.floor_milli).toBe(1000)
    expect(data.cap_milli).toBe(4000000)
    expect(data.taux.map((t) => t.template_id).sort()).toEqual([TPL_CRUSHED, TPL_RECIPELESS].sort())
  })

  test('folds bracket drift into the effective coefficient', async () => {
    const { data } = await handle_taux(P({ template: TPL_CRUSHED }))
    const [t] = data.taux
    // 72000 + (15000-10000)*3/5 = 72000 + 3000 = 75000 (75%)
    expect(t).toMatchObject({ coeff_milli: 75000, coeff_percent: 75, recipe_less: false, source: 'crushed' })
  })

  test('clamps a recipe-less template to the 50% cap', async () => {
    const { data } = await handle_taux(P({ template: TPL_RECIPELESS }))
    // 300000 settled coeff, recipe-less → min(coeff, 50000)
    expect(data.taux[0]).toMatchObject({ coeff_milli: 50000, coeff_percent: 50, recipe_less: true })
  })

  test('an untouched template defaults to the neutral coefficient', async () => {
    const { data } = await handle_taux(P({ template: TPL_UNTOUCHED }))
    expect(data.taux[0]).toMatchObject({
      template_id: TPL_UNTOUCHED,
      coeff_milli: 100000,
      coeff_percent: 100,
      source: 'neutral',
    })
  })

  test('bulk ?ids= resolves each (stored + neutral) in order', async () => {
    const { data } = await handle_taux(P({ ids: `${TPL_UNTOUCHED},${TPL_CRUSHED}` }))
    expect(data.taux.map((t) => t.source)).toEqual(['neutral', 'crushed'])
  })
})

describe('sales-history', () => {
  test('missing seller is a 400', async () => {
    expect((await handle_sales_history(P({}))).status).toBe(400)
  })

  test('a seller with no kiosk returns empty + zero revenue', async () => {
    const { status, data } = await handle_sales_history(P({ seller: LONER }))
    expect(status).toBe(200)
    expect(data).toMatchObject({ seller: LONER, sales: [], revenue_30d_mist: '0', total: 0, next_cursor: null })
  })

  test('returns sales newest-first with item join + 30d revenue (40d-old sale excluded)', async () => {
    const { status, data } = await handle_sales_history(P({ seller: SELLER_A }))
    expect(status).toBe(200)
    expect(data.total).toBe(3)
    // newest first: 1d, 2d, 40d
    expect(data.sales.map((s) => s.item_id)).toEqual([ITEM_A, ITEM_B, SOLD_GONE])
    // item doc join enriches template/category/level (ITEM_A = weapon L40)
    expect(data.sales[0]).toMatchObject({
      item_id: ITEM_A,
      template_id: '0xtplsword',
      category: 'weapon',
      level: 40,
      price_mist: '1500',
      buyer: BUYER_1,
    })
    // revenue = 1500 + 800; the 40d-old 9999 is outside the 30d window
    expect(data.revenue_30d_mist).toBe('2300')
  })

  test('a since-burned sold item resolves to null category (no item doc), still listed', async () => {
    const { data } = await handle_sales_history(P({ seller: SELLER_A }))
    const gone = data.sales.find((s) => s.item_id === SOLD_GONE)
    expect(gone).toMatchObject({
      item_id: SOLD_GONE,
      template_id: null,
      category: null,
      level: null,
      price_mist: '9999',
    })
  })

  test('paginates newest-first via cursor/limit', async () => {
    const { data: p1 } = await handle_sales_history(P({ seller: SELLER_A, limit: '2' }))
    expect(p1.sales.map((s) => s.item_id)).toEqual([ITEM_A, ITEM_B])
    expect(p1.next_cursor).toBe('2')
    const { data: p2 } = await handle_sales_history(P({ seller: SELLER_A, limit: '2', cursor: '2' }))
    expect(p2.sales.map((s) => s.item_id)).toEqual([SOLD_GONE])
    expect(p2.next_cursor).toBeNull()
    // revenue is stable across pages (a window sum, not a page sum)
    expect(p2.revenue_30d_mist).toBe('2300')
  })
})
