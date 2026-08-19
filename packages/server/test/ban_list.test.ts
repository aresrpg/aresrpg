// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { BANNABLE_REASONS, create_ban_list } from '../src/ban_list.ts'

test('a banned address stays out for the ttl and expires back in — no permanent state', () => {
  let clock = 0
  const bans = create_ban_list({ ttl_ms: 600_000, now: () => clock })

  bans.ban('0xhacker')
  expect(bans.is_banned('0xhacker')).toBeTrue()
  expect(bans.is_banned('0xinnocent')).toBeFalse()
  clock = 599_999
  expect(bans.is_banned('0xhacker')).toBeTrue()
  clock = 600_000
  expect(bans.is_banned('0xhacker')).toBeFalse()
})

test('the LRU cap evicts the oldest offender, and a repeat offense refreshes recency', () => {
  let clock = 0
  const bans = create_ban_list({ ttl_ms: 600_000, capacity: 2, now: () => clock })

  bans.ban('0xa')
  clock = 1
  bans.ban('0xb')
  clock = 2
  bans.ban('0xa') // repeat — 0xa becomes the newest, 0xb is now the oldest
  clock = 3
  bans.ban('0xc') // over capacity — evicts 0xb
  expect(bans.is_banned('0xb')).toBeFalse()
  expect(bans.is_banned('0xa')).toBeTrue()
  expect(bans.is_banned('0xc')).toBeTrue()
})

test('lifecycle closes never earn a cool-off — only protocol violations do', () => {
  expect(BANNABLE_REASONS.has('SPEED')).toBeTrue()
  expect(BANNABLE_REASONS.has('RATE_LIMIT')).toBeTrue()
  expect(BANNABLE_REASONS.has('REPLACED')).toBeFalse()
  expect(BANNABLE_REASONS.has('ALREADY_CONNECTED')).toBeFalse()
})
