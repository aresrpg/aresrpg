// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import { parse_client_packet } from '../src/packets.ts'

test('market price requests carry one bounded item identity and can stop observation', () => {
  for (const observation of [null, { item_type: 'quartz', id: 1 }]) {
    const packet = { type: 'packet/market_prices_observe' as const, observation }
    expect(parse_client_packet(JSON.stringify(packet))).toEqual(packet)
  }
  for (const observation of [
    undefined,
    [],
    {},
    { item_type: 'x'.repeat(129), id: 1 },
    { item_type: '*', id: 1 },
    { item_type: 'quartz', id: -1 },
    { item_type: 'quartz', id: 1.5 },
    { item_type: 'quartz', id: 1e20 },
    { item_type: 'quartz', id: 1, arbitrary: true },
  ]) {
    expect(() => parse_client_packet(JSON.stringify({ type: 'packet/market_prices_observe', observation }))).toThrow()
  }
})
