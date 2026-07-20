import { describe, expect, test } from 'bun:test'

import { wallet_connect_enabled } from './wallet_connect_gate'

// #73 ACCEPTANCE — the wallet-connect visibility gate resolves from the build-time deployment
// environment, NOT from CSS. The one non-negotiable: a production (v* release) build must NOT enable the
// option; preview + local builds must. Asserted on the pure gate so it holds regardless of any styling.
describe('wallet_connect_enabled — build-time gate', () => {
  test('a Vercel production deployment NEVER enables the wallet-connect option (#73 acceptance)', () => {
    expect(wallet_connect_enabled('production')).toBe(false)
  })

  test('a Vercel preview deployment enables it (zkLogin cannot run on preview URLs — the whole point)', () => {
    expect(wallet_connect_enabled('preview')).toBe(true)
  })

  test('a local build (no VERCEL_ENV → empty string) enables it', () => {
    expect(wallet_connect_enabled('')).toBe(true)
  })

  test('a Vercel development environment enables it', () => {
    expect(wallet_connect_enabled('development')).toBe(true)
  })

  test("only the exact 'production' string hides it — any other value shows it", () => {
    expect(wallet_connect_enabled('prod')).toBe(true)
    expect(wallet_connect_enabled('Production')).toBe(true)
    expect(wallet_connect_enabled('staging')).toBe(true)
  })
})
