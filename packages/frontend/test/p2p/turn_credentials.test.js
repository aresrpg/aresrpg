// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The client half of #1792, sad paths first. The whole reason this module exists is that the credential CANNOT
// be baked into the bundle, which means the browser depends on a network call at the worst possible moment —
// so what is pinned here is that every way that call can fail leaves ICE exactly as it was without TURN:
// STUN-only, one honest line, never a throw and never a half-built entry a peer connection would choke on.
//
// The env-reading door (`turn_ice_server`) is deliberately NOT driven here: `../env` is a process-global
// module and re-registering it would replace whatever factory a sibling suite in this same bun process
// installed (the #123 pollution class, see src/test_helpers/env_mock.js). The url derivation and the round
// trip are exported precisely so the risky half is drivable without it, and the STUN-only fallback the
// failures below produce is asserted end-to-end in lobby-room.test.js.

import { afterEach, describe, expect, it } from 'bun:test'

import { mint_ice_server, turn_mint_url } from '../../src/p2p/turn_credentials.js'

const RELAY = 'turn:turn.aresrpg.world:3478'
const real_fetch = globalThis.fetch

/** Answer the mint with an exact payload — or with a failure shape. */
const answer = (body, { ok = true, status = 200 } = {}) => {
  globalThis.fetch = async () => ({ ok, status, json: async () => body })
}

afterEach(() => {
  globalThis.fetch = real_fetch
})

describe('the mint url is derived, never a second env var', () => {
  it('sits beside the sponsor door on the same service', () => {
    expect(turn_mint_url('/api/sponsor')).toBe('/api/turn-credentials')
    expect(turn_mint_url('https://sponsor.aresrpg.world/api/sponsor')).toBe(
      'https://sponsor.aresrpg.world/api/turn-credentials'
    )
    expect(turn_mint_url('http://localhost:9528/api/sponsor')).toBe('http://localhost:9528/api/turn-credentials')
  })
})

describe('a minted pair reaches ICE whole, or not at all', () => {
  it('carries the mint`s own relay, its username and its credential', async () => {
    answer({ urls: RELAY, username: '1800000900:ares-deadbeef', credential: 'Iq7YXkRon8YXJfdN1Ke9EZOw1UE=', ttl: 900 })
    const minted = await mint_ice_server('/api/turn-credentials', 'turn:fallback:3478')

    expect(minted?.ice_server).toEqual({
      urls: RELAY,
      username: '1800000900:ares-deadbeef',
      credential: 'Iq7YXkRon8YXJfdN1Ke9EZOw1UE=',
    })
    expect(minted?.ttl_secs).toBe(900)
  })

  it('falls back to the configured relay when the mint names none of its own', async () => {
    answer({ username: '1:a', credential: 'c', ttl: 60 })
    expect((await mint_ice_server('/api/turn-credentials', RELAY))?.ice_server.urls).toBe(RELAY)
  })

  it('treats a missing ttl as already expired rather than as forever', async () => {
    answer({ urls: RELAY, username: '1:a', credential: 'c' })
    expect((await mint_ice_server('/api/turn-credentials', RELAY))?.ttl_secs).toBe(0)
  })
})

describe('every failure degrades to STUN-only — never a throw, never half an entry', () => {
  it('refuses a mint that answered without a credential pair', async () => {
    answer({ urls: RELAY, username: '1800000900:ares-deadbeef', ttl: 900 })
    expect(await mint_ice_server('/api/turn-credentials', RELAY)).toBe(null)
  })

  it('refuses an empty-string credential — present is not the same as usable', async () => {
    answer({ urls: RELAY, username: '', credential: '', ttl: 900 })
    expect(await mint_ice_server('/api/turn-credentials', RELAY)).toBe(null)
  })

  it('refuses an unconfigured or rate-limited mint (any non-2xx)', async () => {
    answer({ error: 'turn-unavailable' }, { ok: false, status: 503 })
    expect(await mint_ice_server('/api/turn-credentials', RELAY)).toBe(null)
    answer({ error: 'rate limited' }, { ok: false, status: 429 })
    expect(await mint_ice_server('/api/turn-credentials', RELAY)).toBe(null)
  })

  it('survives an unreachable mint and a body that is not JSON', async () => {
    globalThis.fetch = async () => {
      throw new Error('Failed to fetch')
    }
    expect(await mint_ice_server('/api/turn-credentials', RELAY)).toBe(null)

    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError('Unexpected token < in JSON')
      },
    })
    expect(await mint_ice_server('/api/turn-credentials', RELAY)).toBe(null)
  })
})
