// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { initial_app_state, reduce_app_state } from '../../src/store.ts'

const settings = { quality: 'medium', flat_mode: false, music_enabled: true, render_distance: null } as const
const party = {
  id: '0xp',
  members: [{ character_id: '0xa', name: 'Ari' }],
  invited: [],
}

test('friends, parties, invitations, and trades fold into their own domain homes', () => {
  let state = initial_app_state(settings)
  state = reduce_app_state(state, {
    type: 'server/packet',
    packet: { type: 'packet/friends', friends: [{ address: '0xpal', characters: ['Nyx'] }] },
  })
  state = reduce_app_state(state, {
    type: 'server/packet',
    packet: { type: 'packet/party', character_id: '0xa', party },
  })
  state = reduce_app_state(state, {
    type: 'server/packet',
    packet: {
      type: 'packet/party_invites',
      character_id: '0xb',
      parties: [party],
    },
  })
  state = reduce_app_state(state, {
    type: 'server/packet',
    packet: {
      type: 'packet/trades',
      trades: [
        {
          id: '0xt',
          a: '0xme',
          b: '0xher',
          version: 0,
          accept_a: false,
          accept_b: false,
          locked: false,
          sui_a: '0',
          sui_b: '0',
          caps_a: [],
          caps_b: [],
        },
      ],
    },
  })

  expect(state.friends.rows[0]).toEqual({ address: '0xpal', characters: ['Nyx'] })
  expect(state.party.by_id['0xp']).toEqual(party)
  expect(state.party.party_by_character['0xa']).toBe('0xp')
  expect(state.party.invitation_ids_by_character['0xb']).toEqual(['0xp'])
  expect(state.trade.rows[0]?.id).toBe('0xt')
  expect('friends' in state.session || 'parties' in state.session || 'trades' in state.session).toBeFalse()
  const disconnected = reduce_app_state(state, { type: 'auth/disconnected' })
  expect(disconnected.friends.rows).toEqual([])
  expect(disconnected.party.party_by_character).toEqual({})
  expect(disconnected.trade.rows).toEqual([])
})

test('party pending state is isolated per acting character', () => {
  let state = initial_app_state(settings)
  state = reduce_app_state(state, { type: 'party/pending', character_id: '0xa', operation: 'invite' })
  expect(state.party.pending_by_character).toEqual({ '0xa': 'invite' })
  expect(state.party.pending_by_character['0xb']).toBeUndefined()
})

test('a successful leave stays pending until authoritative party removal', () => {
  let state = initial_app_state(settings)
  state = reduce_app_state(state, {
    type: 'server/packet',
    packet: { type: 'packet/party', character_id: '0xa', party },
  })
  state = reduce_app_state(state, { type: 'party/pending', character_id: '0xa', operation: 'leave' })
  expect(state.party.pending_by_character['0xa']).toBe('leave')
  state = reduce_app_state(state, {
    type: 'server/packet',
    packet: { type: 'packet/party', character_id: '0xa', party: null },
  })
  expect(state.party.pending_by_character['0xa']).toBeUndefined()
  expect(state.party.party_by_character['0xa']).toBeUndefined()
})

test('authoritative shared rows cannot be overwritten by delayed receipt projections', () => {
  let state = initial_app_state(settings)
  const authoritative_trade = {
    id: '0xt',
    a: '0xme',
    b: '0xher',
    version: 2,
    accept_a: true,
    accept_b: true,
    locked: true,
    sui_a: '0',
    sui_b: '0',
    caps_a: [],
    caps_b: [],
  }
  state = reduce_app_state(state, {
    type: 'server/packet',
    packet: { type: 'packet/trades', trades: [authoritative_trade] },
  })
  state = reduce_app_state(state, {
    type: 'trade/created',
    trade: { ...authoritative_trade, version: 0, accept_a: false, accept_b: false, locked: false },
  })
  expect(state.trade.rows[0]).toEqual(authoritative_trade)
})

test('authentication rejection clears every social identity', () => {
  let state = initial_app_state(settings)
  state = reduce_app_state(state, {
    type: 'server/packet',
    packet: { type: 'packet/friends', friends: [{ address: '0xold', characters: ['Old'] }] },
  })
  state = reduce_app_state(state, {
    type: 'server/packet',
    packet: { type: 'packet/party', character_id: '0xa', party },
  })
  state = reduce_app_state(state, { type: 'auth/rejected', error: 'expired' })
  expect(state.friends.rows).toEqual([])
  expect(state.party.by_id).toEqual({})
  expect(state.trade.rows).toEqual([])
})

test('the active exchange survives full snapshots until that exact trade disappears', () => {
  const row = (id: string) => ({
    id,
    a: '0xme',
    b: '0xher',
    version: 0,
    accept_a: false,
    accept_b: false,
    locked: false,
    sui_a: '0',
    sui_b: '0',
    caps_a: [],
    caps_b: [],
  })
  let state = initial_app_state(settings)
  state = reduce_app_state(state, {
    type: 'server/packet',
    packet: { type: 'packet/trades', trades: [row('0xa'), row('0xb')] },
  })
  state = reduce_app_state(state, { type: 'trade/open', trade: '0xb' })
  state = reduce_app_state(state, {
    type: 'server/packet',
    packet: { type: 'packet/trades', trades: [row('0xb'), row('0xa')] },
  })
  expect(state.trade.active).toBe('0xb')
  state = reduce_app_state(state, { type: 'server/packet', packet: { type: 'packet/trades', trades: [row('0xa')] } })
  expect(state.trade.active).toBeNull()
})
