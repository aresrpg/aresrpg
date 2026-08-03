// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #2054 — THE READ SEAM TELLS ABSENT FROM FAILED. `sui/read/_object.js` used to `catch { return null }`, so a
// dead transport, an unclassified ledger error and a genuinely empty dynamic field all reached every consumer
// as the same value. That is the shape that let a ~570ms ledger lag render an empty zone over a full one
// (#2030's false void); the instruments-throw law exists for exactly it. These tests drive BOTH directions:
// a failure must surface, and absence must still read as absence.
//
// WIRE PROVENANCE — the two error shapes below are not invented. Both were captured on 2026-08-03 by probing
// `https://fullnode.testnet.sui.io:443` through the exact `grpc_client.core.getObject({ include:{json:true} })`
// transport this seam rides (@mysten/sui 2.x, `client/core.ts::getObject` re-throwing the per-object
// `batchGetObjects` result). Reproduce with two reads:
//   · `0xde…de` (a syntactically valid id that has never existed) →
//       plain Error, `code === undefined`, message `Object 0xdede…de not found`   ← the ledger ANSWERED: absent
//   · the same read against an unresolvable host →
//       RpcError, `code === 'INTERNAL'`, message `Unable to connect. Is the computer able to access the url?`
//                                                                                 ← the CALL failed
// A present object (`0x5`, the system-state singleton) resolves with its json — the positive control that the
// probe was actually talking to a chain.
import { describe, expect, it } from 'bun:test'

import { get_object_json } from '../src/sui/read/_object.js'
import { read_world_inner, world_inner_field_id, WORLD_VERSION } from '../src/sui/read/world_inner.js'
import { get_world } from '../src/game.js'
import { get_zone_state } from '../src/sui/read/zone_spawns.js'

import { IDS, id } from './_onchain_fixtures.js'
import captured_grpc_absence from './fixtures/get_object_absence_error.json' with { type: 'json' }

const WORLD_ID = id('seam:world')
const VERSIONED_ID = id('seam:versioned')

// #2100 CAPTURED-SHAPE FIXTURE — this is the literal serialized JSON from the live probe documented in the
// fixture's `_provenance`; base64 only keeps captured chain evidence out of the shipped-ID census. The decoded
// POJO is thrown AS-IS here, never fed through @mysten/sui's ObjectError constructor (the model this seam
// validates). This pins the unstructured gRPC compatibility arm instead of regenerating its English sentence.
const captured_absence_error = JSON.parse(
  Buffer.from(captured_grpc_absence.error_json_base64, 'base64').toString('utf8'),
)
const CAPTURED_ABSENT_ID = Buffer.from(
  captured_grpc_absence._provenance.request_object_id_base64,
  'base64',
).toString('utf8')

/** A structured @mysten/sui ObjectError-shaped absence whose message deliberately contains no English marker. */
const absent_error = () => ({
  name: 'Error',
  message: 'Objet absent du registre',
  code: 'notFound',
})

/** The captured TRANSPORT failure: the call itself never landed. */
const transport_error = () =>
  Object.assign(new Error('Unable to connect. Is the computer able to access the url?'), {
    name: 'RpcError',
    code: 'INTERNAL',
    methodName: 'BatchGetObjects',
    serviceName: 'sui.rpc.v2.LedgerService',
  })

/** A chain that answers every read with `thrown(objectId)`. */
const chain_that = thrown => ({
  core: {
    getObject: async ({ objectId }) => {
      throw thrown(objectId)
    },
  },
})

const zone_context = grpc_client => ({
  grpc_client,
  network: 'testnet',
  ids: { aresrpg: IDS.aresrpg },
})

describe('#2054 · the seam surfaces FAILURE (the direction that was lying)', () => {
  it('rejects on a transport failure — the old seam handed back null, indistinguishable from an empty chain', async () => {
    const grpc_client = chain_that(transport_error)
    // RED against the pre-fix seam: `expect(await get_object_json(...)).toBeNull()` PASSED — that null is the lie.
    await expect(get_object_json(grpc_client, WORLD_ID)).rejects.toThrow(/is unreadable/)
    await expect(get_object_json(grpc_client, WORLD_ID)).rejects.toThrow(WORLD_ID)
  })

  it('names the transport error as the CAUSE, so the failure is diagnosable at the seam', async () => {
    const error = await get_object_json(chain_that(transport_error), WORLD_ID).catch(e => e)
    expect(error.cause?.code).toBe('INTERNAL')
    expect(error.cause?.name).toBe('RpcError')
  })

  it('fails SHUT on an unclassified ledger error — absence is only ever POSITIVELY identified', async () => {
    const grpc_client = chain_that(() => new Error('internal ledger error while reading object'))
    await expect(get_object_json(grpc_client, WORLD_ID)).rejects.toThrow(/is unreadable/)
  })

  it('fails SHUT when a structured non-absence code happens to carry the old English substring', async () => {
    const error = Object.assign(new Error(`Object ${WORLD_ID} not found`), { code: 'INTERNAL' })
    await expect(get_object_json(chain_that(() => error), WORLD_ID)).rejects.toThrow(/is unreadable/)
  })

  it('fails SHUT on conflicting structured code/status evidence', async () => {
    const error = { name: 'Error', message: 'Objet absent', code: 'notFound', status: 'INTERNAL' }
    await expect(get_object_json(chain_that(() => error), WORLD_ID)).rejects.toThrow(/is unreadable/)
  })

  it('fails SHUT on partial error shapes with a missing or empty required field', async () => {
    await expect(
      get_object_json(chain_that(() => ({ name: 'Error', code: 'notFound' })), WORLD_ID),
    ).rejects.toThrow(/is unreadable/)
    await expect(
      get_object_json(chain_that(() => ({ name: 'Error', message: '', code: 'notFound' })), WORLD_ID),
    ).rejects.toThrow(/is unreadable/)
  })

  it('rejects when the object exists but answers without the json payload the read asked for', async () => {
    const grpc_client = { core: { getObject: async () => ({ object: { version: '7' } }) } }
    await expect(get_object_json(grpc_client, WORLD_ID)).rejects.toThrow(/without a json payload/)
  })

  it('rejects a missing/undefined object field instead of silently inventing absence', async () => {
    await expect(
      get_object_json({ core: { getObject: async () => ({}) } }, WORLD_ID),
    ).rejects.toThrow(/without an object field/)
    await expect(
      get_object_json({ core: { getObject: async () => ({ object: undefined }) } }, WORLD_ID),
    ).rejects.toThrow(/without an object field/)
  })

  it('a failed world read no longer reads as "this world has no payload" (read_world_inner / get_world)', async () => {
    const grpc_client = chain_that(transport_error)
    await expect(read_world_inner(grpc_client, WORLD_ID)).rejects.toThrow(/is unreadable/)
    await expect(get_world({ grpc_client })(WORLD_ID)).rejects.toThrow(/is unreadable/)
  })

  it('a failed zone read no longer reads as "unsearched" — the #2030 false void, at its source', async () => {
    const grpc_client = chain_that(transport_error)
    await expect(get_zone_state(zone_context(grpc_client))(WORLD_ID, 3, 4)).rejects.toThrow(
      /is unreadable/,
    )
  })
})

describe('#2054 · ABSENCE still reads as absence (the direction that must not regress)', () => {
  it('#2100: classifies the SDK ObjectError code before message wording', async () => {
    expect(await get_object_json(chain_that(absent_error), WORLD_ID)).toBeNull()
  })

  it.each(['notExists', 'deleted'])('classifies the SDK ObjectError %s absence code', async code => {
    const error = { name: 'Error', message: 'Message sans marqueur anglais', code }
    expect(await get_object_json(chain_that(() => error), WORLD_ID)).toBeNull()
  })

  it('#2100: keeps the captured plain-gRPC English shape as secondary compatibility only', async () => {
    expect(
      await get_object_json(chain_that(() => captured_absence_error), CAPTURED_ABSENT_ID),
    ).toBeNull()
  })

  it('returns null when the transport resolves with no object at all (the mocked-chain convention)', async () => {
    const grpc_client = { core: { getObject: async () => ({ object: null }) } }
    expect(await get_object_json(grpc_client, WORLD_ID)).toBeNull()
  })

  it('an absent world is still an absent world, never a zeroed one', async () => {
    expect(await read_world_inner(chain_that(absent_error), WORLD_ID)).toBeNull()
    expect(await get_world({ grpc_client: chain_that(absent_error) })(WORLD_ID)).toBeNull()
  })

  it('an absent PAYLOAD field under a present shell is still absence, not a failure', async () => {
    const field_id = world_inner_field_id(VERSIONED_ID, WORLD_VERSION)
    const grpc_client = {
      core: {
        getObject: async ({ objectId }) => {
          if (objectId === WORLD_ID)
            return {
              object: {
                json: { id: WORLD_ID, inner: { id: VERSIONED_ID, version: String(WORLD_VERSION) } },
              },
            }
          if (objectId === field_id) throw absent_error(field_id)
          throw new Error(`unexpected read of ${objectId}`)
        },
      },
    }
    expect(await read_world_inner(grpc_client, WORLD_ID)).toBeNull()
  })

  it('an undiscovered zone (no Zone DF) still reads as UNSEARCHED', async () => {
    expect(await get_zone_state(zone_context(chain_that(absent_error)))(WORLD_ID, 3, 4)).toBeNull()
  })
})

describe('#2054 · the class gate — one seam, no shadow copies', () => {
  it('the SDK defines get_object_json exactly ONCE (items.js used to carry a byte-identical twin)', async () => {
    const { Glob } = await import('bun')
    const root = new URL('../src/', import.meta.url).pathname
    const definitions = []
    for await (const file of new Glob('**/*.js').scan(root)) {
      const source = await Bun.file(root + file).text()
      if (/(?:function|const)\s+get_object_json\b/.test(source)) definitions.push(file)
    }
    expect(definitions).toEqual(['sui/read/_object.js'])
  })
})
