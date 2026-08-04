// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #2192 — why create-character fails for a player who has been signed in a while, and keeps failing.
// Enoki's signer repairs a dead session by re-running OAuth: `#getKeypair` opens a popup the moment
// `!session.jwt || now > session.expiresAt` (node_modules/@mysten/enoki/dist/wallet/wallet.mjs:183). Inside a
// sign there is no user activation left, the browser blocks it, and the sign rejects with `Failed to open
// popup` — the exact error class already sitting in our error store. Retrying cannot help: the session is
// still dead and the next popup is blocked too. The wrapper asks the same question one step earlier.
import { describe, expect, it, mock } from 'bun:test'

import {
  zklogin_session_unusable,
  is_zklogin_session_expired,
  with_proof_retry,
} from '../../src/auth/zklogin_proof_retry'

const NOW = 1_800_000_000_000
const live_session = { jwt: 'header.payload.signature', expiresAt: NOW + 60_000, maxEpoch: 812, randomness: 'r' }
/** the wrapper reads the real clock — a wrapped-wallet session must be dated against it, not the fixture NOW */
const dated = (offset_ms: number) => ({ ...live_session, expiresAt: Date.now() + offset_ms })

describe('zklogin_session_unusable — Enoki’s own gate, asked one step earlier', () => {
  it('a live session signs', () => {
    expect(zklogin_session_unusable(live_session, NOW)).toBe(false)
  })

  it('an expired session does not — this is the popup trigger', () => {
    expect(zklogin_session_unusable({ ...live_session, expiresAt: NOW - 1 }, NOW)).toBe(true)
  })

  it('a session with no JWT does not — the OAuth callback never completed', () => {
    expect(zklogin_session_unusable({ expiresAt: NOW + 60_000 }, NOW)).toBe(true)
    expect(zklogin_session_unusable({ jwt: '', expiresAt: NOW + 60_000 }, NOW)).toBe(true)
  })

  it('no session at all does not — the app can still show a connected address, the signer cannot sign', () => {
    expect(zklogin_session_unusable(null, NOW)).toBe(true)
    expect(zklogin_session_unusable(undefined, NOW)).toBe(true)
  })

  it('a session with no expiry is trusted — absence of a field is not evidence of expiry', () => {
    expect(zklogin_session_unusable({ jwt: 'a.b.c' }, NOW)).toBe(false)
  })
})

const wrapped_wallet = (session: unknown, sign: ReturnType<typeof mock>, throws = false) =>
  with_proof_retry({
    version: '1.0.0',
    name: 'Google',
    icon: 'data:image/png;base64,',
    chains: ['sui:testnet'],
    accounts: [],
    features: {
      'enoki:getSession': {
        getSession: async () => {
          if (throws) throw new Error('idb unavailable')
          return session
        },
      },
      'sui:signPersonalMessage': { version: '1.0.0', signPersonalMessage: sign },
    },
  } as never)

const sign_with = (wallet: ReturnType<typeof with_proof_retry>) =>
  (wallet.features['sui:signPersonalMessage'] as { signPersonalMessage: (...a: never[]) => Promise<unknown> })
    .signPersonalMessage({ account: { address: '0xabc' }, message: new Uint8Array(), chain: 'sui:testnet' } as never)

describe('the sign door refuses a dead session instead of triggering a blocked popup', () => {
  it('refuses BEFORE the wallet is ever called — nothing is signed, nothing is built', async () => {
    const sign = mock(async () => ({ signature: 'sig' }))
    const failure = await sign_with(wrapped_wallet(dated(-60_000), sign)).catch((e) => e)
    expect(is_zklogin_session_expired(failure)).toBe(true)
    expect(sign).not.toHaveBeenCalled()
  })

  it('a live session signs exactly as before — the gate is not in the healthy path', async () => {
    const sign = mock(async () => ({ signature: 'sig' }))
    await expect(sign_with(wrapped_wallet(dated(60_000), sign))).resolves.toEqual({ signature: 'sig' })
    expect(sign).toHaveBeenCalledTimes(1)
  })

  it('an UNREADABLE session is not a verdict — the sign proceeds and Enoki stays the authority', async () => {
    const sign = mock(async () => ({ signature: 'sig' }))
    await expect(sign_with(wrapped_wallet(null, sign, true))).resolves.toEqual({ signature: 'sig' })
    expect(sign).toHaveBeenCalledTimes(1)
  })
})
