// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Console-hygiene regression (2026-07-21): a preview/production build with no VITE_RPC_URL set was
// defaulting the read-API base to http://localhost:3000 regardless of dev vs built, spamming
// ERR_CONNECTION_REFUSED in the live preview console. derive_rpc_url is the pure "override always wins,
// else the caller's fallback, trailing slash stripped" seam (env.ts RPC_URL is the ONLY deployment seam per
// rpc/client.ts's header). The dev-vs-prod fallback SELECTION itself is a literal `import.meta.env.DEV`
// ternary at the RPC_URL call site (not exercised here — it's a one-line Vite-eliminable constant, and
// packages/frontend/scripts/assert_clean_bundle.mjs is the stronger oracle: it greps the REAL built bundle
// and fails if 'localhost:3000' ships). The two fallback values below are exactly what that ternary
// produces for dev / built respectively.
import { describe, expect, test } from 'bun:test'

import { derive_rpc_url, STUN_URL } from './env'

const DEV_FALLBACK = 'http://localhost:3000'
const BUILT_FALLBACK = 'https://rpc.aresrpg.world'

describe('derive_rpc_url', () => {
  test('dev server, no override → local api default port', () => {
    expect(derive_rpc_url(undefined, DEV_FALLBACK)).toBe(DEV_FALLBACK)
  })

  test('THE REGRESSION: built bundle (preview or production), no override → the live testnet read-API, never localhost', () => {
    expect(derive_rpc_url(undefined, BUILT_FALLBACK)).toBe(BUILT_FALLBACK)
  })

  test('explicit VITE_RPC_URL always wins over the dev fallback (trailing slash stripped)', () => {
    expect(derive_rpc_url('https://custom.example.com/', DEV_FALLBACK)).toBe('https://custom.example.com')
  })

  test('explicit VITE_RPC_URL always wins over the built fallback (trailing slash stripped)', () => {
    expect(derive_rpc_url('https://custom.example.com/', BUILT_FALLBACK)).toBe('https://custom.example.com')
  })

  test('empty-string VITE_RPC_URL is treated as unset (falls back, matches the `||` default semantics)', () => {
    expect(derive_rpc_url('', BUILT_FALLBACK)).toBe(BUILT_FALLBACK)
  })
})

describe('STUN_URL', () => {
  test('THE DEFAULT: STUN does not use an aresrpg.world domain', () => {
    const host = new URL(STUN_URL.replace(/^stuns?:/, 'http://')).hostname
    expect(host === 'aresrpg.world' || host.endsWith('.aresrpg.world')).toBe(false)
  })
})
