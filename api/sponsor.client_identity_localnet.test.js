// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// THE LOCALNET ARM of the rate-limit identity (sponsor.client_identity.test.js owns the production one). With
// no edge in front there is no stamped header to trust, and refusing every request would take the whole gold
// loop down (test/gold/compose.gold.yml runs this image with VITE_NETWORK=localnet, reached directly over the
// compose network). There the socket peer IS the caller — one throwaway process, no proxy to launder it — so it
// stands as the identity, and this file is what keeps that arm from rotting into a 503-everything outage.
//
//   bun test api/sponsor.client_identity_localnet.test.js   (no Redis, no station, no fullnode)
//
// Own process on purpose: the network polarity resolves at module load.

import { describe, expect, mock, test } from 'bun:test'

process.env.VITE_NETWORK = 'localnet'
process.env.GAS_STATION_URL = 'http://rpc-gas-pool.test:9527'
process.env.GAS_STATION_AUTH = 'test-bearer'

const real_state = await import('./sponsor_state.mjs')
let rate_limit_keys = []
mock.module('./sponsor_state.mjs', () => ({
  ...real_state,
  shared_store_ready: async () => true,
  rate_limited: async (ip) => {
    rate_limit_keys.push(ip)
    return false
  },
}))

const S = await import('./sponsor.mjs')

const PEER = '172.18.0.7' // the caller's own address on the compose network

describe('LOCALNET — the socket peer is the identity, because nothing in front could have laundered it', () => {
  test('the Bun adapter keys on the peer Bun.serve reports, and serves the request', async () => {
    const response = await S.sponsor_fetch(
      new Request('http://sponsor.test/api/sponsor', { method: 'POST', body: '{}' }),
      { requestIP: () => ({ address: PEER }) }
    )
    expect(response.status).toBe(410) // served, not refused — the gold loop stays reachable
    expect(rate_limit_keys).toEqual([PEER])
  })

  test('a stamped header still WINS where one exists — the carve-out widens nothing', () => {
    expect(S.client_identity({ read_header: () => '203.0.113.9', peer: PEER })).toBe('203.0.113.9')
  })

  test('no header and no peer is still unverifiable — the fallback is a real address or nothing', () => {
    expect(S.client_identity({ read_header: () => undefined, peer: undefined })).toBeNull()
  })
})
