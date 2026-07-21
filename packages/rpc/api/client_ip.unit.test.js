// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, expect, test } from 'bun:test'

import { client_ip } from './client_ip.js'

const req = (headers) => new Request('http://localhost/v1/config', { headers })
const server = (address) => ({ requestIP: () => (address ? { address } : null) })

describe('read API client IP resolution', () => {
  test('trusts Cloudflare-stamped CF-Connecting-IP — the header a client cannot forge', () => {
    expect(client_ip(req({ 'cf-connecting-ip': '203.0.113.5' }), server('10.244.1.1'))).toBe('203.0.113.5')
  })

  test('CF-Connecting-IP wins even when a client ships its own spoofed X-Forwarded-For', () => {
    // Live-verified 2026-07-21 against rpc.aresrpg.world: Cloudflare APPENDS the true connecting
    // IP to whatever X-Forwarded-For the client already sent rather than replacing it, so the
    // first XFF hop can be attacker-chosen. A spoofed `X-Forwarded-For: 1.2.3.4` minted a fresh
    // 120-request budget on every request while the real shared office IP sat throttled.
    const headers = { 'cf-connecting-ip': '203.0.113.5', 'x-forwarded-for': '1.2.3.4, 203.0.113.5' }
    expect(client_ip(req(headers), server('10.244.1.1'))).toBe('203.0.113.5')
  })

  test('falls back to X-Forwarded-For when no Cloudflare header is present (local/self-hosted)', () => {
    expect(client_ip(req({ 'x-forwarded-for': '198.51.100.9, 10.0.0.1' }), server('10.244.1.1'))).toBe('198.51.100.9')
  })

  test('falls back to the socket address when neither header is present', () => {
    expect(client_ip(req({}), server('10.244.1.1'))).toBe('10.244.1.1')
  })

  test('falls back to "unknown" when nothing identifies the caller', () => {
    expect(client_ip(req({}), server(null))).toBe('unknown')
  })
})
