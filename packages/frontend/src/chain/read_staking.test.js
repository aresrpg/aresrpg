// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// read_staking tests.
// get_owned_items: /v1-FIRST (the indexer's owner→kiosk→items join) with a chain-direct kiosk-union
// FALLBACK. The union bag is `::item::Item` LOCKED across ALL the wallet's personal kiosks (every item is
// kiosk-locked — the constitution), NOT an address-owned scan (which finds none). Also pins the on-chain
// `category` → client `item_category` rename (the field the whole bag keys off), the DungeonsModal has-key
// contract for a key in a NON-FIRST kiosk (the stranded-key case), and that `stackable` is derived on BOTH paths.
// Pure injection: get_owned_items takes `sdk` AND the /v1 fetcher (4th arg) — plain mocks drive both; ZERO
// mock.module. The kiosk-union cases inject `V1_DOWN` so they deterministically exercise the FALLBACK.
// v1_character_to_party_row maps exact `/v1/characters?id=` rows to the PartyFrame HP-math subset, with the
// `hp_known` honesty gate for pre-snapshot (null-arm) rows.

import { describe, expect, it } from 'bun:test'
import { ITEM_CATEGORY } from '@aresrpg/sdk/items'

import { get_owned_items, v1_character_to_party_row } from './read_staking.js'
import { character_max_hp, projected_hp } from './read_character.js'

// Force the /v1-outage fallback (the chain-union walk) in a pure, network-free way.
const V1_DOWN = () => Promise.reject(new Error('v1 unavailable'))

const ADDR = '0xowner'
const PKG = '0xa1' // the ::item::Item type origin (normalizeStructTag-padded internally)
const ITEM_TYPE = `${PKG}::item::Item`
const CHAR_TYPE = `${PKG}::character::Character`

// KIOSK_A (cap[0]) holds a sword + a potion; KIOSK_B (the SIBLING, second) holds TWO keys + a character.
// Mirrors a real wallet: 2 keys locked in a non-first kiosk, invisible to the old address scan.
const KIOSK_A = '0xkioskA'
const KIOSK_B = '0xkioskB'
const KIOSK_SHARED = '0xshared' // a NON-personal cap — must be filtered out, never walked

const SWORD = '0xsword'
const POTION = '0xpotion'
const LISTED_SWORD = '0xlisted-sword'
const KEY_1 = '0xkey1'
const KEY_2 = '0xkey2'
const A_CHARACTER = '0xkioskchar' // a Character object sitting in a kiosk — must NOT leak into the item bag

const KIOSK_ITEMS = {
  [KIOSK_A]: [
    { objectId: SWORD, type: ITEM_TYPE },
    { objectId: POTION, type: ITEM_TYPE },
  ],
  [KIOSK_B]: [
    { objectId: KEY_1, type: ITEM_TYPE },
    { objectId: KEY_2, type: ITEM_TYPE },
    { objectId: A_CHARACTER, type: CHAR_TYPE }, // wrong type → filtered
  ],
}

// Flat json each item's getObject returns (on-chain field is `category`, NOT `item_category`).
const ITEM_JSON = {
  [SWORD]: { name: 'Iron Sword', item_type: 'sword_iron', category: 'sword', amount: 1 },
  [POTION]: { name: 'Life Potion', item_type: 'potion_life', category: ITEM_CATEGORY.CONSUMABLE, amount: 5 },
  [KEY_1]: { name: 'Crypt Key', item_type: 'crypt_key', category: ITEM_CATEGORY.KEY, amount: 1 },
  [KEY_2]: { name: 'Crypt Key', item_type: 'crypt_key', category: ITEM_CATEGORY.KEY, amount: 1 },
}

function make_sdk() {
  return {
    kiosk_client: {
      getOwnedKiosks: async () => ({
        kioskOwnerCaps: [
          { kioskId: KIOSK_A, objectId: '0xcapA', isPersonal: true },
          { kioskId: KIOSK_B, objectId: '0xcapB', isPersonal: true },
          { kioskId: KIOSK_SHARED, objectId: '0xcapS', isPersonal: false }, // filtered
        ],
      }),
      getKiosk: async ({ id }) => {
        if (id === KIOSK_SHARED) throw new Error('non-personal kiosk must never be walked')
        return { items: KIOSK_ITEMS[id] ?? [] }
      },
    },
    grpc_client: {
      core: {
        // Batched read (the live fix for the 10s roster timeout): one getObjects per ≤50 ids replaces the
        // per-item getObject fan. REAL gRPC envelope (verified live against testnet 2026-07-11): the PLURAL
        // `core.getObjects` returns { objects: [Object|Error] } where each element is the FLAT object
        // ({ objectId, json, type, … }) — NOT nested under `.object` (only the SINGULAR getObject returns
        // { object }). The old mock encoded the wrong nested shape, so the test passed against buggy code that
        // read `o.object.json` and blanked the bag on-chain (B8). Missing ids come back as an Error element.
        getObjects: async ({ objectIds }) => ({
          objects: objectIds.map((/** @type {string} */ objectId) =>
            ITEM_JSON[objectId] ? { objectId, json: ITEM_JSON[objectId] } : new Error(`object not found: ${objectId}`)
          ),
        }),
      },
    },
  }
}

describe('get_owned_items — chain-direct fallback (kiosk union bag)', () => {
  it('unions Items across ALL personal kiosks and drops non-Item types + non-personal kiosks', async () => {
    const bag = await get_owned_items(make_sdk(), ADDR, PKG, V1_DOWN)
    const ids = bag.map((i) => i.id).sort()
    // sword + potion (kiosk A) + key1 + key2 (kiosk B); the Character is filtered out, the shared kiosk never walked.
    expect(ids).toEqual([SWORD, POTION, KEY_1, KEY_2].sort())
  })

  it('maps on-chain `category` → client `item_category` (the field the whole bag keys off)', async () => {
    const bag = await get_owned_items(make_sdk(), ADDR, PKG, V1_DOWN)
    const key = bag.find((i) => i.id === KEY_1)
    expect(key.item_category).toBe(ITEM_CATEGORY.KEY) // NOT undefined/'' — the old `f.item_category` bug
    expect(key.item_type).toBe('crypt_key')
    expect(bag.find((i) => i.id === SWORD).item_category).toBe('sword')
  })

  it('derives `stackable` from category (consumable/resource only), never a nonexistent item field', async () => {
    const bag = await get_owned_items(make_sdk(), ADDR, PKG, V1_DOWN)
    expect(bag.find((i) => i.id === POTION).stackable).toBe(true) // consumable
    expect(bag.find((i) => i.id === KEY_1).stackable).toBe(false) // key does not stack
  })

  it('DungeonsModal has-key contract: TWO keys locked in a NON-FIRST kiosk are seen (the stranded-kiosk case)', async () => {
    const bag = await get_owned_items(make_sdk(), ADDR, PKG, V1_DOWN)
    // Replicates DungeonsModal.jsx lines 72-73 exactly (the modal reads this same s.sui.items bag, no fetch).
    const key_items = bag.filter((i) => i.item_category === ITEM_CATEGORY.KEY)
    const keys = key_items.reduce((n, i) => n + (i.amount > 1 ? i.amount : 1), 0)
    expect(keys).toBe(2) // > 0 → the modal shows the key row + enter CTA instead of "you need a key"
  })

  it('threads each row’s SOURCE kiosk_id + kiosk_cap_id (the usable-from-any-kiosk fix)', async () => {
    const bag = await get_owned_items(make_sdk(), ADDR, PKG, V1_DOWN)
    // Kiosk A items (cap[0]) — sword + potion.
    expect(bag.find((i) => i.id === SWORD)).toMatchObject({ kiosk_id: KIOSK_A, kiosk_cap_id: '0xcapA' })
    expect(bag.find((i) => i.id === POTION)).toMatchObject({ kiosk_id: KIOSK_A, kiosk_cap_id: '0xcapA' })
    // Kiosk B items (the SIBLING, non-first cap) — both keys. This is the exact row a burn/extract PTB (e.g.
    // dungeon_actions.js activate_run's key leg) must target instead of assuming the character's own kiosk.
    expect(bag.find((i) => i.id === KEY_1)).toMatchObject({ kiosk_id: KIOSK_B, kiosk_cap_id: '0xcapB' })
    expect(bag.find((i) => i.id === KEY_2)).toMatchObject({ kiosk_id: KIOSK_B, kiosk_cap_id: '0xcapB' })
  })
})

describe('get_owned_items — /v1-first path', () => {
  // The /v1 rows already carry the base shape; the client only derives `stackable` on top.
  const V1_ROWS = [
    {
      id: SWORD,
      kiosk_id: KIOSK_A,
      kiosk_cap_id: '0xcapA',
      name: 'Iron Sword',
      item_category: 'sword',
      item_set: '',
      item_type: 'sword_iron',
      level: 0,
      amount: 1,
    },
    {
      id: POTION,
      kiosk_id: KIOSK_A,
      kiosk_cap_id: '0xcapA',
      name: 'Life Potion',
      item_category: ITEM_CATEGORY.CONSUMABLE,
      item_set: '',
      item_type: 'potion_life',
      level: 0,
      amount: 5,
      listed: false,
    },
    {
      id: LISTED_SWORD,
      kiosk_id: KIOSK_A,
      kiosk_cap_id: '0xcapA',
      name: 'Listed Sword',
      item_category: 'sword',
      item_set: '',
      item_type: 'sword_listed',
      level: 0,
      amount: 1,
      listed: true,
    },
  ]

  // An sdk whose chain walk THROWS on any use — proves /v1 short-circuits it entirely (one HTTP call, no walk).
  const exploding_sdk = () => ({
    kiosk_client: {
      getOwnedKiosks: async () => {
        throw new Error('chain walk must not run when /v1 is up')
      },
      getKiosk: async () => {
        throw new Error('chain walk must not run when /v1 is up')
      },
    },
    grpc_client: {
      core: {
        getObjects: async () => {
          throw new Error('chain walk must not run when /v1 is up')
        },
      },
    },
  })

  it('returns only usable /v1 rows (deriving stackable) WITHOUT walking any kiosk', async () => {
    const bag = await get_owned_items(exploding_sdk(), ADDR, PKG, async () => V1_ROWS)
    expect(bag.map((i) => i.id).sort()).toEqual([SWORD, POTION].sort())
    // stackable is derived client-side from item_category on the /v1 path too (not on the wire).
    expect(bag.find((i) => i.id === POTION).stackable).toBe(true) // consumable
    expect(bag.find((i) => i.id === SWORD).stackable).toBe(false) // sword does not stack
    // kiosk_id / kiosk_cap_id threading survives identically (dungeon key-burn + crush depend on it).
    expect(bag.find((i) => i.id === SWORD)).toMatchObject({ kiosk_id: KIOSK_A, kiosk_cap_id: '0xcapA' })
  })

  it('drops a strict listed:true owner row before it can enter the inventory bag', async () => {
    const bag = await get_owned_items(exploding_sdk(), ADDR, PKG, async () => V1_ROWS)

    expect(bag.some((item) => item.id === LISTED_SWORD)).toBe(false)
    expect(bag.some((item) => item.id === SWORD)).toBe(true)
    expect(bag.some((item) => item.id === POTION)).toBe(true)
  })

  it('falls back to the chain-direct kiosk walk when /v1 throws', async () => {
    const bag = await get_owned_items(make_sdk(), ADDR, PKG, async () => {
      throw new Error('v1 down')
    })
    // identical bag to the pure chain-direct cases above (the fallback ran).
    expect(bag.map((i) => i.id).sort()).toEqual([SWORD, POTION, KEY_1, KEY_2].sort())
    expect(bag.find((i) => i.id === KEY_1)).toMatchObject({ kiosk_id: KIOSK_B, kiosk_cap_id: '0xcapB' })
    expect(bag.find((i) => i.id === POTION).stackable).toBe(true)
  })

  it('falls back when /v1 returns a non-array (defensive shape guard)', async () => {
    const bag = await get_owned_items(make_sdk(), ADDR, PKG, async () => null)
    expect(bag.map((i) => i.id).sort()).toEqual([SWORD, POTION, KEY_1, KEY_2].sort())
  })
})

// --- v1_character_to_party_row — exact /v1 character row → the PartyFrame subset --------------------------
// Fixture rows mirror packages/rpc/api/views.js handle_characters (the live envelope's `characters` elements).
// Snapshot-served fields (`experience`/`level` + the projection-lane HP arms `current_hp`/`hp_updated_ms`/
// `gear_vitality`) are NULL until the ares_snapshot pipeline reaches the character — the mapper must flag
// `hp_known: false` then (the plate renders the gap), never default to a fake playable shape.

// A fully-SNAPSHOTTED row (post projection-lane + re-index). experience 0 = a FRESH character (level 1 on the
// shared curve) — deliberately 0 to pin that 0 is DATA, not unknown.
const V1_SNAPSHOTTED = {
  id: '0xchar1',
  owner: ADDR,
  name: 'Nerdok',
  class: 'senshi',
  male: true,
  colors: { color_1: 1, color_2: 2, color_3: 3 },
  level: 1,
  experience: 0,
  kiosk_id: KIOSK_B,
  world: '0xworld',
  position: { x: 1, z: 2 },
  vitality: 10,
  wisdom: 0,
  strength: 0,
  intelligence: 0,
  agility: 0,
  chance: 0,
  available_points: 0,
  current_hp: 30,
  hp_updated_ms: 1_000_000,
  gear_vitality: 5,
  jobs: {},
  equipment: [],
  worn: {},
}
// The SAME character BEFORE the indexer image rebuild/re-index reaches it: every snapshot-served field null.
const V1_PRE_SNAPSHOT = {
  ...V1_SNAPSHOTTED,
  level: null,
  experience: null,
  current_hp: null,
  hp_updated_ms: null,
  gear_vitality: null,
}

describe('v1_character_to_party_row — /v1 row → PartyFrame HP-math subset', () => {
  it('maps a snapshotted row to the exact subset projected_hp/character_max_hp read (hp_known: true)', () => {
    expect(v1_character_to_party_row(V1_SNAPSHOTTED)).toEqual({
      id: '0xchar1',
      name: 'Nerdok',
      classe: 'senshi',
      experience: 0,
      vitality: 10,
      gear_vitality: 5,
      current_hp: 30,
      hp_updated_ms: 1_000_000,
      hp_known: true,
    })
  })

  it('composes with the client §5.4 math (the T76 bar inputs PartyFrame derives)', () => {
    const row = v1_character_to_party_row(V1_SNAPSHOTTED)
    // character_max_hp (read_character.js): senshi base 70 + 5×(level−1) + (vitality + gear_vitality) = 70 + 0 + 15.
    expect(character_max_hp(row)).toBe(85)
    // projected_hp: kernel regen (senshi L1, num 156 ≈ 2 HP/s) — 10s after the stamp → +floor(10_000·156/75_000)=20 → 50.
    expect(projected_hp(row, 1_000_000 + 10_000)).toBe(50)
    // Clock-skew guard: a `now` BEFORE the stamp adds nothing (never underflows).
    expect(projected_hp(row, 999_999)).toBe(30)
  })

  it('0 current_hp (a DEFEATED character) is DATA — hp_known stays true, never mistaken for unknown', () => {
    const row = v1_character_to_party_row({ ...V1_SNAPSHOTTED, current_hp: 0 })
    expect(row.hp_known).toBe(true)
    expect(row.current_hp).toBe(0)
  })

  it('flags hp_known: false on a pre-snapshot row (null arms) — the plate renders the gap, not 100%', () => {
    const row = v1_character_to_party_row(V1_PRE_SNAPSHOT)
    expect(row.hp_known).toBe(false)
    expect(row.name).toBe('Nerdok') // event-sourced name still flows (served before any snapshot)
  })

  it('any SINGLE missing arm is enough to withhold hp_known', () => {
    expect(v1_character_to_party_row({ ...V1_SNAPSHOTTED, gear_vitality: null }).hp_known).toBe(false)
    expect(v1_character_to_party_row({ ...V1_SNAPSHOTTED, hp_updated_ms: null }).hp_known).toBe(false)
    expect(v1_character_to_party_row({ ...V1_SNAPSHOTTED, experience: null }).hp_known).toBe(false)
  })
})
