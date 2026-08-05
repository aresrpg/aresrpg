// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #2155 — N NAMESPACED FIELDS, ONE ROUND TRIP. A namespaced dynamic field's object id is derived LOCALLY
// (`deriveDynamicFieldID` over parent + NsKey bytes), so a caller that wants N of them knows all N ids before it
// speaks to the chain. @mysten/sui defines `getObject` as `getObjects({objectIds:[id]})`, which means N singular
// reads are N `BatchGetObjects` calls — measured on live testnet 2026-08-05: one engage compose spent 21 of its
// 26 chain round trips inside `read_spell_state` reading one character's 21 spell fields.
//
// These tests pin the COUNT, which is the fact that travels: the wall clock is a property of whichever transport
// the caller happens to run on (bun multiplexes 21 reads over one h2 connection in ~70ms; a browser cannot), the
// round-trip count is not. RED against the pre-fix seam: `read_spell_state` issued 1 + N calls.
import { describe, expect, it } from 'bun:test'

import { read_namespaced_field, read_namespaced_fields, ITEMS_NS } from '../src/sui/read/items.js'

import { IDS, id } from './_onchain_fixtures.js'

const CHARACTER = id('2155:character')
const KEY_TYPE = `${IDS.aresrpg.PACKAGE_ID}::character_link::SpellLevelKey`

const context = (grpc_client) => ({ grpc_client, network: 'testnet', ids: { aresrpg: IDS.aresrpg } })

/** A chain that records every batch it is asked for and answers each id with `{ value: <index+2> }`. */
const counting_chain = () => {
  const calls = []
  return {
    calls,
    core: {
      getObjects: async ({ objectIds }) => {
        calls.push(objectIds)
        return { objects: objectIds.map((_, index) => ({ json: { value: String(index + 2) } })) }
      },
      getObject: async ({ objectId }) => {
        calls.push([objectId])
        return { object: { json: { value: '2' } } }
      },
    },
  }
}

const spell_fields = (count) =>
  Array.from({ length: count }, (_, index) => ({
    object_id: CHARACTER,
    namespace: ITEMS_NS.CHARACTER_WORLD,
    key_type: KEY_TYPE,
    key_bytes: Uint8Array.from({ length: 32 }, () => index + 1),
  }))

describe('#2155 · read_namespaced_fields batches locally-derived field ids', () => {
  it('reads 21 fields in ONE round trip (the pre-fix seam took 21)', async () => {
    const chain = counting_chain()
    const values = await read_namespaced_fields(context(chain))(spell_fields(21))

    expect(chain.calls.length).toBe(1)
    expect(chain.calls[0].length).toBe(21)
    expect(values.length).toBe(21)
    expect(values[0]).toBe('2')
    expect(values[20]).toBe('22')
  })

  it('derives a DISTINCT id per field and keeps the caller order', async () => {
    const chain = counting_chain()
    await read_namespaced_fields(context(chain))(spell_fields(5))
    const [ids] = chain.calls
    expect(new Set(ids).size).toBe(5)
  })

  it('spends no round trip at all on an empty field list', async () => {
    const chain = counting_chain()
    expect(await read_namespaced_fields(context(chain))([])).toEqual([])
    expect(chain.calls.length).toBe(0)
  })

  it('reads a genuinely ABSENT field as null, never as a failure', async () => {
    const absent = {
      calls: [],
      core: {
        getObjects: async ({ objectIds }) => ({
          objects: objectIds.map((object_id) => new Error(`Object ${object_id} not found`)),
        }),
      },
    }
    expect(await read_namespaced_fields(context(absent))(spell_fields(3))).toEqual([null, null, null])
  })

  it('THROWS when the batch read itself fails — a dead transport is never absence (#2054)', async () => {
    const dead = {
      core: {
        getObjects: async () => {
          throw Object.assign(new Error('Unable to connect.'), { name: 'RpcError', code: 'INTERNAL' })
        },
      },
    }
    await expect(read_namespaced_fields(context(dead))(spell_fields(4))).rejects.toThrow(/batch read of 4 objects/)
  })

  it('keeps the singular door reading exactly one field (same fact, one home)', async () => {
    const chain = counting_chain()
    const value = await read_namespaced_field(context(chain))(spell_fields(1)[0])
    expect(value).toBe('2')
    expect(chain.calls.length).toBe(1)
    expect(chain.calls[0].length).toBe(1)
  })
})
