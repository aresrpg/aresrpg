// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Anti-drain cap rendering (constitution, 2026-07-10) — the station's config MUST carry the
// 0.2 SUI/day global cap + the 0.1 SUI/request ceiling BY DEFAULT (a bare `docker compose --profile gas up`
// is constitution-compliant; raising a cap is a deliberate env override, never an accident).
// Run targeted: `bun test generate-config.test.js` (NEVER a bare `bun test` in packages/rpc).
//
// The suiprivkey1… tests below shell out to the `sui` CLI (`keytool generate` + `keytool convert`)
// to mint REAL throwaway test vectors instead of importing @mysten/sui's SDK encoder: this
// directory has no package.json/node_modules of its own and @mysten/sui does not resolve from
// here (confirmed empirically — see generate-config.mjs's vendored-decode comment), so the CLI —
// already a hard dependency of generate-keypair.mjs in this same directory — is the available
// ground truth. It also cross-checks our decoder against Sui's own Rust encoder rather than only
// against itself. Every minted key is a fresh, unfunded throwaway, discarded at test end.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, test } from 'bun:test'

import { render_config } from './generate-config.mjs'

// SUI_FULLNODE_URL has NO default (provider law — see generate-config.mjs and #1421), so every
// render fixture must carry one; this value is a test string, never an endpoint anyone dials.
const BASE = {
  GAS_POOL_KEYPAIR: 'dGVzdC1rZXktbmV2ZXItcmVhbA==',
  SUI_FULLNODE_URL: 'https://json-rpc.example.invalid',
}

/** Mint a fresh throwaway keypair via `sui keytool` and return its base64 + bech32 twins. */
function mint_suiprivkey(scheme) {
  const dir = mkdtempSync(join(tmpdir(), 'ares-gas-pool-test-'))
  try {
    execFileSync('sui', ['keytool', 'generate', scheme, '--json'], { cwd: dir, encoding: 'utf8' })
    const keyfile = readdirSync(dir).find((f) => f.endsWith('.key'))
    const base64 = readFileSync(join(dir, keyfile), 'utf8').trim()
    const converted = JSON.parse(execFileSync('sui', ['keytool', 'convert', base64, '--json'], { encoding: 'utf8' }))
    return { base64, bech32: converted.bech32WithFlag }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

describe('render_config — anti-drain caps (the constitution)', () => {
  test('defaults: 0.2 SUI/day global cap + 0.1 SUI/request ceiling (GAS_CEILING_SUI parity)', () => {
    const yaml = render_config(BASE)
    expect(yaml).toContain('daily-gas-usage-cap: 200000000')
    expect(yaml).toContain('max-sui-per-request: 100000000')
  })

  test('env overrides are honored (deliberate scale-up path)', () => {
    const yaml = render_config({
      ...BASE,
      GAS_POOL_DAILY_CAP: '500000000',
      GAS_POOL_MAX_PER_REQUEST: '50000000',
    })
    expect(yaml).toContain('daily-gas-usage-cap: 500000000')
    expect(yaml).toContain('max-sui-per-request: 50000000')
  })

  test('the sponsor key rides the config and a missing key REFUSES (never a silent keyless render)', () => {
    expect(render_config(BASE)).toContain(`keypair: "${BASE.GAS_POOL_KEYPAIR}"`)
    expect(() => render_config({})).toThrow(/GAS_POOL_KEYPAIR/)
  })

  test('infra defaults survive untouched (redis, port, coin-init)', () => {
    const yaml = render_config(BASE)
    expect(yaml).toContain('redis_url: "redis://127.0.0.1:6379"')
    expect(yaml).toContain('rpc-port: 9527')
    expect(yaml).toContain('target-init-balance: 100000000')
  })

  // PROVIDER LAW (#1421): the fullnode endpoint is deploy-time input, never a baked default — a
  // default here is either a forbidden provider or the official host's dead JSON-RPC route.
  test('the fullnode endpoint rides env and a missing one REFUSES (no defaulted provider)', () => {
    expect(render_config(BASE)).toContain('fullnode-url: "https://json-rpc.example.invalid"')
    expect(() => render_config({ GAS_POOL_KEYPAIR: BASE.GAS_POOL_KEYPAIR })).toThrow(/SUI_FULLNODE_URL/)
  })
})

describe('GAS_POOL_KEYPAIR — suiprivkey1… bech32 acceptance (DX improvement, 2026-07-13)', () => {
  test('a real suiprivkey1… wallet export renders IDENTICAL YAML to its base64 twin', () => {
    const { base64, bech32 } = mint_suiprivkey('ed25519')
    expect(bech32.startsWith('suiprivkey1')).toBe(true)

    const from_bech32 = render_config({ ...BASE, GAS_POOL_KEYPAIR: bech32 })
    const from_base64 = render_config({ ...BASE, GAS_POOL_KEYPAIR: base64 })
    expect(from_bech32).toBe(from_base64)
    expect(from_bech32).toContain(`keypair: "${base64}"`)
  })

  test('raw base64 keeps working unchanged (backward compat — no "suiprivkey1" prefix, no decode)', () => {
    const { base64 } = mint_suiprivkey('ed25519')
    expect(render_config({ ...BASE, GAS_POOL_KEYPAIR: base64 })).toContain(`keypair: "${base64}"`)
  })

  test('a non-ed25519 suiprivkey1… (secp256k1) throws loud — never silently accepted', () => {
    const { bech32 } = mint_suiprivkey('secp256k1')
    expect(() => render_config({ ...BASE, GAS_POOL_KEYPAIR: bech32 })).toThrow(/signature-scheme flag/)
  })

  test('a corrupted checksum on an otherwise-real key throws (proves the checksum is actually checked)', () => {
    const { bech32 } = mint_suiprivkey('ed25519')
    const flipped = bech32.at(-1) === 'l' ? 'a' : 'l' // any other valid bech32 char breaks the checksum
    const corrupted = bech32.slice(0, -1) + flipped
    expect(() => render_config({ ...BASE, GAS_POOL_KEYPAIR: corrupted })).toThrow(/checksum/)
  })

  test('garbage/malformed bech32 throws loud, never a silent bad render', () => {
    const { bech32: seed } = mint_suiprivkey('ed25519')
    const cases = {
      // bech32 charset never contains '1', so an extra one makes IT the true separator
      // (last-'1'-wins) — the effective hrp then contains a chunk of the data and mismatches.
      'stray extra "1" shifts the hrp (bech32 last-separator rule)':
        'suiprivkey1' + seed.slice(11, 20) + '1' + seed.slice(20),
      // 'b' is excluded from the bech32 charset ("qpzry9x8gf2tvdw0s3jn54khce6mua7l")
      'invalid bech32 character': seed.slice(0, 15) + 'b' + seed.slice(16),
      'mixed-case string': seed.slice(0, 12).toUpperCase() + seed.slice(12),
      'data part too short for a checksum': 'suiprivkey1qz',
      'empty string': '',
    }
    for (const [why, value] of Object.entries(cases)) {
      expect(() => render_config({ ...BASE, GAS_POOL_KEYPAIR: value }), why).toThrow()
    }
  })

  test('decode errors NEVER leak key material in the message — format/length verdicts only', () => {
    const { bech32 } = mint_suiprivkey('secp256k1')
    let thrown = null
    try {
      render_config({ ...BASE, GAS_POOL_KEYPAIR: bech32 })
    } catch (err) {
      thrown = err
    }
    expect(thrown).not.toBeNull()
    expect(thrown.message).not.toContain(bech32.slice(11)) // the data part after "suiprivkey1"
    expect(thrown.message).toMatch(/signature-scheme flag/)
  })
})
