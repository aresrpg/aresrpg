// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import { parse_client_packet } from '../src/packets.ts'

const parse = (request: unknown) =>
  parse_client_packet(JSON.stringify({ type: 'packet/allocation_request', id: 1, request }))
test('campaign wire bounds addresses, posts, and signature payloads', () => {
  expect(parse({ action: 'status' }).type).toBe('packet/allocation_request')
  expect(() => parse({ action: 'submit', address: '0x1', urls: [true] })).toThrow()
  expect(() => parse({ action: 'wallet_verify', nonce: 'a'.repeat(64), signature: 's'.repeat(12001) })).toThrow()
  expect(() => parse({ action: '__proto__' })).toThrow()
  expect(() => parse({ action: 'constructor' })).toThrow()
  expect(() => parse(null)).toThrow()
})
