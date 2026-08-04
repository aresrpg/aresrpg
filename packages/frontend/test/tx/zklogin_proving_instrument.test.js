// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//
// #2192 — the create-character failure players actually hit: Enoki's LAZY zkLogin proving rejects on the first
// personal-message sign, pre-POST, zero gas. One line later the raw rejection is gone, replaced by localized
// toast copy, and that copy is what the error store received: a French sentence that discriminates nothing.
// This drives the REAL sponsored door with a REJECTING sign feature and asserts the instrument reports the
// facts — with a leak-shaped rejection (JWT in the message AND in the body) proving no credential rides along.
import { describe, expect, it, mock, beforeEach, afterEach } from 'bun:test'

import { execute_sponsored_tx } from '../../src/tx/index.ts'
import i18n from '../../src/i18n'

import { ADDR, CHAIN, SPONSOR_URL, make_tx, make_wallet } from './sponsor_door_harness.js'

const JWT =
  'eyJhbGciOiJSUzI1NiIsImtpZCI6ImFiYyJ9.eyJzdWIiOiIxMTIyMzM0NDU1NjY3Nzg4OTkwIn0.QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVphYmNkZWY'

/** The rejection Enoki throws when lazy proving fails — echoing the id_token back at us, as auth errors do. */
const leaky_enoki_rejection = () =>
  Object.assign(new Error(`zkLogin proof request failed for id_token ${JWT}`), {
    name: 'EnokiClientError',
    status: 400,
    response_body: JSON.stringify({
      errors: [{ code: 'zklogin_max_epoch_expired', message: `token ${JWT} is past maxEpoch 812` }],
      proofPoints: { a: ['9'.repeat(77)] },
    }),
  })

/** A zkLogin wallet whose FIRST sign — the lazy proving call — rejects, exactly like the reported sessions. */
const wallet_that_cannot_prove = (rejection) => {
  const wallet = make_wallet(mock(async () => ({})))
  wallet.features['sui:signPersonalMessage'].signPersonalMessage = mock(async () => {
    throw rejection
  })
  return wallet
}

const run = (wallet) =>
  execute_sponsored_tx({ wallet, address: ADDR, transaction: make_tx(), chain: CHAIN, sponsor_url: SPONSOR_URL })

describe('the zkLogin proving instrument (#2192)', () => {
  /** @type {any[][]} */
  let reported = []
  let original_console_error
  let fetch_spy

  beforeEach(() => {
    reported = []
    original_console_error = console.error
    console.error = (...args) => reported.push(args)
    fetch_spy = mock(async () => {
      throw new Error('the sponsor must never be reached when proving fails')
    })
    globalThis.fetch = fetch_spy
  })
  afterEach(() => {
    console.error = original_console_error
  })

  const ares_errors = () => reported.filter(([tag]) => tag === '[ares-error]')

  it('reports the proving rejection as its own machine-readable event, before the toast erases it', async () => {
    await expect(run(wallet_that_cannot_prove(leaky_enoki_rejection()))).rejects.toThrow()

    const [first_event] = ares_errors()
    expect(first_event).toBeDefined()
    const [, error, , , context] = first_event
    expect(error.name).toBe('ZkLoginProvingError')
    expect(context.area).toBe('sponsor')
    expect(context.action).toBe('zklogin-proving')
    expect(context.status).toBe(400)
    expect(context.codes).toEqual(['zklogin_max_epoch_expired']) // the discriminating fact survives
    // the sponsor never saw it: pre-POST, zero gas — the counters that proved the P0 second-account bug
    expect(fetch_spy).not.toHaveBeenCalled()
  })

  it('never lets the id_token or proof material into the reported payload', async () => {
    await expect(run(wallet_that_cannot_prove(leaky_enoki_rejection()))).rejects.toThrow()

    const [first_event] = ares_errors()
    const [, error, , , context] = first_event
    const payload = JSON.stringify({ message: error.message, name: error.name, context })
    expect(payload).not.toContain('eyJ')
    expect(payload).not.toContain(JWT.split('.')[2])
    expect(payload).not.toContain('9'.repeat(77))
    expect(payload).toContain('zklogin_max_epoch_expired') // …while staying diagnosable
  })

  it('the player-facing wrap is not a second event — one failure, one report', async () => {
    const failure = await run(wallet_that_cannot_prove(leaky_enoki_rejection())).catch((error) => error)
    expect(failure.message).not.toContain(JWT)
    expect(failure.__ares_reported).toBe(true) // the toast layer's own report_error no-ops on it
  })

  // The sign wrapper refuses a dead Enoki session rather than letting it open a blocked OAuth popup; the
  // sponsored door must carry that fact to the player, not bury it under "re-sign and retry".
  it('a dead session reaches the player as sign in again, not as retry', async () => {
    const expired = Object.assign(new Error('zkLogin session expired'), { code: 'zklogin_session_expired' })
    const failure = await run(wallet_that_cannot_prove(expired)).catch((error) => error)
    expect(failure.message).toBe(i18n.t('errors.zklogin_session_expired'))
    expect(failure.message).not.toBe(i18n.t('errors.sponsor_zklogin'))
    expect(fetch_spy).not.toHaveBeenCalled()
  })

  it('a player who closes the popup is still not an error — the benign class stays dropped', async () => {
    const rejected = Object.assign(new Error('User rejected the request'), { name: 'EnokiClientError' })
    await expect(run(wallet_that_cannot_prove(rejected))).rejects.toThrow()
    expect(ares_errors()).toHaveLength(0)
  })
})
