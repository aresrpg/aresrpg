// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { readFileSync } from 'node:fs'

import { expect, test } from 'bun:test'
import { basis_points, marketplace_royalty_bps } from '@aresrpg/immutable'

import { ROYALTY_FLOOR_MIST, buyer_total } from '../src/marketplace.ts'

// Captured from mainnet on 2026-11-19: the `royalty_rule::Rule` config of both transfer policies.
// item_policy      0x355d1d4fcec4dbe78f07d8571810cab9ba9337998e90d91cfad86e02ec39d10f
// character_policy 0x3a2485ba7a08f314e308e29bb09016d6393c6f27d36b7367b67062ebbd2c6f3b
// The code said 10,000,000 MIST while the chain held 1,000,000: every price shown for a listing under
// 0.1 SUI was too high, and the bot refused cheap purchases that were inside its budget.
const LIVE_ROYALTY_RULE = { amount_bp: 1000, min_amount: '1000000' } as const

test('the royalty the SDK predicts is the one the live transfer policies charge', () => {
  expect(ROYALTY_FLOOR_MIST).toBe(BigInt(LIVE_ROYALTY_RULE.min_amount))
  expect(marketplace_royalty_bps).toBe(LIVE_ROYALTY_RULE.amount_bp)
  expect(basis_points).toBe(10_000)
})

test('a cheap listing pays the floor, and a dear one pays the percentage', () => {
  // 0.002 SUI: 10% is 0.0002, under the 0.001 floor.
  expect(buyer_total(2_000_000n)).toBe(3_000_000n)
  // Exactly where the percentage meets the floor.
  expect(buyer_total(10_000_000n)).toBe(11_000_000n)
  // 1 SUI: 10% is 0.1 SUI.
  expect(buyer_total(1_000_000_000n)).toBe(1_100_000_000n)
})

test('the indexer keeps the same floor for its revenue analytics', () => {
  const source = readFileSync(new URL('../../indexer/src/analytics.rs', import.meta.url), 'utf8')
  const floor = /pub const ROYALTY_FLOOR_MIST: u64 = ([0-9_]+);/.exec(source)?.[1]
  expect(floor?.replaceAll('_', '')).toBe(String(ROYALTY_FLOOR_MIST))
})
