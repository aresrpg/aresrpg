// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//
// #1862 — THE SPONSORED CREATE PROCEEDS ON THE CERTIFIED RECEIPT.
//
// The station submits and waits for finality BEFORE it answers /execute, so its answer is already proof of
// exactly what the transaction created. The client used to throw all of it away and rebuild a bare
// `{digest, effects:{status}}`, which forced every sponsored caller into a fullnode waitForTransaction plus
// read-layer polling — the structural half of the ≈7s felt character create.
//
// Driven end-to-end over the scripted wire (sponsor_door_harness.js): the REAL sponsored door runs, so the
// proof covers transport → projection → the door callers actually read (`effects_result`), not a hand-built
// object. The two halves land together, so the wire body here is the api half's real answer shape.
//
//   bun test ./test/tx/sponsor_receipt_adoption.test.js
//
// RED BEFORE THE FIX (measured by reverting src/tx/index.ts + src/chain/receipt.ts to HEAD):
//   ✗ effects_result is undefined even when /execute carries objectChanges — the caller must still wait
//
// THE SAD PATH IS THE POINT: a station answer WITHOUT objectChanges must yield NO effects_result, so the
// caller falls back to its honest wait. An empty adoption ("this transaction created nothing") is a lie that
// would silently drop the created character.

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

import { normalize_receipt, find_created } from '../../src/chain/receipt'
import { reset_expedition_sdk_mock, set_expedition_sdk_mock } from '../../src/test_helpers/expedition_sdk_mock.js'

import { ADDR, CHAIN, SPONSOR_URL, make_tx, make_wallet, ok_sim, route_sponsor } from './sponsor_door_harness.js'

const DIGEST = 'ES6c9UyVEbXAZWQXUtzvyxvcCQ2FZ9BVgKPnjLXFto1p'
const CHARACTER = '0x' + '1a'.repeat(32)
const KIOSK = '0x' + '2b'.repeat(32)
const CHARACTER_TYPE = '0xares::character::Character'

const sim = { current: null }
const grpc = {
  core: {
    simulateTransaction: mock(async () => sim.current),
    // THE TRIPWIRE: any read on this door means the sponsored path bought a wait it did not need.
    waitForTransaction: mock(async () => {
      throw new Error('waitForTransaction must never be reached on a certified sponsored receipt')
    }),
  },
}
set_expedition_sdk_mock(async () => ({ grpc_client: grpc }))

const { execute_sponsored_tx } = await import('../../src/tx/index')

/** The api half's real /execute answer: effects + the created/mutated objects WITH their on-chain types. */
const certified_body = ({ objectChanges, events } = {}) => ({
  digest: DIGEST,
  effects: {
    transactionDigest: DIGEST,
    status: { status: 'success' },
    gasUsed: { computationCost: '2000000', storageCost: '1000000', storageRebate: '500000' },
  },
  ...(objectChanges ? { objectChanges } : {}),
  ...(events ? { events } : {}),
})
const CHANGES = [
  { type: 'created', objectId: CHARACTER, objectType: CHARACTER_TYPE, version: '9' },
  { type: 'mutated', objectId: KIOSK, objectType: '0x2::kiosk::Kiosk', version: '12' },
  { type: 'transferred', objectId: '0xdead', objectType: '0x2::coin::Coin', version: '3' },
]
const EVENTS = [{ type: '0xares::character::CharacterCreated', parsedJson: { id: CHARACTER } }]

const run = () =>
  execute_sponsored_tx({
    wallet: make_wallet(mock(async () => ({ digest: 'SELF_PAY' }))),
    address: ADDR,
    transaction: make_tx(),
    chain: CHAIN,
    sponsor_url: SPONSOR_URL,
  })

const real_fetch = globalThis.fetch
beforeEach(() => {
  sim.current = ok_sim()
  set_expedition_sdk_mock(async () => ({ grpc_client: grpc }))
})
afterEach(() => {
  globalThis.fetch = real_fetch
  grpc.core.waitForTransaction.mockClear()
  reset_expedition_sdk_mock()
})

describe('#1862 — a sponsored /execute answer carrying objectChanges is adopted, never re-read', () => {
  test('the created objects come back through the SAME normalize_receipt door the self-pay lane uses', async () => {
    route_sponsor({
      execute: () => ({ ok: true, json: async () => certified_body({ objectChanges: CHANGES, events: EVENTS }) }),
    })

    const receipt = await run()

    expect(receipt.digest).toBe(DIGEST)
    expect(receipt.effects.status.status).toBe('success')
    // THE assertion: the caller can adopt without a single extra read.
    expect(receipt.effects_result).toBeTruthy()
    expect(find_created(receipt.effects_result, '::character::Character')).toBe(CHARACTER)
    expect(grpc.core.waitForTransaction).toHaveBeenCalledTimes(0)

    const normalized = normalize_receipt(receipt.effects_result)
    expect(normalized.effects.status.status).toBe('success')
    expect(normalized.objectChanges).toEqual([
      { type: 'created', objectId: CHARACTER, objectType: CHARACTER_TYPE, version: '9' },
      { type: 'mutated', objectId: KIOSK, objectType: '0x2::kiosk::Kiosk', version: '12' },
    ])
    expect(normalized.events).toEqual([{ type: EVENTS[0].type, parsedJson: EVENTS[0].parsedJson }])
    // Gas rides through untouched — the number a waitForTransaction would have read, not a fabricated zero.
    expect(normalized.gasUsed).toEqual({
      computationCost: '2000000',
      storageCost: '1000000',
      storageRebate: '500000',
    })
  })

  test('SAD PATH — an answer WITHOUT objectChanges yields NO effects_result (the honest wait, never an empty adoption)', async () => {
    route_sponsor({ execute: () => ({ ok: true, json: async () => certified_body() }) })

    const receipt = await run()

    expect(receipt.digest).toBe(DIGEST)
    expect(receipt.effects.status.status).toBe('success')
    expect(receipt.effects_result).toBeUndefined()
  })

  test('SAD PATH — objectChanges present but events missing is an INCOMPLETE proof, not a receipt with no events', async () => {
    route_sponsor({ execute: () => ({ ok: true, json: async () => certified_body({ objectChanges: CHANGES }) }) })

    expect((await run()).effects_result).toBeUndefined()
  })

  test('an EXECUTED FAILURE projects as {FailedTransaction} — the certified receipt never reads as success', async () => {
    const body = certified_body({ objectChanges: [], events: [] })
    body.effects.status = {
      status: 'failure',
      error: 'MoveAbort(MoveLocation { module: Identifier("x") }, 7) in command 0',
    }
    route_sponsor({ execute: () => ({ ok: true, json: async () => body }) })

    const receipt = await run()

    expect(receipt.effects.status.status).toBe('failure')
    expect(normalize_receipt(receipt.effects_result).effects.status.status).toBe('failure')
    expect(find_created(receipt.effects_result, '::character::Character')).toBeNull()
  })
})
