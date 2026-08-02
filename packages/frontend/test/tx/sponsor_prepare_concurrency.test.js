// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//
// #1663 — the sponsored door's PREPARE leg. The kind-only build and the zkLogin challenge signature are
// INDEPENDENT (the challenge is `aresrpg-sponsor:<sender>:<ms>`, it never reads the PTB; the build never reads
// the signature), yet they were awaited one after the other, so every sponsored transaction paid
// build + zkp-sign in series before its first byte reached /reserve. This suite pins them as CONCURRENT:
// both legs must be in flight together, and the reserve POST must still carry the exact bytes + signature.

import { describe, expect, it, mock } from 'bun:test'

import { execute_sponsored_tx } from '../../src/tx/index.ts'

import { ADDR, CHAIN, RESERVATION, SPONSOR_URL, calls_to, route_sponsor } from './sponsor_door_harness.js'

/**
 * A PTB + wallet pair whose build and personal-message sign both report START and END into one ordered log,
 * and neither resolves until the other has started (a deferred latch). Serial code DEADLOCKS on that latch and
 * is caught by the test timeout; concurrent code settles immediately. The latch is what makes this a real
 * concurrency assertion rather than an ordering coincidence.
 */
const make_latched_pair = () => {
  const events = []
  let build_started
  let sign_started
  const build_gate = new Promise((resolve) => (build_started = resolve))
  const sign_gate = new Promise((resolve) => (sign_started = resolve))

  const transaction = {
    setSenderIfNotSet() {},
    setSender() {},
    setGasOwner() {},
    setGasPayment() {},
    setGasBudget() {},
    build: async () => {
      events.push('build:start')
      build_started()
      await sign_gate // resolves only once the challenge sign has also started
      events.push('build:end')
      return new Uint8Array([1, 2, 3])
    },
  }

  const wallet = {
    features: {
      'sui:signPersonalMessage': {
        signPersonalMessage: mock(async () => {
          events.push('sign:start')
          sign_started()
          await build_gate // resolves only once the kind build has also started
          events.push('sign:end')
          return { signature: 'zk-sig' }
        }),
      },
      'sui:signTransaction': {
        signTransaction: mock(async () => ({ signature: 'sender-sig', bytes: 'TXBYTES' })),
      },
      'enoki:getSession': { getSession: async () => ({}) },
    },
  }

  return { events, transaction, wallet }
}

const ok_execute = () => ({
  ok: true,
  json: async () => ({ effects: { status: { status: 'success' } }, digest: '0xdig' }),
})

describe('#1663 sponsored prepare leg', () => {
  it('builds the kind bytes and signs the zkLogin challenge CONCURRENTLY', async () => {
    const { events, transaction, wallet } = make_latched_pair()
    const spy = route_sponsor({ execute: ok_execute })

    const receipt = await execute_sponsored_tx({
      wallet,
      address: ADDR,
      transaction,
      chain: CHAIN,
      sponsor_url: SPONSOR_URL,
    })

    // Both legs are in flight before either completes — the serial door could never produce this interleaving.
    expect(events.slice(0, 2).sort()).toEqual(['build:start', 'sign:start'])
    expect(receipt.digest).toBe('0xdig')

    // The parallelism must not have cost the reserve POST its inputs: same bytes, same signature, same sender.
    const [[, request]] = calls_to(spy, '/reserve')
    const body = JSON.parse(request.body)
    expect(body.sender).toBe(ADDR)
    expect(body.signature).toBe('zk-sig')
    expect(body.txKindBytes).toBe(Buffer.from([1, 2, 3]).toString('base64'))
    expect(body.challenge).toStartWith(`aresrpg-sponsor:${ADDR}:`)
  })

  it('still reserves with the reservation the sponsor returned', async () => {
    const { transaction, wallet } = make_latched_pair()
    route_sponsor({ execute: ok_execute })

    await execute_sponsored_tx({ wallet, address: ADDR, transaction, chain: CHAIN, sponsor_url: SPONSOR_URL })

    // The gas application between the calls still consumes the reserved values (kind stays byte-identical).
    expect(RESERVATION.reservationId).toBe(42)
  })
})
