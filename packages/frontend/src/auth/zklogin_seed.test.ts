// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// P0 create fix — proves the zkLogin seed DERIVE path (used when the Enoki session has no lazy proof yet):
// (1) determinism — the (salt, sub, aud) vector always yields the SAME seed (frozen constant, computed once
// from @mysten/sui/zklogin's own genAddressSeed and pinned here as the regression anchor); (2) the MANDATORY
// address guard — a derived seed that does not reproduce the connected session address REFUSES client-side
// (never returns a guessable seed); (3) malformed/claim-less JWTs refuse. Pure module — no wallet, no network.
import { describe, expect, test } from 'bun:test'
import { normalizeSuiAddress } from '@mysten/sui/utils'

import { derive_zklogin_seed } from './zklogin_seed'

const b64url = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')

// Synthetic vector (frozen 2026-07-09): seed + address computed via @mysten/sui/zklogin
// genAddressSeed(BigInt(SALT), 'sub', SUB, AUD) / computeZkLoginAddressFromSeed(seed, ISS, false|true)
// — both address flavors coincide for this seed (its big-endian bytes already fill 32, unpadded == padded).
const SALT = '129390038577185583942388216820280642146'
const SUB = 'test-sub-4242424242'
const AUD = 'test-aud-263863163058.apps.googleusercontent.com'
const ISS = 'https://accounts.google.com'
const JWT = `${b64url({ alg: 'RS256', typ: 'JWT' })}.${b64url({ iss: ISS, sub: SUB, aud: AUD, iat: 1, exp: 2 })}.sig`
const EXPECTED_SEED = '8584504965473174740989874294284252077582702941194102067652425078920921131090'
const EXPECTED_ADDRESS = '0x7ab96948beacf4312e100ad41a45b5f0177ca007611bed5dd19c90b07a29f5ec'

describe('derive_zklogin_seed', () => {
  test('deterministic: the (salt, sub, aud) vector derives the frozen seed when the address matches', () => {
    const seed = derive_zklogin_seed({ jwt: JWT, salt: SALT, address: EXPECTED_ADDRESS })
    expect(seed).toBe(EXPECTED_SEED)
    // determinism: a second run is byte-identical
    expect(derive_zklogin_seed({ jwt: JWT, salt: SALT, address: EXPECTED_ADDRESS })).toBe(EXPECTED_SEED)
  })

  test('accepts a non-normalized (uppercase) session address', () => {
    const denormalized = `0x${EXPECTED_ADDRESS.slice(2).toUpperCase()}`
    expect(denormalized).not.toBe(EXPECTED_ADDRESS)
    expect(derive_zklogin_seed({ jwt: JWT, salt: SALT, address: denormalized })).toBe(EXPECTED_SEED)
  })

  test('REFUSES when the derived seed does not reproduce the connected address (never a guessable seed)', () => {
    expect(() => derive_zklogin_seed({ jwt: JWT, salt: SALT, address: normalizeSuiAddress('0x1') })).toThrow(
      /does not produce the connected address/
    )
    // a tampered salt derives a DIFFERENT seed → different address → same refusal
    expect(() => derive_zklogin_seed({ jwt: JWT, salt: '42', address: EXPECTED_ADDRESS })).toThrow(
      /does not produce the connected address/
    )
  })

  test('REFUSES a JWT missing the sub claim', () => {
    const jwt_no_sub = `${b64url({ alg: 'RS256' })}.${b64url({ iss: ISS, aud: AUD })}.sig`
    expect(() => derive_zklogin_seed({ jwt: jwt_no_sub, salt: SALT, address: EXPECTED_ADDRESS })).toThrow()
  })
})
