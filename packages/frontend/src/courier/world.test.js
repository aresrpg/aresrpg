// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { presence_store } from '../world-shell/presence_adapter.js'

import { courier_inputs, courier_refusal, join_courier, leave_courier } from './world.js'

// #1762: room membership owns the presence atom's link health. The additive legacy courier still reconnects
// itself, but none of its lifecycle signals may overwrite the room chip.
describe('the courier cannot downgrade room-owned link health', () => {
  class FakeEventSource {
    constructor(url) {
      this.url = url
      this.readyState = 0
      this.listeners = new Map()
    }
    addEventListener(type, handler) {
      this.listeners.set(type, handler)
    }
    emit(type, event = {}) {
      this.listeners.get(type)?.(event)
    }
    close() {
      this.readyState = 2
    }
  }

  beforeEach(() => {
    presence_store.getState().input({ type: 'reset' })
  })

  afterEach(() => {
    leave_courier()
    delete globalThis.EventSource
  })

  test('opening the courier and receiving a live frame leave room status untouched', () => {
    /** @type {any} */
    let source
    globalThis.EventSource = class extends FakeEventSource {
      constructor(url) {
        super(url)
        source = this
      }
    }
    presence_store.getState().input({ type: 'link', status: 'connected' })

    join_courier('0xworld', '0xcharacter', '0xaddress')
    expect(presence_store.getState()).toMatchObject({ link_status: 'connected', link_error: null })

    source.emit('open')
    expect(presence_store.getState()).toMatchObject({ link_status: 'connected', link_error: null })
  })

  test('a courier link that gives up cannot mark the live room failed', () => {
    /** @type {any} */
    let source
    globalThis.EventSource = class extends FakeEventSource {
      constructor(url) {
        super(url)
        source = this
      }
    }
    presence_store.getState().input({ type: 'link', status: 'connected' })
    join_courier('0xworld', '0xcharacter', '0xaddress')
    source.readyState = 2
    source.emit('error')

    expect(presence_store.getState()).toMatchObject({ link_status: 'connected', link_error: null })
  })

  test('leaving the courier cannot reset the room atom', () => {
    globalThis.EventSource = FakeEventSource
    presence_store.getState().input({ type: 'link', status: 'connected' })
    join_courier('0xworld', '0xcharacter', '0xaddress')
    leave_courier()
    expect(presence_store.getState()).toMatchObject({ link_status: 'connected', link_error: null })
  })
})

// #1641 — a refused POST used to be one silenced game_log line (the console channel is OFF for players), so a
// 400 reached the browser as a bare network row and a rejected signature froze every send for the whole
// 4-minute auth-reuse window. This is the ONE policy that decides what each refusal means.
describe('courier refusal policy', () => {
  test('a 401 drops the cached signature so the very next send re-signs — no page refresh', () => {
    expect(courier_refusal({ status: 401, code: 'authentication_failed' }, 'position')).toMatchObject({
      resign: true,
      report: false,
      code: 'authentication_failed',
    })
  })

  test('a 400 is OUR bug: reported loudly, never silently retried into the same wall', () => {
    expect(courier_refusal({ status: 400, code: 'text_too_long' }, 'chat')).toMatchObject({
      resign: false,
      report: true,
      toast: 'world_chat.send_failed',
    })
  })

  test('a refused CHAT send always tells the player; a refused POSITION never toasts (it would be a spam cannon)', () => {
    expect(courier_refusal({ status: 429, code: 'rate_limited' }, 'chat').toast).toBe('world_chat.send_rate_limited')
    expect(courier_refusal({ status: 429, code: 'rate_limited' }, 'position').toast).toBe(null)
    expect(courier_refusal({ status: 503, code: 'store_down' }, 'position')).toMatchObject({
      report: true,
      toast: null,
    })
  })

  test('an error with no wire reason at all still names itself', () => {
    expect(courier_refusal(new Error('network down'), 'chat')).toMatchObject({ status: 0, code: 'unknown' })
  })
})

describe('presence SSE courier rows', () => {
  test('position rows enter the established peer-position fold shape', () => {
    const inputs = courier_inputs({ type: 'position', character: 'character-a', x: -12, z: 44, heading: 1.5 })
    expect(inputs).toEqual([{ type: 'peer_pos', id: 'character-a', x: -12, y: 44, yw: 1.5 }])
  })

  test('chat rows enter chat_received; party rows are receiver-filtered on the current party', () => {
    const inputs = [
      ...courier_inputs({
        type: 'chat',
        character: 'character-a',
        address: 'address-a',
        text: 'hello',
        channel: 'CHAT_GENERAL',
      }),
      ...courier_inputs(
        {
          type: 'chat',
          character: 'character-b',
          address: 'address-b',
          text: 'foreign party',
          channel: 'CHAT_GROUP',
          party: 'party-b',
        },
        'party-a'
      ),
      ...courier_inputs(
        {
          type: 'chat',
          character: 'character-c',
          address: 'address-c',
          text: 'our party',
          channel: 'CHAT_GROUP',
          party: 'party-a',
        },
        'party-a'
      ),
    ]

    expect(inputs).toEqual([
      {
        type: 'chat_received',
        row: {
          id: 'character-a',
          message: 'hello',
          address: 'address-a',
          name: '',
          channel: 'CHAT_GENERAL',
          target: '',
        },
      },
      {
        type: 'chat_received',
        row: {
          id: 'character-c',
          message: 'our party',
          address: 'address-c',
          name: '',
          channel: 'CHAT_GROUP',
          target: '',
        },
      },
    ])
  })

  test('an initial registry snapshot folds every live position', () => {
    const inputs = courier_inputs({
      type: 'positions',
      positions: [
        { type: 'position', character: 'a', x: 1, z: 2, heading: 0 },
        { type: 'position', character: 'b', x: 3, z: 4, heading: -1 },
      ],
    })
    expect(inputs.map(({ id }) => id)).toEqual(['a', 'b'])
  })
})
