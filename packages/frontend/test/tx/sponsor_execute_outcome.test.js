// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//
// THE LOST RECEIPT. The station SUBMITS a sponsored transaction and waits for finality BEFORE it answers
// /execute, so a failure that loses that answer — the fetch rejects, an ingress answers 502, the body is
// unreadable — cannot tell "never executed" apart from "executed, gas burned, receipt lost". The tx-retry-burn
// law says a possibly-executed transaction is never re-signed on ANY path, so those shapes must BLOCK: no
// self-pay fallback, an honest outcome-unknown refusal instead.
//
// Driven end-to-end on purpose (see sponsor_door_harness.js): the REAL sponsored door runs over a scripted
// wire, so the proof covers the transport → decode → routing chain rather than a hand-tagged error object. The
// assertion is the wallet's own sign door: it must NEVER be reached.
//
//   bun test ./test/tx/sponsor_execute_outcome.test.js
//
// RED BEFORE THE FIX: /execute transport faults produced an untagged `errors.sponsor_unreachable` Error, which
// is not in execute_tx's blocking set — the tx fell through and was signed and submitted a SECOND time
// (the failing run returned a receipt with the self-pay digest).

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

import i18n from '../../src/i18n'
import { reset_expedition_sdk_mock, set_expedition_sdk_mock } from '../../src/test_helpers/expedition_sdk_mock.js'

import {
  ADDR,
  CHAIN,
  SPONSOR_URL,
  calls_to,
  make_tx,
  make_wallet,
  ok_sim,
  refusal_body,
  route_sponsor,
  run_sponsored_first,
} from './sponsor_door_harness.js'

const sim = { current: null }
const grpc = {
  core: {
    simulateTransaction: mock(async () => sim.current),
    executeTransaction: mock(async () => ({ Transaction: { digest: 'X', effects: { status: { success: true } } } })),
  },
}
const get_sdk = async () => ({ grpc_client: grpc })
set_expedition_sdk_mock(get_sdk)

const { execute_tx, execute_sponsored_tx, is_sponsor_outcome_unknown_refusal, SPONSOR_REFUSAL_OUTCOME_UNKNOWN } =
  await import('../../src/tx/index')

const run = (wallet) => run_sponsored_first({ execute_tx, execute_sponsored_tx, wallet })

const real_fetch = globalThis.fetch
beforeEach(() => {
  sim.current = ok_sim()
  set_expedition_sdk_mock(get_sdk)
})
afterEach(() => {
  globalThis.fetch = real_fetch
  grpc.core.simulateTransaction.mockClear()
  reset_expedition_sdk_mock()
})

describe('a LOST /execute receipt blocks — a possibly-executed tx is never re-signed', () => {
  const lost_shapes = {
    'the fetch REJECTS (connection dropped mid-flight)': () => {
      throw new TypeError('Failed to fetch')
    },
    'an ingress answers 502 (the station may still have submitted)': () => ({
      ok: false,
      status: 502,
      text: async () => '<html>502 Bad Gateway</html>',
    }),
    'the answer arrives with an unreadable body': () => ({
      ok: true,
      json: async () => {
        throw new SyntaxError('Unexpected end of JSON input')
      },
    }),
  }
  for (const [name, execute] of Object.entries(lost_shapes))
    test(`${name} → outcome-unknown, the wallet's sign door is NEVER reached`, async () => {
      const sae = mock(async () => ({ digest: 'SELF_PAY_RESIGN' }))
      const spy = route_sponsor({ execute })

      const thrown = await run(make_wallet(sae)).catch((error) => error)

      expect(thrown).toBeInstanceOf(Error)
      expect(is_sponsor_outcome_unknown_refusal(thrown)).toBe(true)
      expect(thrown.sponsor_refusal).toBe(SPONSOR_REFUSAL_OUTCOME_UNKNOWN)
      expect(thrown.message).toBe(i18n.t('errors.sponsor_outcome_unknown'))
      // THE assertions: exactly one submit attempt ever, and the self-pay door never signed the same PTB again.
      expect(calls_to(spy, '/execute')).toHaveLength(1)
      expect(sae).toHaveBeenCalledTimes(0)
      expect(grpc.core.simulateTransaction).toHaveBeenCalledTimes(0) // not even the self-pay dry-run ran
    })

  // The POSITIVE CONTROL. Without it every "never self-paid" assertion above could be green because this
  // harness cannot reach the self-pay door at all. A DECODED 4xx from /execute is the station's own
  // PRE-execution rejection (reservation unknown/expired, tx mismatch) — nothing was charged, so self-paying
  // the same PTB is correct and must still happen.
  test('POSITIVE CONTROL — a decoded 400 from /execute is pre-execution, so self-pay DOES run', async () => {
    const sae = mock(async () => ({ digest: 'SELFPAY' }))
    const spy = route_sponsor({
      execute: () => ({
        ok: false,
        status: 400,
        text: async () => refusal_body('sponsor-reservation-unknown: no such reservation — reserve again'),
      }),
    })

    const receipt = await run(make_wallet(sae))

    expect(receipt.digest).toBe('SELFPAY')
    expect(calls_to(spy, '/execute')).toHaveLength(1)
    expect(sae).toHaveBeenCalledTimes(1) // the harness DOES reach the self-pay door when the outcome is known
  })
})

describe('the sponsored door tags the refusal itself (every caller sees the marker, not just execute_tx)', () => {
  const direct = (wallet) =>
    execute_sponsored_tx({ wallet, address: ADDR, transaction: make_tx(), chain: CHAIN, sponsor_url: SPONSOR_URL })

  test('execute_sponsored_tx throws the tagged outcome-unknown error on a lost receipt', async () => {
    route_sponsor({
      execute: () => {
        throw new TypeError('Failed to fetch')
      },
    })

    const thrown = await direct(make_wallet(mock(async () => ({ digest: 'X' })))).catch((error) => error)

    expect(is_sponsor_outcome_unknown_refusal(thrown)).toBe(true)
  })

  // The /reserve leg is PRE-submit: a transport fault there proves nothing was reserved, signed or executed, so
  // it keeps the ordinary retry-able copy and stays OUT of the blocking set. Same wire fault, different leg,
  // different fact — this is what stops the fix from over-blocking every network hiccup.
  test('the same transport fault on /reserve stays an ordinary unreachable error (nothing was submitted)', async () => {
    globalThis.fetch = mock(async () => {
      throw new TypeError('Failed to fetch')
    })

    const thrown = await direct(make_wallet(mock(async () => ({ digest: 'X' })))).catch((error) => error)

    expect(is_sponsor_outcome_unknown_refusal(thrown)).toBe(false)
    expect(thrown.message).toBe(i18n.t('errors.sponsor_unreachable'))
  })
})
