import { afterEach, describe, expect, mock, test } from 'bun:test'

import { set_expedition_sdk_mock } from '../test_helpers/expedition_sdk_mock.js'
import { is_zklogin_wallet } from '../auth/zklogin_wallet'
import i18n from '../i18n'

// MONEY LAW (#73): sponsorship is zkLogin-only. A wallet-standard (browser-extension) session self-pays
// EVERY transaction and must NEVER reach the sponsor endpoint. execute_sponsored_tx is the single door every
// sponsored path funnels through (gameplay sponsor-first, the gas-selection fallback, create + join), so the
// structural guard lives there. These tests prove the door refuses a non-zkLogin wallet BEFORE any network
// call — no /reserve, no /execute, no sponsor POST is ever made from a wallet session.

// tx/index pulls in ../chain/sdk (→ deployment → the move seed manifest) at module load; mock the SDK so this
// unit test loads without that generated artifact. The default impl throws — if the guard under test ever
// reached the SDK, the test would fail loudly, which is exactly the property we want to prove.
set_expedition_sdk_mock(async () => {
  throw new Error('the sponsor-door guard must refuse a wallet session BEFORE any SDK/network use')
})
const { execute_sponsored_tx } = await import('./index')

const enoki_wallet = {
  features: {
    'sui:signPersonalMessage': { signPersonalMessage: async () => ({ signature: 'x' }) },
    'sui:signTransaction': { signTransaction: async () => ({ signature: 'x', bytes: 'AQ==' }) },
    'enoki:getSession': { getSession: async () => ({}) },
  },
} as any

const extension_wallet = {
  // A real browser wallet signs, but is NOT a zkLogin identity (no enoki:getSession).
  features: {
    'sui:signPersonalMessage': { signPersonalMessage: async () => ({ signature: 'x' }) },
    'sui:signTransaction': { signTransaction: async () => ({ signature: 'x', bytes: 'AQ==' }) },
    'sui:signAndExecuteTransaction': { signAndExecuteTransaction: async () => ({ digest: 'D' }) },
  },
} as any

describe('is_zklogin_wallet — the sponsorability predicate', () => {
  test('the Enoki (Google) wallet is a zkLogin identity', () => {
    expect(is_zklogin_wallet(enoki_wallet)).toBe(true)
  })
  test('a wallet-standard browser extension is NOT a zkLogin identity', () => {
    expect(is_zklogin_wallet(extension_wallet)).toBe(false)
  })
})

describe('execute_sponsored_tx — the sponsor door is structurally unreachable for a wallet session', () => {
  const real_fetch = globalThis.fetch
  afterEach(() => {
    globalThis.fetch = real_fetch
  })

  test('a connected wallet (non-zkLogin) is REFUSED before any sponsor network call', async () => {
    // Spy on fetch: the guard must throw before the door ever POSTs to /reserve or /execute.
    const fetch_spy = mock(async () => new Response('{}', { status: 200 }))
    globalThis.fetch = fetch_spy as any

    const thrown = await execute_sponsored_tx({
      wallet: extension_wallet,
      address: '0xwallet',
      transaction: { setSenderIfNotSet() {}, build: async () => new Uint8Array([1]) } as any,
      chain: 'sui:testnet',
      sponsor_url: 'https://sponsor.example/api/sponsor',
    }).then(
      () => null,
      (e) => e
    )

    expect(thrown).toBeInstanceOf(Error)
    // Humanized, i18n'd cause (no-silent-failure law) — the honest "wallet pays its own gas" copy.
    expect((thrown as Error).message).toBe(i18n.t('errors.sponsor_zklogin_only'))
    // THE proof: zero sponsor traffic left the client for a wallet session.
    expect(fetch_spy).toHaveBeenCalledTimes(0)
  })

  test('the Enoki (zkLogin) wallet passes the money guard — it proceeds PAST it (an identity check, not a blanket refusal)', async () => {
    // An Enoki identity IS sponsor-eligible, so the guard lets it through: it reaches the kind-only build. A
    // sentinel throw there proves we got past the guard with no network/SDK call — the guard keys on identity.
    const PAST_GUARD = 'reached-build-past-the-money-guard'
    const thrown = await execute_sponsored_tx({
      wallet: enoki_wallet,
      address: '0xzk',
      transaction: {
        setSenderIfNotSet() {},
        build: async () => {
          throw new Error(PAST_GUARD)
        },
      } as any,
      chain: 'sui:testnet',
      sponsor_url: 'https://sponsor.example/api/sponsor',
    }).then(
      () => null,
      (e) => e
    )
    expect(thrown).toBeInstanceOf(Error)
    expect((thrown as Error).message).toBe(PAST_GUARD)
  })
})
