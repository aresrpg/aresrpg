// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import { parse_client_packet } from '../src/packets.ts'

const parse = (request: unknown) =>
  parse_client_packet(JSON.stringify({ type: 'packet/allocation_request', id: 1, request }))
test('campaign wire bounds addresses and signature payloads, and refuses retired actions', () => {
  expect(parse({ action: 'status' }).type).toBe('packet/allocation_request')
  expect(() => parse({ action: 'wallet_remove', address: 'a'.repeat(67) })).toThrow()
  for (const action of ['submit', 'link_x', 'complete_x']) expect(() => parse({ action, address: '0x1' })).toThrow()
  expect(() => parse({ action: 'wallet_verify', nonce: 'a'.repeat(64), signature: 's'.repeat(12001) })).toThrow()
  expect(() => parse({ action: '__proto__' })).toThrow()
  expect(() => parse({ action: 'constructor' })).toThrow()
  expect(() => parse(null)).toThrow()
})
