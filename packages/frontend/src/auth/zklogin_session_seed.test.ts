// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// RED-FIRST for the testnet P1: a Google-signed-in player creating their first character was told
// "Creating your first character needs a Google sign-in" — the ONE advice that could not help, because the
// four distinct seed-read failures all collapsed into that single string. These tests pin each real failure
// to its OWN cause, so a non-auth failure can never wear the auth toast again.
// Pure module — no wallet, no network, no i18n.
import { describe, expect, test } from 'bun:test'

import { ZKLOGIN_FAILURE_COPY, read_zklogin_seed, type ZkloginSeedDeps } from './zklogin_session_seed'

// A pass-through only: every test injects its own `derive`, so no real chain address is needed here
// (and the chain-id gate rightly refuses hardcoded object ids in source).
const ADDRESS = 'test-connected-zklogin-address'
const JWT = 'header.payload.sig'

// The VERBATIM Enoki refusal body captured from the live salt endpoint on 2026-07-25 (provenance: a
// GET https://api.enoki.mystenlabs.com/v1/zklogin with the production public key and an unusable JWT):
// {"errors":[{"code":"jwt_error","message":"Failed to base64url decode the payload"}]} — HTTP 401.
// The @mysten/enoki client turns that into an EnokiClientError carrying .status/.code, which is exactly
// what the salt fetch rejects with in the browser.
const enoki_401 = () => {
  const error = new Error('Request to Enoki API failed (status: 401)') as Error & {
    status: number
    code: string
    errors: { code: string; message: string }[]
  }
  error.name = 'EnokiClientError'
  error.status = 401
  error.code = 'jwt_error'
  error.errors = [{ code: 'jwt_error', message: 'Failed to base64url decode the payload' }]
  return error
}

const deps = (overrides: Partial<ZkloginSeedDeps> = {}): ZkloginSeedDeps => ({
  get_session: async () => ({ jwt: JWT }),
  address: ADDRESS,
  fetch_salt: async () => '129390038577185583942388216820280642146',
  derive: () => 'derived-seed',
  ...overrides,
})

describe('read_zklogin_seed — every failure keeps its own cause', () => {
  test('the FAST path returns the lazily-generated proof seed without touching Enoki', async () => {
    let salt_calls = 0
    const result = await read_zklogin_seed(
      deps({
        get_session: async () => ({ jwt: JWT, proof: { addressSeed: '4242' } }),
        fetch_salt: async () => {
          salt_calls += 1
          return 'unused'
        },
      })
    )
    expect(result).toEqual({ ok: true, seed: '4242' })
    expect(salt_calls).toBe(0)
  })

  test('the DERIVE path returns the derived seed for a proof-less fresh Google login', async () => {
    const result = await read_zklogin_seed(deps())
    expect(result).toEqual({ ok: true, seed: 'derived-seed' })
  })

  test('a non-Enoki wallet is the ONLY case that asks for a Google sign-in', async () => {
    const result = await read_zklogin_seed(deps({ get_session: null }))
    expect(result).toMatchObject({ ok: false, failure: 'not_zklogin_wallet' })
    expect(ZKLOGIN_FAILURE_COPY.not_zklogin_wallet).toBe('errors.zklogin_required')
  })

  test('REGRESSION: an unreadable Enoki session is a session failure, NOT "needs a Google sign-in"', async () => {
    // The reported shape: the wallet is connected and the address is on screen (zkLogin STATE is plaintext),
    // while the encrypted session decrypts to nothing — Enoki's getSession resolves null rather than throwing.
    const result = await read_zklogin_seed(deps({ get_session: async () => null }))
    expect(result).toMatchObject({ ok: false, failure: 'session_unavailable' })
    expect(ZKLOGIN_FAILURE_COPY.session_unavailable).not.toBe('errors.zklogin_required')
  })

  test('REGRESSION: a session with no JWT is a session failure, NOT "needs a Google sign-in"', async () => {
    const result = await read_zklogin_seed(deps({ get_session: async () => ({}) }))
    expect(result).toMatchObject({ ok: false, failure: 'session_unavailable' })
  })

  test('a rejecting getSession keeps its cause instead of being swallowed', async () => {
    const boom = new Error('idb unavailable')
    const result = await read_zklogin_seed(
      deps({
        get_session: async () => {
          throw boom
        },
      })
    )
    expect(result).toMatchObject({ ok: false, failure: 'session_unavailable', cause: boom })
  })

  test('REGRESSION: a live Enoki 401 jwt_error is a SALT failure, NOT "needs a Google sign-in"', async () => {
    const refusal = enoki_401()
    const result = await read_zklogin_seed(
      deps({
        fetch_salt: async () => {
          throw refusal
        },
      })
    )
    expect(result).toMatchObject({ ok: false, failure: 'salt_unavailable', cause: refusal })
    expect(ZKLOGIN_FAILURE_COPY.salt_unavailable).not.toBe('errors.zklogin_required')
  })

  test('REGRESSION: a refused derivation is an address mismatch, NOT "needs a Google sign-in"', async () => {
    const refusal = new Error(`Derived zkLogin seed does not produce the connected address ${ADDRESS} — refusing`)
    const result = await read_zklogin_seed(
      deps({
        derive: () => {
          throw refusal
        },
      })
    )
    expect(result).toMatchObject({ ok: false, failure: 'address_mismatch', cause: refusal })
    expect(ZKLOGIN_FAILURE_COPY.address_mismatch).not.toBe('errors.zklogin_required')
  })

  test('every failure maps to a DISTINCT message key (no two causes share a toast)', () => {
    const keys = Object.values(ZKLOGIN_FAILURE_COPY)
    expect(new Set(keys).size).toBe(keys.length)
  })
})
