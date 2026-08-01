// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//
// THE TWO MONEY REFUSALS BRANCH ON A CODE, NOT ON ENGLISH. `self-pay-required` decides whether the player's
// own SUI is spent; `daily-cap` decides whether a ≤0.2-SUI wallet's remaining dust is spent past the free
// promise. Both used to be recovered by matching the @server's own diagnostic prose (/daily free gameplay/i),
// so a copy edit on the @server would silently drop the marker and hand the refusal to the generic arm —
// which self-pays. Each refusal now carries a machine `reason`; the text match survives only for an @server
// image that predates it, and is logged as drift when it fires.
//
// Driven through the REAL sponsored door (sponsor_door_harness.js) so the wire body, the decoder and the
// routing decision are all in the proof — the assertion is whether the player's wallet got asked to sign.
//
//   bun test ./test/tx/sponsor_refusal_codes.test.js
//
// RED BEFORE THE FIX: with the diagnostic reworded, both ALTERED-ENGLISH cases fell through to the generic
// "Sponsor request failed (400)" arm — the daily-cap case self-paid the dust it exists to protect.

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
const grpc = { core: { simulateTransaction: mock(async () => sim.current) } }
const get_sdk = async () => ({ grpc_client: grpc })
set_expedition_sdk_mock(get_sdk)

const {
  execute_tx,
  execute_sponsored_tx,
  SPONSOR_REFUSAL_DAILY_CAP,
  SPONSOR_REFUSAL_SELF_PAY,
  is_sponsor_daily_cap_refusal,
  is_sponsor_self_pay_refusal,
} = await import('../../src/tx/index')
const { get_log_buffer, _reset_log_for_test } = await import('../../src/core/log.js')

// Deliberately NOTHING like the shipped copy — this is the "the @server reworded its diagnostic" scenario.
const ALTERED_DAILY = 'quota exhausted for this address until the next UTC rollover'
const ALTERED_SELF_PAY = 'wallet holds enough to cover this itself'
// The shipped strings the retired regexes matched, for the un-rolled-@server fallback arm.
const LEGACY_DAILY = 'daily free gameplay limit reached — transactions now require your own gas until tomorrow'
const LEGACY_SELF_PAY = 'self-pay-required: balance exceeds 0.2 SUI — sign with your own gas'

const refuse_reserve = (error, reason) =>
  route_sponsor({
    reserve: () => ({ ok: false, status: 400, text: async () => refusal_body(error, reason) }),
    execute: () => {
      throw new Error('/execute must never be reached on a reserve refusal')
    },
  })
const run = (wallet) => run_sponsored_first({ execute_tx, execute_sponsored_tx, wallet })

const real_fetch = globalThis.fetch
beforeEach(() => {
  sim.current = ok_sim()
  set_expedition_sdk_mock(get_sdk)
  _reset_log_for_test()
})
afterEach(() => {
  globalThis.fetch = real_fetch
  grpc.core.simulateTransaction.mockClear()
  reset_expedition_sdk_mock()
})

describe('DAILY CAP — the block holds when the @server rewords its diagnostic', () => {
  test('altered English + reason "daily-cap" → still BLOCKS, the ≤0.2 wallet is never asked to sign', async () => {
    const sae = mock(async () => ({ digest: 'SELF_PAY_DUST' }))
    const spy = refuse_reserve(ALTERED_DAILY, SPONSOR_REFUSAL_DAILY_CAP)

    const thrown = await run(make_wallet(sae)).catch((error) => error)

    expect(is_sponsor_daily_cap_refusal(thrown)).toBe(true)
    expect(thrown.message).toBe(i18n.t('errors.sponsor_daily_limit')) // the clean cap copy, not the raw 400
    expect(sae).toHaveBeenCalledTimes(0) // THE assertion: no spend past the free promise
    expect(calls_to(spy, '/execute')).toHaveLength(0)
  })

  test('an @server that predates the reason (no field, shipped English) still blocks — and logs the drift', async () => {
    const sae = mock(async () => ({ digest: 'SELF_PAY_DUST' }))
    refuse_reserve(LEGACY_DAILY, null)

    const thrown = await run(make_wallet(sae)).catch((error) => error)

    expect(is_sponsor_daily_cap_refusal(thrown)).toBe(true)
    expect(sae).toHaveBeenCalledTimes(0)
    expect(get_log_buffer().filter((entry) => entry.message.includes('recovered from server TEXT'))).toHaveLength(1)
  })

  // THE CONTROL that proves the code — not the prose — is what carries the two tests above: strip the reason
  // AND reword the diagnostic and the refusal is genuinely unrecognisable, exactly as it was before the fix.
  test('CONTROL — no reason AND altered English is unrecognisable (the generic arm, which self-pays)', async () => {
    const sae = mock(async () => ({ digest: 'SELF_PAY_DUST' }))
    refuse_reserve(ALTERED_DAILY, null)

    const receipt = await run(make_wallet(sae))

    expect(is_sponsor_daily_cap_refusal(receipt)).toBe(false)
    expect(receipt.digest).toBe('SELF_PAY_DUST') // the pre-fix behaviour for BOTH altered cases
    expect(sae).toHaveBeenCalledTimes(1)
  })
})

describe('SELF-PAY REQUIRED — the funded-wallet re-route holds when the @server rewords its diagnostic', () => {
  test('altered English + reason "self-pay-required" → still the SILENT self-pay re-route', async () => {
    const sae = mock(async () => ({ digest: 'SELFPAY' }))
    refuse_reserve(ALTERED_SELF_PAY, SPONSOR_REFUSAL_SELF_PAY)

    const receipt = await run(make_wallet(sae))

    expect(receipt.digest).toBe('SELFPAY')
    expect(sae).toHaveBeenCalledTimes(1)
  })

  test('the marker itself survives the rewording (callers branch on it, e.g. auto-join)', async () => {
    refuse_reserve(ALTERED_SELF_PAY, SPONSOR_REFUSAL_SELF_PAY)

    const thrown = await execute_sponsored_tx({
      wallet: make_wallet(mock(async () => ({ digest: 'X' }))),
      address: ADDR,
      transaction: make_tx(),
      chain: CHAIN,
      sponsor_url: SPONSOR_URL,
    }).catch((error) => error)

    expect(is_sponsor_self_pay_refusal(thrown)).toBe(true)
    expect(thrown.message).toBe(i18n.t('errors.sponsor_self_pay'))
  })

  // A ROLLED @server is authoritative: when it sends a different reason, its own prose may not override it.
  test('a reason that is NOT self-pay wins over prose that still looks like one', async () => {
    const sae = mock(async () => ({ digest: 'SELFPAY' }))
    refuse_reserve(`${LEGACY_SELF_PAY} (but really the cap)`, SPONSOR_REFUSAL_DAILY_CAP)

    const thrown = await run(make_wallet(sae)).catch((error) => error)

    expect(is_sponsor_daily_cap_refusal(thrown)).toBe(true)
    expect(is_sponsor_self_pay_refusal(thrown)).toBe(false)
    expect(sae).toHaveBeenCalledTimes(0)
  })
})

// ── THE @SERVER'S OWN RAILS ARE DOWN (503 on the reserve leg) ──────────────────────────────────────────
// The sponsor refuses outright when it cannot enforce what it promises: no shared anti-drain store to count
// against, or a request whose client identity no edge vouched for. Both are pre-station — nothing reserved,
// nothing signed — and both are the player's "the sponsor is unavailable" moment, so both must arrive as the
// LOCALIZED unavailable copy. Before the decoder learned the class they fell through to the raw arm and put the
// @server's English diagnostic in front of a player in six locales.
describe('a sponsor that refuses because its OWN rails are down reads as unavailable, never as raw English', () => {
  const refuse_unavailable = (error, reason) =>
    route_sponsor({
      reserve: () => ({ ok: false, status: 503, text: async () => refusal_body(error, reason) }),
      execute: () => {
        throw new Error('/execute must never be reached on a reserve refusal')
      },
    })
  const direct = () =>
    execute_sponsored_tx({
      wallet: make_wallet(mock(async () => ({ digest: 'X' }))),
      address: ADDR,
      transaction: make_tx(),
      chain: CHAIN,
      sponsor_url: SPONSOR_URL,
    })

  const rails = {
    'no shared anti-drain store to count against': [
      'sponsor-unavailable: the shared anti-drain store is unreachable, so per-player limits cannot be enforced — refusing to sponsor (fail-closed)',
      'shared-store-unavailable',
    ],
    'no client identity the edge vouched for': [
      'sponsor-unavailable: this request carries no client identity the edge vouched for (cf-connecting-ip) — refusing to sponsor rather than bound a player against a caller-chosen value (fail-closed)',
      'untrusted-client-identity',
    ],
  }

  for (const [name, [error, reason]] of Object.entries(rails))
    test(`${name} → the localized unavailable copy, and /execute is never reached`, async () => {
      const spy = refuse_unavailable(error, reason)

      const thrown = await direct().catch((caught) => caught)

      expect(thrown.message).toBe(i18n.t('errors.sponsor_unreachable'))
      expect(thrown.message).not.toContain('sponsor-unavailable') // never the server's own English
      expect(calls_to(spy, '/execute')).toHaveLength(0)
    })
})
