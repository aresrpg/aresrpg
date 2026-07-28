// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//
// THE DELIVERY GATE (#1508) — the courier's write half shipped while its read half did not, and the suite
// stayed green because every existing test called the decoder by hand. This one drives the REAL shipped
// composition instead: `join_courier` from src/courier/world.js, the EventSource it actually constructs, and
// the presence atom the whole world renders from.
//
// The fixture stream is not a puppet: it enforces the read layer's own contract
// (packages/rpc/indexer/src/stream.rs:466-470) — a link naming NEITHER `?address=` nor `?character=` is
// REFUSED and frames nothing, which is precisely why the shipped client saw an empty world. A test that let
// the link through would certify the same silence the issue reports.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import '../../src/test_helpers/env_mock.js'
import '../../src/test_helpers/expedition_sdk_mock.js'
import {
  join_courier,
  leave_courier,
  subscribe_fight_stream,
  sync_party_room,
} from '../../src/courier/world.js'
import { presence_store } from '../../src/world-shell/presence_adapter.js'

const WORLD = '0xworld'
const ME = '0xme'
const PEER = '0xpeer'

let opened = null

/** The read layer's presence route, as a fixture: identity is required, and frames are NAMED. */
class FixtureEventSource {
  constructor(url) {
    const { searchParams } = new URL(url)
    this.url = url
    this.listeners = new Map()
    this.refused = !searchParams.get('address') && !searchParams.get('character')
    this.readyState = this.refused ? 2 : 1
    opened = this
  }

  addEventListener(type, listener) {
    this.listeners.set(type, listener)
  }

  /** Deliver one named server frame — a refused (400) link delivers nothing, exactly like the real one. */
  emit(type, body) {
    if (this.refused) return this.listeners.get('error')?.()
    this.listeners.get(type)?.({ data: JSON.stringify(body) })
  }

  close() {
    this.readyState = 2
  }
}

const state = () => presence_store.getState()
const position_row = (character, x, z) => ({ type: 'position', world: WORLD, character, x, z, heading: 0.5 })
const chat_row = (character, text, extra = {}) => ({
  type: 'chat',
  world: WORLD,
  character,
  address: `wallet-${character}`,
  text,
  channel: 'CHAT_GENERAL',
  target: '',
  ...extra,
})

beforeEach(() => {
  globalThis.EventSource = FixtureEventSource
  opened = null
  state().input({ type: 'reset' })
  state().input({ type: 'session', character_id: ME })
})

afterEach(() => {
  leave_courier()
  sync_party_room(null)
  state().input({ type: 'reset' })
})

describe('the courier delivery half — the shipped world link', () => {
  test('the link the client opens names its identity, so the read layer can register it', () => {
    join_courier(WORLD, PEER)
    const { searchParams, pathname } = new URL(opened.url)
    expect(pathname).toBe(`/v1/stream/presence/${WORLD}`)
    expect(searchParams.get('character')).toBe(PEER)
    expect(opened.refused).toBe(false)
  })

  test('a delivered position frame lands in the peer table', () => {
    join_courier(WORLD, ME)
    opened.emit('position', position_row(PEER, 12, -4))
    const peer = state().peers.get(PEER)
    expect(peer?.position).toEqual({ x: 12, y: 0, z: -4 })
  })

  test('the join snapshot lands every live pose at once', () => {
    join_courier(WORLD, ME)
    opened.emit('positions', {
      type: 'positions',
      world: WORLD,
      positions: [position_row(PEER, 1, 2), position_row('0xother', 3, 4)],
    })
    expect([...state().peers.keys()].sort()).toEqual(['0xother', PEER])
  })

  test('a delivered chat line lands in the chat head the world chat renders from', () => {
    join_courier(WORLD, ME)
    opened.emit('chat', chat_row(PEER, 'hello world'))
    expect(state().chat?.row).toMatchObject({ id: PEER, message: 'hello world', address: `wallet-${PEER}` })
  })

  test('SENDER ECHO — my own accepted line returns down the same wire and folds through the same door', () => {
    join_courier(WORLD, ME)
    opened.emit('chat', chat_row(ME, 'my own line'))
    expect(state().chat?.row).toMatchObject({ id: ME, message: 'my own line' })
    expect(state().peers.has(ME)).toBe(false) // my POSE is still mine alone — only the line echoes
  })

  test('a party line is receiver-filtered on the exact party id', () => {
    join_courier(WORLD, ME)
    sync_party_room('0xparty')
    const before = state().chat_seq
    opened.emit('chat', chat_row(PEER, 'foreign', { channel: 'CHAT_GROUP', party: '0xelsewhere' }))
    expect(state().chat_seq).toBe(before)
    opened.emit('chat', chat_row(PEER, 'ours', { channel: 'CHAT_GROUP', party: '0xparty' }))
    expect(state().chat?.row.message).toBe('ours')
  })

  test('a fight courtesy row reaches its live fold without entering visible chat', () => {
    join_courier(WORLD, ME)
    let received = null
    const unsubscribe = subscribe_fight_stream((signal) => {
      received = signal
    })
    const before = state().chat_seq
    const signal = { dungeon_id: '0xdungeon', address: PEER, kind: 'placement', target: 42 }
    opened.emit('chat', chat_row(PEER, JSON.stringify(signal), { channel: 'CHAT_FIGHT' }))
    unsubscribe()
    expect(received).toEqual(signal)
    expect(state().chat_seq).toBe(before)
  })

  test('the read layer presence vocabulary rides the SAME link — one world, one connection', () => {
    join_courier(WORLD, ME)
    opened.emit('current-set', { world: WORLD, presence: [{ world: WORLD, address: '0xwallet', character: PEER }] })
    expect(state().online.get(PEER)?.address).toBe('0xwallet')
    opened.emit('leave', { world: WORLD, address: '0xwallet', character: PEER })
    expect(state().online.size).toBe(0)
  })

  test('a link that can name nobody is never opened — an eternally refused socket is not a delivery path', () => {
    join_courier(WORLD, null)
    expect(opened).toBeNull()
  })
})
