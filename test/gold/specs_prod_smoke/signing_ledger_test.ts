// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// THE PROD-SMOKE SIGNER'S POLARITY CONTROL — #1723's "positive control proving the gate fails when signing
// breaks". The signing legs only exist in CI against live testnet; every DECISION they make is pure and is
// driven here, off a browser, off a network, off the SDK.
//
// RED-FIRST provenance, two bugs this file pins:
//   1. prod_smoke.spec.ts guarded VITE_DEV_KEY with `!DEV_KEY` while edge-smoke.yml step zero guarded
//      `-z "${VITE_DEV_KEY//[[:space:]]/}"`. A whitespace-only secret cleared the consumer's guard and died
//      inside decodeSuiPrivateKey mid-job, reading as an ordinary product red. Row 2 fails on the old
//      predicate, passes on the new one.
//   2. No row asserted a signature had ever happened (#1723's whole indictment): the suite could not tell a
//      shim that signed from a shim that did nothing. `assert_signed_and_executed` is that missing oracle
//      and the last describe below is its red twin.
//
// *_test.ts on purpose — playwright.prod-smoke.config.ts's testDir is this folder and its default testMatch
// collects `*.spec.ts` / `*.test.ts`; this pure unit must never be collected as a live-testnet row.
import { describe, expect, test } from 'bun:test'

import {
  assert_signed_and_executed,
  dev_key_or_throw,
  executed_digest,
  record_signature,
  type signing_entry,
} from './signing_ledger.ts'

const DIGEST = '8kQ4mHRoLdA9y2ZcVw6nBt3sXfJ1pUeGqM7iNvKdT5rC'

describe('prod-smoke guard · the smoke must be able to see', () => {
  test('an absent or empty VITE_DEV_KEY refuses by name — never a skip, never a green', () => {
    expect(() => dev_key_or_throw(undefined)).toThrow(/VITE_DEV_KEY is absent or blank/)
    expect(() => dev_key_or_throw('')).toThrow(/BLIND/)
  })

  test('a WHITESPACE-ONLY key refuses on exactly the predicate edge-smoke.yml step zero applies', () => {
    // All three cleared the old `!DEV_KEY` consumer guard and died later inside the key decoder.
    for (const blank of [' ', '\n', '  \t\n ']) expect(() => dev_key_or_throw(blank)).toThrow(/BLIND/)
  })

  test('a present key survives, trimmed — the guard never rewrites the secret it admits', () => {
    expect(dev_key_or_throw('  suiprivkey-shaped-placeholder  ')).toBe('suiprivkey-shaped-placeholder')
  })
})

describe('prod-smoke verdict · a signed execute yields a citeable digest', () => {
  test('a successful execute returns its digest', () => {
    expect(executed_digest({ Transaction: { digest: DIGEST, effects: { status: { success: true } } } })).toBe(DIGEST)
  })
})

describe('prod-smoke verdict · broken signing FAILS LOUD (#1723 positive control)', () => {
  test('a chain-refused transaction throws the chain error, never a digest', () => {
    expect(() =>
      executed_digest({
        FailedTransaction: {
          digest: DIGEST,
          effects: { status: { success: false, error: { message: 'InsufficientGas' } } },
        },
      })
    ).toThrow(/InsufficientGas/)
  })

  test('a refusal with no error message still refuses, by digest', () => {
    expect(() => executed_digest({ FailedTransaction: { digest: DIGEST, effects: { status: {} } } })).toThrow(
      new RegExp(`transaction ${DIGEST} failed on chain`)
    )
  })

  test('an execute that returns nothing at all is a dead route, never a pass', () => {
    expect(() => executed_digest({})).toThrow(/the signing route is dead/)
  })

  test('success with no digest is an unciteable claim and is refused', () => {
    expect(() => executed_digest({ Transaction: { effects: { status: { success: true } } } })).toThrow(/unciteable/)
  })
})

describe('prod-smoke oracle · the ledger is what a row asserts against', () => {
  test('the ledger is append-only and never mutates its input', () => {
    const first: readonly signing_entry[] = record_signature([], { op: 'personal' })
    const second = record_signature(first, { op: 'execute', digest: DIGEST })
    expect(first).toEqual([{ op: 'personal' }])
    expect(second).toEqual([{ op: 'personal' }, { op: 'execute', digest: DIGEST }])
  })

  test('an empty ledger REFUSES the claim — a shim that signed nothing cannot report green', () => {
    expect(() => assert_signed_and_executed([])).toThrow(/the shim signed nothing/)
  })

  test('connect-and-render alone is NOT a signed transaction (the #1723 blind state, by name)', () => {
    // Exactly what rows a/b/d/e/f produce: the app boots, the wallet connects, nothing is ever signed.
    expect(() => assert_signed_and_executed([{ op: 'personal' }, { op: 'sign' }])).toThrow(/personal,sign/)
  })

  test('a real execute entry satisfies the oracle and hands back the digests to cite', () => {
    expect(assert_signed_and_executed([{ op: 'personal' }, { op: 'execute', digest: DIGEST }])).toEqual([DIGEST])
  })

  test('an execute recorded without a digest does not count as proof', () => {
    expect(() => assert_signed_and_executed([{ op: 'execute' }])).toThrow(/the shim signed nothing/)
  })
})
