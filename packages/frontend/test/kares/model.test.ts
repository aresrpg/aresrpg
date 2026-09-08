// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test } from 'bun:test'

import {
  initial_finance,
  parse_amount,
  validate_amount,
  format_amount,
  reduce_finance,
  offering_phase,
  type FinanceSnapshot,
} from '../../src/kares/model.ts'
import { load_app_copy } from '../../src/i18n/copy.ts'
import { LOCALES } from '../../src/i18n/locale.ts'

import { finance_state } from './fixture.ts'

const snapshot: FinanceSnapshot = {
  network: 'testnet',
  address: null,
  clock_ms: 100n,
  combat_pot: { id: '0xcombat', version: '1', balance: 0n, quota: 20_000n, spent: 0n },
  total_supply: 1_000_000_000_000_000n,
  offering: {
    id: 'offering',
    version: '1',
    started: true,
    duration_ms: 100n,
    opens_ms: 100n,
    closes_ms: 200n,
    min_raise: 5n,
    max_raise: 20n,
    total_contributed: 0n,
    accepted: 0n,
    settled: false,
    settled_ms: 0n,
    community_remaining: 110_000_000_000_000n,
    community_claimable: 0n,
    treasury: 'treasury',
    liquidity: 'liquidity',
  },
  pool: {
    id: 'pool',
    version: '1',
    active: false,
    total_staked: 0n,
    active_ms: 0n,
    initial_remaining: 200_000_000_000_000n,
    kares_rewards: 0n,
    sui_rewards: 0n,
    daily_kares: 0n,
    daily_sui: 0n,
  },
  contributions: [],
  positions: [],
}

describe('KARES amount inputs', () => {
  test('preserves exact base units beyond floating point precision', () => {
    expect(parse_amount('9007199.254740993')).toBe(9_007_199_254_740_993n)
    expect(parse_amount('0.000000001')).toBe(1n)
    expect(parse_amount('18446744073.709551615')).toBe(18_446_744_073_709_551_615n)
    expect(format_amount(9_007_199_254_740_993n, 9)).toBe('9,007,199.254740993')
  })
  test('rejects excess precision, exponent notation, negatives, zero and u64 overflow', () => {
    for (const input of ['0', '-1', '1e3', 'NaN', '.5', '0.0000000001', '18446744073.709551616'])
      expect(parse_amount(input)).toBeNull()
  })
})

describe('KARES finance reconciliation', () => {
  test('ignores stale completion after restarting its lifecycle', () => {
    const pending = reduce_finance(initial_finance(), { type: 'request', request: { kind: 'refresh' } })
    const disconnected = reduce_finance(pending, { type: 'resume' })
    expect(
      reduce_finance(disconnected, { type: 'snapshot', balances: null, sequence: pending.sequence, snapshot })
    ).toBe(disconnected)
    expect(disconnected.snapshot).toBeNull()
  })
  test('refuses double submission and retains the certified digest when refresh fails', () => {
    const pending = reduce_finance(finance_state(), {
      type: 'request',
      request: { kind: 'execute', action: { kind: 'contribute', amount: 1n } },
    })
    expect(
      reduce_finance(pending, {
        type: 'request',
        request: { kind: 'execute', action: { kind: 'contribute', amount: 1n } },
      })
    ).toBe(pending)
    const certified = reduce_finance(pending, { type: 'receipt', sequence: pending.sequence, digest: 'certified' })
    const failed = reduce_finance(certified, {
      type: 'failed',
      sequence: pending.sequence,
      error: 'snapshot unavailable',
    })
    expect(failed.digest).toBe('certified')
    expect(failed.error).toBe('snapshot unavailable')
    expect(failed.request).toBeNull()
  })
})

test('offering deadlines do not expose early claims or refunds', () => {
  expect(offering_phase({ ...snapshot, clock_ms: 99n })).toBe('upcoming')
  expect(offering_phase(snapshot)).toBe('open')
  expect(offering_phase({ ...snapshot, clock_ms: 200n })).toBe('refundable')
  const funded = { ...snapshot, offering: { ...snapshot.offering, total_contributed: 30n }, clock_ms: 200n }
  expect(offering_phase(funded)).toBe('successful')
  expect(offering_phase({ ...funded, clock_ms: 300_000_000_000n })).toBe('successful')
  expect(offering_phase({ ...funded, offering: { ...funded.offering, settled: true } })).toBe('successful')
})

test('every KARES string exists in all six locales', async () => {
  const english = (await load_app_copy('en')).kares_page
  for (const { code } of LOCALES) {
    const copy = await load_app_copy(code)
    expect(copy.kares).toBe('Stacking')
    expect(Object.keys(copy.kares_page).sort()).toEqual(Object.keys(english).sort())
    expect(Object.values(copy.kares_page).every((value) => typeof value === 'string' && value.length > 0)).toBe(true)
  }
})

test('amount validation distinguishes malformed input from insufficient balance', () => {
  expect(validate_amount('', 10n)).toEqual({ amount: null, error: null })
  expect(validate_amount('abc', 10n)).toEqual({ amount: null, error: 'amount_invalid' })
  expect(validate_amount('1', 10n)).toEqual({ amount: null, error: 'insufficient' })
  expect(validate_amount('0.000000001', 10n)).toEqual({ amount: 1n, error: null })
})

test('resuming a lifecycle invalidates abandoned reads without replaying a transaction', () => {
  const pending = reduce_finance(finance_state(), {
    type: 'request',
    request: { kind: 'execute', action: { kind: 'stake', amount: 1n } },
  })
  const resumed = reduce_finance(pending, { type: 'resume' })
  expect(resumed.request).toEqual({ kind: 'refresh' })
  expect(resumed.sequence).toBe(pending.sequence + 1)
  expect(reduce_finance(resumed, { type: 'snapshot', balances: null, sequence: pending.sequence, snapshot })).toBe(
    resumed
  )
})

test('a certified payment invalidates old balances and blocks another write when its refresh fails', () => {
  const loaded = finance_state()
  const pending = reduce_finance(loaded, {
    type: 'request',
    request: { kind: 'execute', action: { kind: 'fund_sui', amount: 1n } },
  })
  const certified = reduce_finance(pending, { type: 'receipt', sequence: pending.sequence, digest: 'paid-once' })
  expect(certified.snapshot).toBeNull()
  const failed = reduce_finance(certified, { type: 'failed', sequence: pending.sequence, error: 'read unavailable' })
  expect(failed.digest).toBe('paid-once')
  expect(failed.snapshot).toBeNull()
  expect(
    reduce_finance(failed, { type: 'request', request: { kind: 'execute', action: { kind: 'fund_sui', amount: 1n } } })
  ).toBe(failed)
  const refreshing = reduce_finance(failed, { type: 'request', request: { kind: 'refresh' } })
  expect(refreshing.digest).toBe('paid-once')
})

test('a new payment cannot inherit the previous payment success message', () => {
  const loaded = { ...finance_state(), digest: 'previous-payment' }
  const next = reduce_finance(loaded, {
    type: 'request',
    request: { kind: 'execute', action: { kind: 'stake', amount: 1n } },
  })
  expect(next.digest).toBeNull()
  const failed = reduce_finance(next, { type: 'failed', sequence: next.sequence, error: 'preflight refused' })
  expect(failed.digest).toBeNull()
})
