// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'
import { KARES_ALLOCATION, KARES_UNIT } from '@aresrpg/sdk/kares-economics'
import { countdown_parts } from '@aresrpg/frontend/finance'

import { finance_snapshot } from '../../frontend/test/kares/fixture.ts'
import { offering_preview, subscription_ratio } from '../src/offering_model.ts'

const funding = (amount: bigint) => {
  const snapshot = finance_snapshot()
  return { ...snapshot, offering: { ...snapshot.offering, total_contributed: amount } }
}

test('maximum u64 deposits keep allocations and refunds exact without floating point money', () => {
  const maximum = (1n << 64n) - 1n
  const snapshot = funding(maximum)
  const preview = offering_preview({
    ...snapshot,
    contributions: [
      { id: 'large', version: '1', amount: maximum - 1n },
      { id: 'dust', version: '1', amount: 1n },
    ],
  })
  expect(preview.accepted).toBe(20n * KARES_UNIT)
  expect(preview.refund).toBe(maximum - preview.accepted - 1n)
  expect(preview.tokens).toBe(KARES_ALLOCATION.offering - 1n)
  expect(preview.refund + preview.net_contribution).toBe(maximum)
  expect(preview.progress).toBe(100)
})

test('quotes remain unavailable below minimum and appear exactly at the minimum', () => {
  for (const deposited of [0n, 1n, 5n * KARES_UNIT - 1n]) {
    const preview = offering_preview(funding(deposited))
    expect(preview.allocation_ready).toBe(false)
    expect(preview.price).toBeNull()
    expect(preview.launch_market_cap).toBeNull()
    expect(preview.tokens).toBe(0n)
  }
  const minimum = offering_preview(funding(5n * KARES_UNIT))
  expect(minimum.minimum_met).toBe(true)
  expect(minimum.price).toBe(12_500n)
  expect(minimum.tokens).toBe(KARES_ALLOCATION.offering)
  expect(minimum.progress).toBe(25)
  expect(minimum.minimum_marker).toBe(25)
})

test('the cap fixes accepted proceeds and price while more deposits reduce proportional shares', () => {
  const cap = offering_preview(funding(20n * KARES_UNIT))
  const oversubscribed = offering_preview(funding(30n * KARES_UNIT))
  expect(cap.oversubscribed).toBe(false)
  expect(oversubscribed.oversubscribed).toBe(true)
  expect(cap.accepted).toBe(20n * KARES_UNIT)
  expect(oversubscribed.accepted).toBe(cap.accepted)
  expect(oversubscribed.price).toBe(cap.price)
  expect(cap.launch_market_cap).toBe(29_500_000_000n)
  expect(oversubscribed.launch_market_cap).toBe(cap.launch_market_cap)
  expect(oversubscribed.tokens).toBeLessThan(cap.tokens)
  expect(oversubscribed.contribution).toBe(5n * KARES_UNIT)
  expect(oversubscribed.refund + oversubscribed.net_contribution).toBe(oversubscribed.contribution)
  expect(oversubscribed.progress).toBe(100)
  expect(subscription_ratio(oversubscribed.subscription_hundredths)).toBe('1.50×')
})

test('preview sums each position floor exactly instead of overpromising an aggregate claim', () => {
  const snapshot = funding(6n)
  const preview = offering_preview({
    ...snapshot,
    offering: { ...snapshot.offering, min_raise: 1n, max_raise: 2n },
    contributions: [
      { id: 'one', version: '1', amount: 1n },
      { id: 'two', version: '1', amount: 1n },
    ],
  })
  expect(preview.tokens).toBe(2n * (KARES_ALLOCATION.offering / 6n))
  expect(preview.tokens).toBeLessThan((2n * KARES_ALLOCATION.offering) / 6n)
  expect(preview.refund).toBe(0n)
})

test('below-minimum sales offer full refunds indefinitely with no token quote', () => {
  for (const snapshot of [
    { ...funding(4n * KARES_UNIT), clock_ms: 200n },
    { ...funding(4n * KARES_UNIT), clock_ms: 300_000_000_000n },
  ]) {
    const preview = offering_preview(snapshot)
    expect(preview.phase).toBe('refundable')
    expect(preview.refund).toBe(preview.contribution)
    expect(preview.net_contribution).toBe(0n)
    expect(preview.tokens).toBe(0n)
    expect(preview.price).toBeNull()
    expect(preview.launch_market_cap).toBeNull()
  }
})

test('deadline countdown clamps at zero and never invents additional time', () => {
  expect(countdown_parts(93_784_999n)).toEqual({ days: '1', hours: '02', minutes: '03', seconds: '04' })
  expect(countdown_parts(0n)).toEqual({ days: '0', hours: '00', minutes: '00', seconds: '00' })
  expect(countdown_parts(-1n)).toEqual(countdown_parts(0n))
})

test('successful sale price and allocation are final at closing even before proceeds move', () => {
  for (const clock_ms of [200n, 300_000_000_000n]) {
    const preview = offering_preview({ ...funding(30n * KARES_UNIT), clock_ms })
    expect(preview.phase).toBe('successful')
    expect(preview.price_status).toBe('final')
    expect(preview.tokens).toBeGreaterThan(0n)
    expect(preview.refund).toBeLessThan(preview.contribution)
  }
})
