// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// BOOT REFUSAL (#796) — a development bypass switch may not share a process with the gas-station credentials.
// api/server.mjs runs the sponsor's routes in ONE process; each `*_DEV_BYPASS_*` switch disarms an
// identity check on the container that also holds the station bearer, and nothing asserted them unset. The
// process now refuses to boot instead of serving money with an auth rail switched off.
//
//   bun test ./sponsor.boot_refusal.test.js   (no Redis, no station — the throw is at module EVALUATION time)
//
// Own process on purpose: the refusal fires while the module graph is being evaluated, so it can only be
// observed once, on the first import. The permitted combinations live in sponsor.boot_allowed.test.js.

import { describe, expect, test } from 'bun:test'

process.env.REDIS_URL = ''
process.env.VITE_NETWORK = 'testnet' // a real network — localnet is the throwaway-chain exemption
process.env.GAS_STATION_URL = 'http://rpc-gas-pool.test:9527'
process.env.GAS_STATION_AUTH = 'test-bearer' // the credential that spends real gas
process.env.SPONSOR_DEV_BYPASS_ZKLOGIN = '1' // the switch that turns identity verification off

describe('the api process refuses to boot when a dev bypass shares it with the station credentials', () => {
  test('importing the whole server rejects, naming the armed switch', async () => {
    const error = await import('./server.mjs').then(
      () => null,
      (rejection) => rejection
    )
    expect(error).not.toBeNull()
    expect(error.message).toMatch(/sponsor-misconfig/)
    expect(error.message).toMatch(/SPONSOR_DEV_BYPASS_ZKLOGIN/)
    expect(error.message).toMatch(/refusing to boot/)
  })
})
