// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The OTHER half of the #796 boot refusal (sponsor.boot_refusal.test.js holds the refusing half): the gate must
// stay narrow. A fail-closed check that also refuses legitimate boots gets switched off by whoever is on call,
// so every permitted combination is pinned here — including the localnet exemption the gold harness rides
// (test/gold/compose.gold.yml runs the sponsor against a throwaway chain and a throwaway pool, bypass ON).
//
//   bun test ./sponsor.boot_allowed.test.js   (no Redis, no station — pure boot-time policy)

import { describe, expect, test } from 'bun:test'

process.env.REDIS_URL = ''
process.env.VITE_NETWORK = 'testnet'
process.env.GAS_STATION_URL = 'http://rpc-gas-pool.test:9527'
process.env.GAS_STATION_AUTH = 'test-bearer'
delete process.env.SPONSOR_DEV_BYPASS_ZKLOGIN
delete process.env.COURIER_DEV_BYPASS_ZKLOGIN

// THE positive control for the whole gate: credentials present, no bypass armed → the real server boots.
const server = await import('./server.mjs')
const S = await import('./sponsor.mjs')

const credentialed = { GAS_STATION_URL: 'http://station:9527', GAS_STATION_AUTH: 'bearer', VITE_NETWORK: 'testnet' }
const refuses = (env) => {
  try {
    S.assert_no_dev_bypass_with_station_credentials(env)
    return false
  } catch {
    return true
  }
}

describe('credentials without a bypass — the ordinary production boot', () => {
  test('the server module evaluates and exposes its router', () => {
    expect(typeof server.api_fetch).toBe('function')
  })
})

describe('the refusal fires on ANY bypass switch, by shape, not by an enumerated list', () => {
  test('the sponsor and the courier switches both arm it (one process, one blast radius)', () => {
    expect(refuses({ ...credentialed, SPONSOR_DEV_BYPASS_ZKLOGIN: '1' })).toBe(true)
    expect(refuses({ ...credentialed, COURIER_DEV_BYPASS_ZKLOGIN: '1' })).toBe(true)
  })

  test('a switch that does not exist yet arms it too (the check reads the NAME SHAPE)', () => {
    expect(refuses({ ...credentialed, SOMETHING_DEV_BYPASS_ANYTHING: '1' })).toBe(true)
  })

  test('a truthy value the consuming code would IGNORE still refuses (intent, not implementation)', () => {
    // sponsor.mjs only honours `=== '1'`, so `true` would not actually bypass anything — but a switch set to
    // `true` on a credentialed process is a misconfiguration either way, and a fail-closed gate says so.
    for (const value of ['1', 'true', 'TRUE', 'yes', 'on', 'anything'])
      expect(refuses({ ...credentialed, SPONSOR_DEV_BYPASS_ZKLOGIN: value })).toBe(true)
  })

  test('an explicitly-off switch does NOT refuse (unset, empty, 0, false, no, off)', () => {
    for (const value of ['', '0', 'false', 'FALSE', 'no', 'off', ' 0 '])
      expect(refuses({ ...credentialed, SPONSOR_DEV_BYPASS_ZKLOGIN: value })).toBe(false)
    expect(refuses({ ...credentialed })).toBe(false)
  })
})

describe('the gate is about CREDENTIALS + NETWORK, not about the switch alone', () => {
  test('a bypass with NO station credentials boots — a keyless dev process spends nothing', () => {
    expect(refuses({ VITE_NETWORK: 'testnet', SPONSOR_DEV_BYPASS_ZKLOGIN: '1' })).toBe(false)
    expect(refuses({ GAS_STATION_URL: 'http://station:9527', SPONSOR_DEV_BYPASS_ZKLOGIN: '1' })).toBe(false)
    expect(refuses({ GAS_STATION_AUTH: 'bearer', SPONSOR_DEV_BYPASS_ZKLOGIN: '1' })).toBe(false)
  })

  test('localnet is exempt — a throwaway chain and a throwaway pool (the gold harness)', () => {
    expect(refuses({ ...credentialed, VITE_NETWORK: 'localnet', SPONSOR_DEV_BYPASS_ZKLOGIN: '1' })).toBe(false)
  })

  test('an UNSET network is treated as testnet, never as localnet (fail-closed default)', () => {
    const { VITE_NETWORK: _network, ...no_network } = credentialed
    expect(refuses({ ...no_network, SPONSOR_DEV_BYPASS_ZKLOGIN: '1' })).toBe(true)
  })

  test('mainnet is not special-cased into an exemption either', () => {
    expect(refuses({ ...credentialed, VITE_NETWORK: 'mainnet', SPONSOR_DEV_BYPASS_ZKLOGIN: '1' })).toBe(true)
  })
})
