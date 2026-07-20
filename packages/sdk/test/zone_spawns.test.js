import { describe, expect, it } from 'bun:test'
import { deriveDynamicFieldID } from '@mysten/sui/utils'

import {
  zone_key_bytes,
  zone_group_root_key_bytes,
  decode_zone_state,
  decode_zone_group_commitment,
  get_zone_group_commitment,
} from '../src/sui/read/zone_spawns.js'
import { sdk_ids_from_release } from '../src/deployment/aresrpg.js'

import { IDS, id } from './_onchain_fixtures.js'

describe('zone_key_bytes', () => {
  it('serializes ZoneKey { zx, zy } as two LE u32 in declaration order', () => {
    expect([...zone_key_bytes(1, 2)]).toEqual([1, 0, 0, 0, 2, 0, 0, 0])
    expect([...zone_key_bytes(0x01020304, 0)]).toEqual([4, 3, 2, 1, 0, 0, 0, 0])
    expect([...zone_group_root_key_bytes(1, 2)]).toEqual([
      1, 0, 0, 0, 2, 0, 0, 0,
    ])
  })
})

describe('decode_zone_state (search-cost rework: seed + bitmaps, never rows)', () => {
  it('decodes the new Zone DF shape; seed survives as a STRING (u64 > 2^53)', () => {
    expect(
      decode_zone_state({
        discovered_at_ms: '1751980000000',
        seed: '18446744073709551615', // u64::MAX — Number would corrupt it
        mob_bitmap: [1, 0],
        res_bitmap: [],
      }),
    ).toEqual({
      discovered_at_ms: 1751980000000,
      seed: '18446744073709551615',
      mob_bitmap: [1, 0],
      res_bitmap: [],
    })
  })

  it('normalises base64-encoded byte vectors (the gRPC json byte encoding)', () => {
    const b64 = Buffer.from([5, 128]).toString('base64')
    expect(
      decode_zone_state({
        discovered_at_ms: 1,
        seed: '7',
        mob_bitmap: b64,
        res_bitmap: null,
      }),
    ).toEqual({
      discovered_at_ms: 1,
      seed: '7',
      mob_bitmap: [5, 128],
      res_bitmap: [],
    })
  })

  it('fresh-search shape: empty bitmaps (nothing consumed) — the cost invariant', () => {
    const state = decode_zone_state({ discovered_at_ms: 2000, seed: '42' })
    expect(state.mob_bitmap).toEqual([])
    expect(state.res_bitmap).toEqual([])
  })
})

describe('decode_zone_group_commitment', () => {
  it('normalises the adjacent root bytes and count used by local proof verification', () => {
    expect(
      decode_zone_group_commitment({
        root: Buffer.from([1, 2, 3]).toString('base64'),
        count: '3',
      }),
    ).toEqual({ root: [1, 2, 3], count: 3 })
  })

  it('derives the root field with its immutable introducing package id', async () => {
    const world_id = id('world')
    const root_origin = id('root')
    const requested = []
    const grpc_client = {
      core: {
        getObject: async ({ objectId }) => {
          requested.push(objectId)
          return { object: { json: { value: { root: [1], count: '1' } } } }
        },
      },
    }
    expect(
      sdk_ids_from_release({
        type_origins: { zone_group_root: root_origin },
      }).ZONE_GROUP_ROOT_PACKAGE_ID,
    ).toBe(root_origin)
    await get_zone_group_commitment({
      grpc_client,
      network: 'testnet',
      ids: {
        aresrpg: {
          ...IDS.aresrpg,
          ZONE_GROUP_ROOT_PACKAGE_ID: root_origin,
        },
      },
    })(world_id, 7, 9)
    expect(requested).toEqual([
      deriveDynamicFieldID(
        world_id,
        `${root_origin}::zones::ZoneGroupRootKey`,
        zone_group_root_key_bytes(7, 9),
      ),
    ])
  })
})
