// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The wire contract: declared intents and narrow correlated reads parse; generic query envelopes
// and coercion remain refused.

import { describe, expect, test } from 'bun:test'

import { parse_client_packet, parse_server_packet, CLIENT_PACKET_TYPES } from '../src/packets.ts'

describe('the wire contract', () => {
  test('declared intents parse with their exact shape', () => {
    expect(
      parse_client_packet(
        JSON.stringify({ type: 'packet/position', character_id: '0xabc', x: 1, y: 2, z: 3, riding: false })
      )
    ).toEqual({ type: 'packet/position', character_id: '0xabc', x: 1, y: 2, z: 3, riding: false })
    expect(() =>
      parse_client_packet(JSON.stringify({ type: 'packet/position', character_id: '0xabc', x: 1, y: 2, z: 3 }))
    ).toThrow(/riding/)
    expect(
      parse_client_packet(JSON.stringify({ type: 'packet/track_character', character_id: '0xabc', tracked: true }))
    ).toEqual({
      type: 'packet/track_character',
      character_id: '0xabc',
      tracked: true,
    })
    expect(parse_client_packet(JSON.stringify({ type: 'packet/admin_request', id: 1, kind: 'stats' }))).toEqual({
      type: 'packet/admin_request',
      id: 1,
      kind: 'stats',
    })
    expect(
      parse_client_packet(JSON.stringify({ type: 'packet/character_owner_request', id: 7, character_id: '0xabc' }))
    ).toEqual({ type: 'packet/character_owner_request', id: 7, character_id: '0xabc' })
    expect(parse_client_packet(JSON.stringify({ type: 'packet/ping', id: 8 }))).toEqual({
      type: 'packet/ping',
      id: 8,
    })
  })

  test('malformed intents throw, never coerce', () => {
    expect(() => parse_client_packet(JSON.stringify({ type: 'packet/position', x: 'a' }))).toThrow(/needs/)
    expect(() =>
      parse_client_packet(
        JSON.stringify({ type: 'packet/position', character_id: 'nope', x: 1, y: 2, z: 3, riding: false })
      )
    ).toThrow(/character_id/)
    expect(() =>
      parse_client_packet(JSON.stringify({ type: 'packet/track_character', character_id: 'nope', tracked: true }))
    ).toThrow(/character_id/)
    expect(() => parse_client_packet(JSON.stringify({ type: 'packet/admin_request', kind: 'stats' }))).toThrow(
      /integer id/
    )
    expect(() => parse_client_packet(JSON.stringify({ type: 'packet/admin_request', id: 1, kind: 'drop_db' }))).toThrow(
      /unknown admin kind/
    )
  })

  test('the duel relay is gone from the wire — the chain reserves the seat', () => {
    // THE CHALLENGE IS THE INVITATION (2026-08-22): side B is reserved on chain
    // (fight.move ACCESS_INVITED), so no client ever negotiates a duel over the wire. The
    // relay that did — invite/accept/decline — is refused as the undeclared surface it is.
    for (const kind of ['invite', 'accept', 'decline'])
      expect(() => parse_client_packet(JSON.stringify({ type: 'packet/duel', to: '0xabc', kind }))).toThrow(
        /unknown packet type/
      )
  })

  test('undeclared generic query and subscription surfaces are refused', () => {
    expect(() => parse_client_packet(JSON.stringify({ type: 'request', kind: 'characters', id: 1 }))).toThrow(
      /unknown packet type/
    )
    expect(() => parse_client_packet(JSON.stringify({ type: 'subscribe', channel: 'evt:fight:0x1' }))).toThrow(
      /unknown packet type/
    )
    expect(CLIENT_PACKET_TYPES).toEqual([
      'packet/signature_response',
      'packet/track_character',
      'packet/position',
      'packet/chat',
      'packet/chat_party',
      'packet/chat_whisper',
      'packet/fight_action',
      'packet/market_observe',
      'packet/spectate',
      'packet/character_owner_request',
      'packet/admin_request',
      'packet/ping',
    ])
  })

  test('the chat door trims, bounds, and refuses emptiness', () => {
    expect(parse_client_packet(JSON.stringify({ type: 'packet/chat', character_id: '0xc', text: '  gg  ' }))).toEqual({
      type: 'packet/chat',
      character_id: '0xc',
      text: 'gg',
    })
    expect(() =>
      parse_client_packet(JSON.stringify({ type: 'packet/chat', character_id: '0xc', text: '   ' }))
    ).toThrow(/empty/)
    expect(() =>
      parse_client_packet(JSON.stringify({ type: 'packet/chat', character_id: '0xc', text: 'x'.repeat(241) }))
    ).toThrow(/exceeds 240/)
    expect(() =>
      parse_client_packet(JSON.stringify({ type: 'packet/chat_whisper', character_id: '0xc', to: 'bob', text: 'hi' }))
    ).toThrow(/target address/)
  })

  test('observe intents fold a value or null — anything else refused', () => {
    expect(parse_client_packet(JSON.stringify({ type: 'packet/market_observe', observation: null }))).toEqual({
      type: 'packet/market_observe',
      observation: null,
    })
    expect(
      parse_client_packet(
        JSON.stringify({
          type: 'packet/market_observe',
          observation: { categories: ['sword', 'sword', 'helmet'], characters: false },
        })
      )
    ).toEqual({
      type: 'packet/market_observe',
      observation: { categories: ['sword', 'helmet'], characters: false },
    })
    expect(() => parse_client_packet(JSON.stringify({ type: 'packet/market_observe', observation: 7 }))).toThrow(
      /observation/
    )
    expect(() =>
      parse_client_packet(
        JSON.stringify({ type: 'packet/market_observe', observation: { categories: ['made_up'], characters: false } })
      )
    ).toThrow(/categories/)
    expect(() =>
      parse_client_packet(JSON.stringify({ type: 'packet/spectate', character_id: '0xc', fight: 'nope' }))
    ).toThrow(/fight id/)
    expect(() =>
      parse_client_packet(JSON.stringify({ type: 'packet/fight_action', fight: '0xf', action: [1] }))
    ).toThrow(/action object/)
    expect(
      parse_client_packet(
        JSON.stringify({
          type: 'packet/fight_action',
          fight: '0xf',
          action: { type: 'move_to', fighter: '1', path: ['2', '3'] },
        })
      )
    ).toEqual({
      type: 'packet/fight_action',
      fight: '0xf',
      action: { type: 'move_to', fighter: '1', path: ['2', '3'] },
    })
    expect(() =>
      parse_client_packet(
        JSON.stringify({
          type: 'packet/fight_action',
          fight: '0xf',
          action: { type: 'move_to', fighter: '1', path: [2] },
        })
      )
    ).toThrow(/decimal/)
    let nested: Record<string, unknown> = {}
    for (let depth = 0; depth < 7; depth += 1) nested = { nested }
    expect(() =>
      parse_client_packet(JSON.stringify({ type: 'packet/fight_action', fight: '0xf', action: nested }))
    ).toThrow(/nested too deeply/)
  })

  test('the trusted server stream needs JSON syntax, not duplicate runtime schemas', () => {
    expect(parse_server_packet(JSON.stringify({ type: 'packet/server_info', online: 12, indexing_lag: 4 }))).toEqual({
      type: 'packet/server_info',
      online: 12,
      indexing_lag: 4,
    })
    expect(parse_server_packet(JSON.stringify({ type: 'packet/anything', value: true })) as unknown).toEqual({
      type: 'packet/anything',
      value: true,
    })
    expect(() => parse_server_packet('not json')).toThrow()
  })
})
