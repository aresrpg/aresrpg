// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The wire contract: declared intents parse, everything else is refused — no query surface,
// no generic envelope, no coercion.

import { describe, expect, test } from 'bun:test'

import { parse_client_packet, CLIENT_PACKET_TYPES } from '../src/packets.ts'

describe('the wire contract', () => {
  test('declared intents parse with their exact shape', () => {
    expect(parse_client_packet(JSON.stringify({ type: 'packet/position', x: 1, y: 2, z: 3 }))).toEqual({
      type: 'packet/position',
      x: 1,
      y: 2,
      z: 3,
    })
    expect(parse_client_packet(JSON.stringify({ type: 'packet/embody', character_id: '0xabc' }))).toEqual({
      type: 'packet/embody',
      character_id: '0xabc',
    })
    expect(parse_client_packet(JSON.stringify({ type: 'packet/admin_request', id: 1, kind: 'stats' }))).toEqual({
      type: 'packet/admin_request',
      id: 1,
      kind: 'stats',
    })
  })

  test('malformed intents throw, never coerce', () => {
    expect(() => parse_client_packet(JSON.stringify({ type: 'packet/position', x: 'a' }))).toThrow(/needs/)
    expect(() => parse_client_packet(JSON.stringify({ type: 'packet/embody', character_id: 'nope' }))).toThrow(
      /character_id/
    )
    expect(() => parse_client_packet(JSON.stringify({ type: 'packet/admin_request', kind: 'stats' }))).toThrow(
      /integer id/
    )
    expect(() => parse_client_packet(JSON.stringify({ type: 'packet/admin_request', id: 1, kind: 'drop_db' }))).toThrow(
      /unknown admin kind/
    )
  })

  test('there is NO query surface — undeclared packet types are refused', () => {
    expect(() => parse_client_packet(JSON.stringify({ type: 'request', kind: 'characters', id: 1 }))).toThrow(
      /unknown packet type/
    )
    expect(() => parse_client_packet(JSON.stringify({ type: 'subscribe', channel: 'evt:fight:0x1' }))).toThrow(
      /unknown packet type/
    )
    expect(CLIENT_PACKET_TYPES).toEqual([
      'packet/embody',
      'packet/position',
      'packet/chat',
      'packet/chat_party',
      'packet/chat_whisper',
      'packet/fight_action',
      'packet/market_observe',
      'packet/spectate',
      'packet/admin_request',
    ])
  })

  test('the chat door trims, bounds, and refuses emptiness', () => {
    expect(parse_client_packet(JSON.stringify({ type: 'packet/chat', text: '  gg  ' }))).toEqual({
      type: 'packet/chat',
      text: 'gg',
    })
    expect(() => parse_client_packet(JSON.stringify({ type: 'packet/chat', text: '   ' }))).toThrow(/empty/)
    expect(() => parse_client_packet(JSON.stringify({ type: 'packet/chat', text: 'x'.repeat(241) }))).toThrow(
      /exceeds 240/
    )
    expect(() => parse_client_packet(JSON.stringify({ type: 'packet/chat_whisper', to: 'bob', text: 'hi' }))).toThrow(
      /target address/
    )
  })

  test('observe intents fold a value or null — anything else refused', () => {
    expect(parse_client_packet(JSON.stringify({ type: 'packet/market_observe', category: null }))).toEqual({
      type: 'packet/market_observe',
      category: null,
    })
    expect(() => parse_client_packet(JSON.stringify({ type: 'packet/market_observe', category: 7 }))).toThrow(
      /category/
    )
    expect(() => parse_client_packet(JSON.stringify({ type: 'packet/spectate', fight: 'nope' }))).toThrow(/fight id/)
    expect(() =>
      parse_client_packet(JSON.stringify({ type: 'packet/fight_action', fight: '0xf', action: [1] }))
    ).toThrow(/action object/)
  })
})
