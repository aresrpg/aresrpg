// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// THE WRAPPED WORLD (#1289): `World { id: UID, inner: Versioned }` keeps every world FACT in a `WorldInner`
// held as `Field<u64, WorldInner>` on the Versioned's OWN UID, keyed by the version. A reader that parses the
// SHELL finds none of those fields and hands back a fully ZEROED world — non-null, so the client caches it and
// overworld spawns / world dials silently vanish. These tests drive the reader against the REAL serialization.
//
// WIRE PROVENANCE (captured from LIVE testnet 2026-07-27 via `grpc.core.getObject include:{json:true}`, the
// exact transport `get_object_json` rides — see the two probes below; nothing here is a guessed shape):
//   · a NESTED struct carrying a UID renders its UID as a BARE hex string —
//     PetFeedConfig 0xcc84a9550765531117f197e4ea849020ad84c68d9a1704071424cb704cca6578
//     → { "foods": { "id": "0x74baafdc…", "size": "0" }, "id": "0xcc84a955…" }
//     so `World.inner: Versioned { id, version }` renders as { id: "0x…", version: "1" }.
//   · a u64-KEYED dynamic field renders as { id, name, value } and `deriveDynamicFieldID(parent, 'u64', …)`
//     resolves it on chain — SuiSystemState 0x5 (version 2) derived
//     0x5b890eaf2abcfa2ab90b77b8e6f3d5d8609586c3e583baf3dccd5af17edf48d1 = its live
//     `Field<u64, SuiSystemStateInnerV2>`, whose json.name was "2" and json.value the inner's fields.
import { describe, test, expect } from 'bun:test'
import { bcs } from '@mysten/sui/bcs'
import { deriveDynamicFieldID } from '@mysten/sui/utils'

import { get_world } from '../src/game.js'
import { read_world_inner, WORLD_VERSION } from '../src/sui/read/world_inner.js'

import { id } from './_onchain_fixtures.js'

// ── The WorldInner BCS layout, mirrored FIELD-FOR-FIELD from packages/move/aresrpg/sources/world.move ──
// Declaration order IS the serialization order, so this file is diffable line-by-line against the Move source
// (a hand-written json mock proves only that the mock agrees with itself).
const ID = bcs.Address
const resource_entry = bcs.struct('ResourceEntry', {
  template_id: ID,
  rate_bp: bcs.u16(),
  min_qty: bcs.u16(),
  max_qty: bcs.u16(),
  job: bcs.u8(),
  tier: bcs.u8(),
})
const mob_entry = bcs.struct('MobEntry', {
  template_id: ID,
  rate_bp: bcs.u16(),
  min_group: bcs.u16(),
  max_group: bcs.u16(),
})
const dungeon_room = bcs.struct('DungeonRoom', { mobs: bcs.vector(ID) })
const vec_map = (key, value) =>
  bcs.struct('VecMap', {
    contents: bcs.vector(bcs.struct('Entry', { key, value })),
  })
const world_inner_bcs = bcs.struct('WorldInner', {
  seed: bcs.u64(),
  biome: bcs.string(),
  required_level: bcs.u16(),
  bounds_x: bcs.u32(),
  bounds_z: bcs.u32(),
  zone_size: bcs.u32(),
  zone_ttl_ms: bcs.u64(),
  speed_budget: bcs.u64(),
  spawn_zone_x: bcs.u32(),
  spawn_zone_z: bcs.u32(),
  protector_bp: bcs.u64(),
  min_groups: bcs.u16(),
  max_groups: bcs.u16(),
  min_nodes: bcs.u16(),
  max_nodes: bcs.u16(),
  dungeon_key_template: bcs.option(ID),
  resources: bcs.vector(resource_entry),
  mobs: bcs.vector(mob_entry),
  dungeon_rooms: bcs.vector(dungeon_room),
  spawn_nonce: bcs.u64(),
  rare_links: vec_map(ID, ID),
  mob_levels: bcs.vector(bcs.u16()),
  protectors: vec_map(ID, ID),
  boss_mask: bcs.vector(bcs.u16()),
})

const WORLD_ID = id('w0')
const VERSIONED_ID = id('versioned0')

const A_WORLD = {
  seed: 42n,
  biome: 'glacial',
  required_level: 10,
  bounds_x: 4096,
  bounds_z: 4096,
  zone_size: 64,
  zone_ttl_ms: 3_600_000n,
  speed_budget: 850n,
  spawn_zone_x: 3,
  spawn_zone_z: 4,
  protector_bp: 250n,
  min_groups: 2,
  max_groups: 5,
  min_nodes: 1,
  max_nodes: 6,
  dungeon_key_template: id('dk0'),
  resources: [
    {
      template_id: id('res:ore'),
      rate_bp: 7000,
      min_qty: 1,
      max_qty: 3,
      job: 2,
      tier: 4,
    },
  ],
  mobs: [
    { template_id: id('mob:low'), rate_bp: 8000, min_group: 2, max_group: 3 },
    { template_id: id('mob:high'), rate_bp: 6000, min_group: 1, max_group: 4 },
  ],
  dungeon_rooms: [
    { mobs: [id('mob:low'), id('mob:low')] },
    { mobs: [id('mob:high')] },
  ],
  spawn_nonce: 7n,
  rare_links: { contents: [{ key: id('res:ore'), value: id('res:gold') }] },
  mob_levels: [3, 12], // PARALLEL to `mobs` (#1290) — inline now, no MobLevelKey dynamic fields
  protectors: { contents: [] },
  boss_mask: [1], // row 1 is a boss row — inline now, no BossMaskKey dynamic field
}

/** The exact json the transport hands back for the inner, produced by a real BCS round-trip of the Move layout. */
const INNER_JSON = world_inner_bcs.parse(
  world_inner_bcs.serialize(A_WORLD).toBytes(),
)

/** The derived address of `Field<u64, WorldInner>` — the ONE object that holds a wrapped world's state. */
const inner_field_id = (versioned_id, version) =>
  deriveDynamicFieldID(
    versioned_id,
    'u64',
    bcs.u64().serialize(version).toBytes(),
  )

/**
 * A chain that serves the WRAPPED world and NOTHING else: any id but the shell and the correctly-derived inner
 * field reads as absent. A reader that derives the wrong address therefore fails the test instead of quietly
 * falling back to the shell.
 */
const wrapped_chain = ({
  version = WORLD_VERSION,
  inner_version = version,
  inner_json = INNER_JSON,
} = {}) => {
  const field_id = inner_field_id(VERSIONED_ID, inner_version)
  const objects = {
    [WORLD_ID]: {
      json: { id: WORLD_ID, inner: { id: VERSIONED_ID, version: String(version) } },
    },
    [field_id]: {
      json: { id: field_id, name: String(inner_version), value: inner_json },
    },
  }
  const reads = []
  return {
    reads,
    grpc_client: {
      network: 'testnet',
      core: {
        getObject: async ({ objectId }) => {
          reads.push(objectId)
          return { object: objects[objectId] ?? null }
        },
      },
    },
  }
}

describe('read_world_inner — the wrapped payload beneath the Versioned UID', () => {
  test('resolves the Field<u64, WorldInner> and returns the world state', async () => {
    const { grpc_client, reads } = wrapped_chain()
    const inner = await read_world_inner(grpc_client, WORLD_ID)
    expect(inner.seed).toBe(INNER_JSON.seed)
    expect(inner.biome).toBe('glacial')
    expect(inner.mobs).toHaveLength(2)
    expect(inner.dungeon_rooms).toHaveLength(2)
    expect(inner.id).toBe(WORLD_ID) // the shell's id stays the world's identity
    // exactly two reads: the shell, then the DERIVED inner field (no dynamic-field listing walk)
    expect(reads).toEqual([WORLD_ID, inner_field_id(VERSIONED_ID, WORLD_VERSION)])
  })

  test('fails SHUT when the inner field is unreadable — never a zeroed world', async () => {
    const grpc_client = {
      core: {
        getObject: async ({ objectId }) => ({
          object:
            objectId === WORLD_ID
              ? {
                  json: {
                    id: WORLD_ID,
                    inner: { id: VERSIONED_ID, version: '1' },
                  },
                }
              : null, // the inner field cannot be read
        }),
      },
    }
    expect(await read_world_inner(grpc_client, WORLD_ID)).toBeNull()
  })

  test('fails SHUT on a payload version this package does not speak', async () => {
    const { grpc_client } = wrapped_chain({ version: WORLD_VERSION + 1 })
    expect(await read_world_inner(grpc_client, WORLD_ID)).toBeNull()
  })

  test('returns null when the world itself is absent', async () => {
    const grpc_client = { core: { getObject: async () => ({ object: null }) } }
    expect(await read_world_inner(grpc_client, WORLD_ID)).toBeNull()
  })
})

describe('get_world — decodes the wrapped world (#1289)', () => {
  test('returns null when the object is unreadable', async () => {
    const grpc_client = { core: { getObject: async () => ({ object: null }) } }
    expect(await get_world({ grpc_client })(WORLD_ID)).toBeNull()
  })

  test('reads the dials, tables and INLINE levels/boss mask off the inner', async () => {
    const { grpc_client } = wrapped_chain()
    const world = await get_world({ grpc_client, network: 'testnet' })(WORLD_ID)
    expect(world.id).toBe(WORLD_ID)
    expect(world.seed).toBe(42n)
    expect(world.biome).toBe('glacial')
    expect(world.required_level).toBe(10)
    expect(world.bounds_x).toBe(4096)
    expect(world.zone_size).toBe(64)
    expect(world.zone_ttl_ms).toBe(3_600_000n)
    expect(world.speed_budget).toBe(850n)
    expect(world.protector_bp).toBe(250n)
    expect(world.max_groups).toBe(5)
    expect(world.dungeon_key_template).toBe(id('dk0'))
    // the spawn tables the zone derivation joins against
    expect(world.mobs.map(m => m.template_id)).toEqual([
      id('mob:low'),
      id('mob:high'),
    ])
    expect(world.mobs.map(m => m.rate_bp)).toEqual([8000, 6000])
    // levels are PARALLEL to the mob table now — one field read, no per-row dynamic field
    expect(world.mobs.map(m => m.level)).toEqual([3, 12])
    expect(world.boss_mask).toEqual([1])
    expect(world.resources[0].job).toBe(2)
    expect(world.resources[0].max_qty).toBe(3)
  })

  test('a wrapped world whose inner is unreadable reads NULL, never a cacheable zeroed world', async () => {
    // THE BUG (#1315 review finding 2): parsing the shell yields a non-null world with seed 0n, no mobs and no
    // resources. The client caches that, and every overworld spawn + world dial silently disappears.
    const grpc_client = {
      core: {
        getObject: async ({ objectId }) => ({
          object:
            objectId === WORLD_ID
              ? {
                  json: {
                    id: WORLD_ID,
                    inner: { id: VERSIONED_ID, version: '1' },
                  },
                }
              : null,
        }),
      },
    }
    expect(await get_world({ grpc_client, network: 'testnet' })(WORLD_ID)).toBeNull()
  })
})
