// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// RED-FIRST (#1310): the IP window is a coarse anti-drain rail, not a per-player identity boundary. Six
// players behind one household/party NAT each need five turns in the ten-minute window before that shared
// rail bites; the existing per-address window and 1 SUI/day ledger remain the player-scoped teeth.
import { expect, test } from 'bun:test'

process.env.REDIS_URL = ''
delete process.env.SPONSOR_RL_MAX

const { rate_limited } = await import('../sponsor_state.mjs')

const party_size = 6
const requests_per_player = 5

test('a six-player party sharing one NAT gets five sponsored turns each', async () => {
  const shared_ip = '203.0.113.10'
  for (let player = 0; player < party_size; player += 1)
    for (let request = 0; request < requests_per_player; request += 1) expect(await rate_limited(shared_ip)).toBe(false)

  expect(await rate_limited(shared_ip)).toBe(true)
})
