// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// THE RATE-LIMIT IDENTITY, DRIVEN. The per-IP window is anti-drain money policy, so its key must be a value the
// CALLER CANNOT CHOOSE. Both adapters read `x-forwarded-for`'s first hop, and every proxy in front of this
// service appends rather than replaces — so that hop is whatever the caller typed, and rotating it minted a
// fresh window per request. This file drives both adapters and asserts the key is the identity the EDGE
// vouched for, plus the refusal that replaces a rate-limit decision when no such identity exists.
//
//   bun test api/sponsor.client_identity.test.js   (no Redis, no station, no fullnode — the doors are doubles)
//
// Own process on purpose (like every sibling suite): the network + trusted-header polarity resolve at module
// load. PRODUCTION-SHAPED on purpose — testnet, i.e. an edge in front — because that is where the spoof pays.
//
// RED BEFORE THE FIX: test 1 recorded the spoofed 198.51.100.66, test 2 recorded three distinct keys for one
// caller, and tests 4–6 sponsored happily against `'local'` / an attacker-chosen bucket instead of refusing.

import { beforeEach, describe, expect, mock, test } from 'bun:test'

process.env.VITE_NETWORK = 'testnet' // an edge in front ⇒ the socket peer is the ingress, never the client
process.env.GAS_STATION_URL = 'http://rpc-gas-pool.test:9527'
process.env.GAS_STATION_AUTH = 'test-bearer'

// The store is doubled READY so the store gate (sponsor.store_required.test.js owns it) cannot be what answers
// here, and `rate_limited` records the key it was handed — the whole subject of this file. Everything else is
// the real module: the identity decision must be proven against the real shape, not a hand-built stub.
const real_state = await import('./sponsor_state.mjs')
let rate_limit_keys = []
let rate_limit_answer = false
mock.module('./sponsor_state.mjs', () => ({
  ...real_state,
  shared_store_ready: async () => true,
  rate_limited: async (ip) => {
    rate_limit_keys.push(ip)
    return rate_limit_answer
  },
}))

const S = await import('./sponsor.mjs')

const TRUSTED = '203.0.113.9' // what the edge stamped: the real caller
const SPOOFED = '198.51.100.66' // what the caller wrote into x-forwarded-for
const INGRESS = '10.244.1.1' // the socket peer inside the cluster — the SAME for every client
const server = { requestIP: () => ({ address: INGRESS }) }

/** Drive the Bun adapter; the retired single-POST route answers 410 without touching a money door. */
const bun_post = (headers) =>
  S.sponsor_fetch(new Request('http://sponsor.test/api/sponsor', { method: 'POST', body: '{}', headers }), server)

/** Drive the node-style adapter over the same request. */
const node_post = async (headers) => {
  const res = { _status: 0, _json: null, setHeader: () => {}, end: () => res }
  res.status = (status) => ((res._status = status), res)
  res.json = (json) => ((res._json = json), res)
  await S.default({ method: 'POST', url: '/api/sponsor', headers, body: {}, socket: { remoteAddress: INGRESS } }, res)
  return res
}

beforeEach(() => {
  rate_limit_keys = []
  rate_limit_answer = false
})

describe('the window keys on the identity the EDGE vouched for, never the caller-supplied hop', () => {
  test('a spoofed x-forwarded-for does not become the key — the stamped header does', async () => {
    const response = await bun_post({ 'x-forwarded-for': SPOOFED, 'cf-connecting-ip': TRUSTED })
    expect(response.status).toBe(410) // the request WAS served: this is not a refusal proving the point by accident
    expect(rate_limit_keys).toEqual([TRUSTED])
  })

  test('rotating the spoofable hop cannot mint a fresh window: one caller, one key', async () => {
    for (const spoof of ['1.2.3.4', '5.6.7.8', '9.10.11.12'])
      await bun_post({ 'x-forwarded-for': spoof, 'cf-connecting-ip': TRUSTED })
    expect(rate_limit_keys).toEqual([TRUSTED, TRUSTED, TRUSTED])
  })

  test('POSITIVE CONTROL — the limiter is genuinely wired: a limited identity still gets its 429', async () => {
    rate_limit_answer = true
    const response = await bun_post({ 'cf-connecting-ip': TRUSTED })
    expect(response.status).toBe(429)
  })
})

describe('an identity we cannot verify is REFUSED, never throttled against a caller-chosen value', () => {
  test('no stamped header ⇒ 503 with its own machine reason, and the limiter is never consulted', async () => {
    const response = await bun_post({ 'x-forwarded-for': SPOOFED })
    expect(response.status).toBe(503)
    expect((await response.json()).reason).toBe('untrusted-client-identity')
    expect(rate_limit_keys).toEqual([]) // no decision was taken on the spoofed value — the point of the refusal
  })

  test('the socket peer is NOT a substitute off localnet: every client shares the ingress address', async () => {
    expect(S.client_identity({ read_header: () => undefined, peer: INGRESS })).toBeNull()
  })

  test('an APPENDED trusted header (a chain, not an overwrite) proves nothing and is refused', async () => {
    const response = await bun_post({ 'cf-connecting-ip': `${SPOOFED}, ${TRUSTED}` })
    expect(response.status).toBe(503)
    expect(rate_limit_keys).toEqual([])
  })

  test('the node-style adapter takes the SAME decision — one home, both doors', async () => {
    const spoofed_only = await node_post({ 'x-forwarded-for': SPOOFED })
    expect(spoofed_only._status).toBe(503)
    expect(spoofed_only._json.reason).toBe('untrusted-client-identity')
    expect(rate_limit_keys).toEqual([])

    const stamped = await node_post({ 'x-forwarded-for': SPOOFED, 'cf-connecting-ip': TRUSTED })
    expect(stamped._status).toBe(410)
    expect(rate_limit_keys).toEqual([TRUSTED])
  })

  test('the refusal names the header an operator must restore — an outage must be diagnosable', () => {
    expect(S.UNTRUSTED_IDENTITY_ERROR).toContain('cf-connecting-ip')
  })
})
