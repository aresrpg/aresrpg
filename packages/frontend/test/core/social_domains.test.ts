// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'
import type { TradeRow } from '@aresrpg/protocol'
import { world_center } from '@aresrpg/immutable'

import { initial_app_state, reduce_app_state } from '../../src/store.ts'
import { selected_party_invitation } from '../../src/modules/party.ts'
import { run_to_target } from '../../src/modules/run_to.ts'
import {
  reconcile_trade_row,
  trade_request_rows,
  trade_settlement_transition,
  visible_trade_rows,
} from '../../src/modules/trade.ts'

const settings = { quality: 'medium', flat_mode: false, music_enabled: true, render_distance: null } as const
const party = {
  id: '0xp',
  members: [{ character_id: '0xa', name: 'Ari' }],
  invited: [],
}
const trade = (id = '0xt', overrides: Partial<TradeRow> = {}): TradeRow => ({
  id,
  a: '0xme',
  b: '0xher',
  phase: 'requested',
  offer_revision: 0,
  accept_a: false,
  accept_b: false,
  sui_a: '0',
  sui_b: '0',
  caps_a: [],
  caps_b: [],
  ...overrides,
})
const trade_packet = (trades: TradeRow[]) => ({
  type: 'packet/trades' as const,
  trades,
})

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
    packet: trade_packet([trade()]),
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

test('party state does not duplicate the persisted follow preference', () => {
  let state = initial_app_state(settings)
  state = {
    ...state,
    session: { ...state.session, selected_character_id: '0xa' },
  }
  state = reduce_app_state(state, {
    type: 'server/packet',
    packet: { type: 'packet/party', character_id: '0xa', party },
  })
  state = reduce_app_state(state, {
    type: 'settings/changed',
    settings: Object.freeze({ ...state.settings, follow_leader: true }),
  })
  expect(state.settings.follow_leader).toBeTrue()
  expect('following' in state.party).toBeFalse()

  state = reduce_app_state(state, {
    type: 'server/packet',
    packet: { type: 'packet/party', character_id: '0xa', party: null },
  })
  expect(state.settings.follow_leader).toBeTrue()
})

test('an external party checkpoint becomes one selected-character run target', () => {
  let state = initial_app_state(settings)
  state = {
    ...state,
    session: {
      ...state.session,
      link_status: 'ready',
      selected_character_id: '0xa',
      characters: [
        {
          id: '0xa',
          world: 'nauvis',
          checkpoint_world: 'nauvis',
          custody: 'kiosk',
          equipment: [],
        },
        { id: '0xb', world: 'nauvis', checkpoint_world: 'nauvis', custody: 'kiosk', equipment: [] },
      ] as never,
    },
  }
  state = reduce_app_state(state, {
    type: 'server/packet',
    packet: {
      type: 'packet/party',
      character_id: '0xa',
      party: { ...party, members: [...party.members, { character_id: '0xc', name: 'Cyr' }] },
    },
  })

  state = reduce_app_state(state, { type: 'run_to/character', character_id: '0xc' })
  const request = state.run_to.run
  expect(request).toMatchObject({ status: 'loading', controlled_character_id: '0xa', name: 'Cyr' })
  state = reduce_app_state(state, {
    type: 'run_to/resolved',
    request: request as never,
    checkpoint: { x: world_center + 10, z: world_center + 20 },
  })
  expect(run_to_target(state)).toEqual({ x: 10, z: 20 })

  state = reduce_app_state(state, { type: 'character/select', character_id: '0xb' })
  expect(state.run_to.run).toBeNull()
  state = reduce_app_state(state, { type: 'run_to/character', character_id: '0xa' })
  expect(state.run_to.run).toBeNull()
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

test('party writes stay pending until their exact projected row arrives', () => {
  const cases = [
    {
      operation: 'invite:0xb',
      row: { ...party, invited: [{ character_id: '0xb', name: 'B' }] },
    },
    {
      operation: 'rescind:0xb',
      row: { ...party, invited: [] },
    },
    {
      operation: 'kick:0xb',
      row: { ...party, members: party.members.filter(({ character_id }) => character_id !== '0xb') },
    },
  ] as const
  for (const { operation, row } of cases) {
    let state = initial_app_state(settings)
    state = reduce_app_state(state, { type: 'party/pending', character_id: '0xa', operation })
    state = reduce_app_state(state, {
      type: 'server/packet',
      packet: { type: 'packet/party', character_id: '0xa', party: row },
    })
    expect(state.party.pending_by_character['0xa']).toBeUndefined()
  }
})

test('declining hides immediately, restores on failure, and settles on authoritative removal', () => {
  let state = initial_app_state(settings)
  state = {
    ...state,
    session: { ...state.session, selected_character_id: '0xb' },
  }
  state = reduce_app_state(state, {
    type: 'server/packet',
    packet: { type: 'packet/party_invites', character_id: '0xb', parties: [party] },
  })
  expect(selected_party_invitation(state)?.id).toBe('0xp')

  state = reduce_app_state(state, { type: 'party/pending', character_id: '0xb', operation: 'decline:0xp' })
  expect(selected_party_invitation(state)).toBeNull()

  state = reduce_app_state(state, { type: 'party/pending', character_id: '0xb', operation: null })
  expect(selected_party_invitation(state)?.id).toBe('0xp')

  state = reduce_app_state(state, { type: 'party/pending', character_id: '0xb', operation: 'decline:0xp' })
  state = reduce_app_state(state, {
    type: 'server/packet',
    packet: { type: 'packet/party_invites', character_id: '0xb', parties: [] },
  })
  expect(state.party.pending_by_character['0xb']).toBeUndefined()
  expect(selected_party_invitation(state)).toBeNull()
})

test('an already grouped character never presents a stale invitation', () => {
  let state = initial_app_state(settings)
  state = {
    ...state,
    session: { ...state.session, selected_character_id: '0xb' },
  }
  state = reduce_app_state(state, {
    type: 'server/packet',
    packet: { type: 'packet/party_invites', character_id: '0xb', parties: [party] },
  })
  state = reduce_app_state(state, {
    type: 'server/packet',
    packet: {
      type: 'packet/party',
      character_id: '0xb',
      party: { ...party, id: '0xcurrent', invited: [] },
    },
  })

  expect(selected_party_invitation(state)).toBeNull()
})

test('authoritative shared rows cannot be overwritten by delayed receipt projections', () => {
  let state = initial_app_state(settings)
  const authoritative_trade = trade('0xt', {
    phase: 'settling',
    offer_revision: 3,
    accept_a: true,
    accept_b: true,
  })
  state = reduce_app_state(state, {
    type: 'server/packet',
    packet: trade_packet([authoritative_trade]),
  })
  state = reduce_app_state(state, {
    type: 'trade/projected',
    trade: trade('0xt', { phase: 'negotiating', offer_revision: 1 }),
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
  const row = (id: string) => trade(id, { phase: 'negotiating', offer_revision: 1 })
  let state = initial_app_state(settings)
  state = reduce_app_state(state, {
    type: 'server/packet',
    packet: trade_packet([row('0xa'), row('0xb')]),
  })
  state = reduce_app_state(state, { type: 'trade/open', trade: '0xb' })
  state = reduce_app_state(state, {
    type: 'server/packet',
    packet: trade_packet([row('0xb'), row('0xa')]),
  })
  expect(state.trade.active).toBe('0xb')
  state = reduce_app_state(state, { type: 'server/packet', packet: trade_packet([row('0xa')]) })
  expect(state.trade.active).toBeNull()
})

test('joining a requested trade opens the full exchange for both packet and receipt paths', () => {
  const requested = trade('0xt', { phase: 'requested', offer_revision: 0 })
  const joined = trade('0xt', { phase: 'negotiating', offer_revision: 1 })
  let packet_state = initial_app_state(settings)
  packet_state = reduce_app_state(packet_state, { type: 'server/packet', packet: trade_packet([requested]) })
  packet_state = reduce_app_state(packet_state, { type: 'server/packet', packet: trade_packet([joined]) })
  expect(packet_state.trade.active).toBe('0xt')

  let receipt_state = initial_app_state(settings)
  receipt_state = reduce_app_state(receipt_state, { type: 'trade/projected', trade: requested })
  receipt_state = reduce_app_state(receipt_state, { type: 'trade/projected', trade: joined })
  expect(receipt_state.trade.active).toBe('0xt')
})

test('only a requested row addressed to this wallet is an incoming trade request', () => {
  let state = initial_app_state(settings)
  state = {
    ...state,
    session: { ...state.session, wallet: { address: '0xher' } as never },
  }
  state = reduce_app_state(state, {
    type: 'server/packet',
    packet: trade_packet([trade()]),
  })
  expect(trade_request_rows(state.trade.rows, '0xher')[0]?.id).toBe('0xt')
  state = reduce_app_state(state, { type: 'trade/pending', operation: 'decline_request:0xt' })
  expect(trade_request_rows(state.trade.rows, '0xher')[0]?.id).toBe('0xt')
})

test('the current incoming invitation and outgoing request remain separate', () => {
  const state = {
    ...initial_app_state(settings),
    trade: {
      ...initial_app_state(settings).trade,
      rows: [trade('0xa'), trade('0xb', { a: '0xher', b: '0xother' })],
    },
  }
  expect(trade_request_rows(state.trade.rows, '0xher').map(({ id }) => id)).toEqual(['0xa', '0xb'])
})

test('a projected request survives index lag, then the bounded snapshot replaces it', () => {
  let state = initial_app_state(settings)
  state = reduce_app_state(state, { type: 'trade/projected', trade: trade('0xa') })
  state = reduce_app_state(state, {
    type: 'server/packet',
    packet: trade_packet([]),
  })
  expect(state.trade.rows.map(({ id }) => id)).toEqual(['0xa'])
  state = reduce_app_state(state, {
    type: 'server/packet',
    packet: trade_packet([trade('0xa')]),
  })
  state = reduce_app_state(state, {
    type: 'server/packet',
    packet: trade_packet([trade('0xb')]),
  })
  expect(state.trade.rows.map(({ id }) => id)).toEqual(['0xb'])
  state = reduce_app_state(state, {
    type: 'server/packet',
    packet: { type: 'packet/trade_destroyed', trade: '0xb' },
  })
  expect(state.trade.rows).toEqual([])
})

test('settlement requires the armed revision and the exact negotiating-to-settling edge', () => {
  const row = trade('0xt', { phase: 'negotiating', offer_revision: 2, accept_a: true })
  const previous = {
    ...initial_app_state(settings),
    session: { ...initial_app_state(settings).session, wallet: { address: '0xme' } as never },
    trade: {
      rows: [row],
      active: '0xt',
      pending: null,
      settlement_armed: { '0xt': 2 },
      awaiting_projection: {},
      tombstones: {},
    },
  }
  const settling = { ...row, phase: 'settling' as const, offer_revision: 3, accept_b: true }
  const next = { ...previous, trade: { ...previous.trade, rows: [settling] } }
  expect(trade_settlement_transition(next as never, previous as never)?.id).toBe('0xt')
  expect(trade_settlement_transition(next as never, next as never)).toBeNull()
  expect(
    trade_settlement_transition({ ...next, trade: { ...next.trade, settlement_armed: {} } } as never, previous as never)
  ).toBeNull()
})

test('offer changes and cancellation erase stale automatic-settlement authority', () => {
  let state: ReturnType<typeof initial_app_state> = {
    ...initial_app_state(settings),
    trade: {
      ...initial_app_state(settings).trade,
      rows: [trade('0xt', { phase: 'negotiating', offer_revision: 2 })],
      settlement_armed: { '0xt': 2 },
    },
  }
  state = reduce_app_state(state, {
    type: 'server/packet',
    packet: trade_packet([trade('0xt', { phase: 'negotiating', offer_revision: 3 })]),
  })
  expect(state.trade.settlement_armed).toEqual({})
})

test('terminal projections form a shrinking lattice under concurrent settlement', () => {
  const cap_a = { object: '0xa' } as never
  const cap_b = { object: '0xb' } as never
  const base = trade('0xt', {
    phase: 'settling',
    offer_revision: 3,
    sui_a: '10',
    sui_b: '20',
    caps_a: [cap_a],
    caps_b: [cap_b],
  })
  const settled_a = { ...base, sui_b: '0', caps_b: [] }
  const settled_b = { ...base, sui_a: '0', caps_a: [] }
  expect(reconcile_trade_row(settled_a, settled_b)).toMatchObject({
    sui_a: '0',
    sui_b: '0',
    caps_a: [],
    caps_b: [],
  })
})

test('an unrelated counterparty revision never releases a local operation barrier', () => {
  let state = initial_app_state(settings)
  const own = trade('0xt', { phase: 'negotiating', offer_revision: 1, sui_a: '5' })
  state = reduce_app_state(state, { type: 'server/packet', packet: trade_packet([own]) })
  state = reduce_app_state(state, { type: 'trade/pending', operation: 'set_sui:0xt' })
  state = reduce_app_state(state, {
    type: 'server/packet',
    packet: trade_packet([{ ...own, offer_revision: 2, sui_b: '9' }]),
  })
  expect(state.trade.pending).toBe('set_sui:0xt')
})

test('receipt tombstones survive stale snapshots and reset with authentication', () => {
  let state = initial_app_state(settings)
  const row = trade('0xt')
  state = reduce_app_state(state, { type: 'trade/projected', trade: row })
  state = reduce_app_state(state, { type: 'trade/closed', trade: row.id })
  state = reduce_app_state(state, { type: 'server/packet', packet: trade_packet([row]) })
  expect(state.trade.rows).toEqual([])
  expect(state.trade.tombstones[row.id]).toBeTrue()
  state = reduce_app_state(state, { type: 'auth/disconnected' })
  expect(state.trade.tombstones).toEqual({})
})

test('joined and terminal trades remain discoverable without an active modal', () => {
  const state = {
    ...initial_app_state(settings),
    trade: {
      ...initial_app_state(settings).trade,
      rows: [
        trade('0xopen', { phase: 'negotiating', offer_revision: 1 }),
        trade('0xsettle', { phase: 'settling', offer_revision: 2, sui_b: '1' }),
      ],
    },
  }
  expect(state.trade.active).toBeNull()
  expect(visible_trade_rows(state.trade.rows).map(({ id }) => id)).toEqual(['0xopen', '0xsettle'])
})
