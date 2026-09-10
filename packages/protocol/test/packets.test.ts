// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The wire contract: declared intents and narrow correlated reads parse; generic query envelopes
// and coercion remain refused.

import { describe, expect, test } from 'bun:test'

import { expand_chat_message, parse_client_packet, parse_server_packet, CLIENT_PACKET_TYPES } from '../src/packets.ts'

describe('the wire contract', () => {
  test('declared intents parse with their exact shape', () => {
    expect(
      parse_client_packet(
        JSON.stringify({
          type: 'packet/position',
          character_id: '0xabc',
          checkpoint: 'nauvis:0:0:1',
          x: 1,
          y: 2,
          z: 3,
          riding: false,
        })
      )
    ).toEqual({
      type: 'packet/position',
      character_id: '0xabc',
      checkpoint: 'nauvis:0:0:1',
      x: 1,
      y: 2,
      z: 3,
      riding: false,
    })
    expect(() =>
      parse_client_packet(
        JSON.stringify({ type: 'packet/position', character_id: '0xabc', checkpoint: 'nauvis:0:0:1', x: 1, y: 2, z: 3 })
      )
    ).toThrow(/riding/)
    expect(
      parse_client_packet(JSON.stringify({ type: 'packet/track_character', character_id: '0xabc', tracked: true }))
    ).toEqual({
      type: 'packet/track_character',
      character_id: '0xabc',
      tracked: true,
    })
    expect(
      parse_client_packet(
        JSON.stringify({
          type: 'packet/admin_request',
          id: 1,
          kind: 'overview',
          revenue_days: 30,
          players_days: 7,
          transactions_days: 30,
          online_days: 1,
          addresses_days: 30,
          characters_days: 90,
        })
      )
    ).toEqual({
      type: 'packet/admin_request',
      id: 1,
      kind: 'overview',
      revenue_days: 30,
      players_days: 7,
      transactions_days: 30,
      online_days: 1,
      addresses_days: 30,
      characters_days: 90,
    })
    expect(
      parse_client_packet(
        JSON.stringify({
          type: 'packet/admin_request',
          id: 2,
          kind: 'overview_section',
          section: 'characters',
          days: 90,
        })
      )
    ).toEqual({ type: 'packet/admin_request', id: 2, kind: 'overview_section', section: 'characters', days: 90 })
    expect(
      parse_client_packet(JSON.stringify({ type: 'packet/character_owner_request', id: 7, character_id: '0xabc' }))
    ).toEqual({ type: 'packet/character_owner_request', id: 7, character_id: '0xabc' })
    expect(parse_client_packet(JSON.stringify({ type: 'packet/ping', id: 8 }))).toEqual({
      type: 'packet/ping',
      id: 8,
    })
    expect(parse_client_packet(JSON.stringify({ type: 'packet/fight_resync', fight: '0xf1' }))).toEqual({
      type: 'packet/fight_resync',
      fight: '0xf1',
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
    expect(() =>
      parse_client_packet(JSON.stringify({ type: 'packet/admin_request', kind: 'overview', days: 30 }))
    ).toThrow(/integer id/)
    expect(() =>
      parse_client_packet(
        JSON.stringify({
          type: 'packet/admin_request',
          id: 1,
          kind: 'overview',
          revenue_days: 12,
          players_days: 30,
          online_days: 1,
        })
      )
    ).toThrow(/overview ranges/)
    expect(() =>
      parse_client_packet(
        JSON.stringify({
          type: 'packet/admin_request',
          id: 1,
          kind: 'overview',
          revenue_days: '30',
          players_days: 30,
          online_days: 1,
        })
      )
    ).toThrow(/overview ranges/)
    expect(() =>
      parse_client_packet(JSON.stringify({ type: 'packet/admin_request', id: 1, kind: 'drop_db', days: 30 }))
    ).toThrow(/unknown admin kind/)
    expect(() => parse_client_packet(JSON.stringify({ type: 'packet/fight_resync', fight: 'nope' }))).toThrow(
      /fight id/
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
      'packet/fight_resync',
      'packet/market_observe',
      'packet/leaderboard_observe',
      'packet/spectate',
      'packet/fight_preview',
      'packet/character_owner_request',
      'packet/admin_request',
      'packet/ping',
    ])
  })

  test('the chat door trims, bounds, and refuses emptiness', () => {
    expect(
      parse_client_packet(
        JSON.stringify({
          type: 'packet/chat',
          character_id: '0xc',
          parts: [
            { kind: 'text', text: 'gg ' },
            { kind: 'item', id: '0xhat', name: 'Fuwa Hat' },
          ],
        })
      )
    ).toEqual({
      type: 'packet/chat',
      character_id: '0xc',
      parts: [
        { kind: 'text', text: 'gg ' },
        { kind: 'item', id: '0xhat', name: 'Fuwa Hat' },
      ],
    })
    expect(() =>
      parse_client_packet(
        JSON.stringify({ type: 'packet/chat', character_id: '0xc', parts: [{ kind: 'text', text: '   ' }] })
      )
    ).toThrow(/empty/)
    expect(() =>
      parse_client_packet(
        JSON.stringify({
          type: 'packet/chat',
          character_id: '0xc',
          parts: [{ kind: 'text', text: 'x'.repeat(241) }],
        })
      )
    ).toThrow(/exceeds 240/)
    expect(() =>
      parse_client_packet(
        JSON.stringify({
          type: 'packet/chat_whisper',
          character_id: '0xc',
          to: 'bob',
          parts: [{ kind: 'text', text: 'hi' }],
        })
      )
    ).toThrow(/target address/)
  })

  test('chat macros and linked items become structured immutable parts', () => {
    expect(
      expand_chat_message(
        { text: 'Meet %pos% %xp% [Fuwa Hat]', items: [{ id: '0xhat', name: 'Fuwa Hat' }] },
        { classe: 'shugo', level: 2, experience: '380', world: 'nauvis', x: 50_010, z: 49_990 }
      )
    ).toEqual([
      { kind: 'text', text: 'Meet ' },
      { kind: 'position', world: 'nauvis', x: 50_010, z: 49_990 },
      { kind: 'text', text: ' Shugo Lvl 2 (50%) ' },
      { kind: 'item', id: '0xhat', name: 'Fuwa Hat' },
    ])
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
          observation: { categories: ['sword', 'sword', 'hat'], characters: false },
        })
      )
    ).toEqual({
      type: 'packet/market_observe',
      observation: { categories: ['sword', 'hat'], characters: false },
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
    expect(
      parse_server_packet(
        JSON.stringify({
          type: 'packet/server_info',
          online: 12,
          indexing_lag: 4,
          current_epoch: '9',
          chain_timestamp_ms: 1_000_000,
        })
      )
    ).toEqual({
      type: 'packet/server_info',
      online: 12,
      indexing_lag: 4,
      current_epoch: '9',
      chain_timestamp_ms: 1_000_000,
    })
    expect(parse_server_packet(JSON.stringify({ type: 'packet/anything', value: true })) as unknown).toEqual({
      type: 'packet/anything',
      value: true,
    })
    expect(() => parse_server_packet('not json')).toThrow()
  })
})

test('movement needs bounded checkpoint provenance', () => {
  const position = { type: 'packet/position', character_id: '0xabc', x: 50_000, y: 0, z: 50_000, riding: false }
  for (const checkpoint of [undefined, null, '', 'x'.repeat(257), 20])
    expect(() => parse_client_packet(JSON.stringify({ ...position, checkpoint }))).toThrow(/checkpoint/)
})

test('captured browser movement retains its recalled checkpoint identity', async () => {
  // Captured from the real browser position publisher over a local WebSocket on 2026-09-09.
  // Synthetic origin pose using the confirmed testnet recall projection for Character
  // 0x79ebc67c18575a6b20f7d69faecfd318c6136a23e687aae6cb92caa89db32e2c,
  // object version 1009255742; checkpoint (50000, 50000) at 1788970808124 ms.
  const raw = await Bun.file(new URL('./fixtures/recall-position.json', import.meta.url)).text()
  expect(parse_client_packet(raw)).toEqual({
    type: 'packet/position',
    character_id: '0x79ebc67c18575a6b20f7d69faecfd318c6136a23e687aae6cb92caa89db32e2c',
    checkpoint: 'nauvis:50000:50000:1788970808124',
    x: 50000,
    y: 0,
    z: 50000,
    riding: false,
  })
})
