// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//
// THE PRESENCE WIRE GATE — the frames pinned here are the ones packages/rpc/indexer/src/stream.rs actually
// emits (#1382): a `current-set` carrying `{ world, presence: [...] }`, then `join` / `leave` carrying ONE
// `PresenceRecord` `{ world, address?, character? }`. An adapter that guesses a different field name folds an
// empty world in production while every test still passes — so the record shape, the required query, and the
// finite give-up are asserted here, not the adapter's own invention.

import { describe, expect, test } from 'bun:test'
import { REJOIN_MAX_ATTEMPTS, create_presence_store, online_state_by_address } from '@aresrpg/world/presence'

import { open_presence_stream } from '../../src/world-shell/presence_sse_adapter.js'

const WORLD = '0xworld'
const ALICE = { world: WORLD, address: '0xalice', character: '0xa' }
const BOB = { world: WORLD, address: '0xbob', character: '0xb' }

class FakeEventSource {
  static latest = null

  constructor(url) {
    this.url = url
    this.readyState = 0
    this.listeners = new Map()
    FakeEventSource.latest = this
  }

  addEventListener(type, listener) {
    this.listeners.set(type, listener)
  }

  emit(type, data) {
    this.listeners.get(type)?.({ data: JSON.stringify(data) })
  }

  fail() {
    this.onerror?.()
  }

  close() {
    this.readyState = 2
  }
}

const boot = (options = {}) => {
  const store = create_presence_store()
  const statuses = []
  const close = open_presence_stream({
    world: WORLD,
    address: ALICE.address,
    character: ALICE.character,
    input: (message, now) => store.getState().input(message, now),
    event_source_factory: (url) => new FakeEventSource(url),
    base_url: 'https://rpc.test',
    set_status: (status, error) => statuses.push([status, error]),
    ...options,
  })
  return { store, statuses, close, source: () => FakeEventSource.latest }
}

describe('presence EventSource adapter → the presence door', () => {
  test('the connection registers itself: the world is the path, address and character are the query', () => {
    const { source, close } = boot()
    const url = new URL(source().url)
    expect(url.pathname).toBe(`/v1/stream/presence/${WORLD}`)
    expect(url.searchParams.get('address')).toBe(ALICE.address)
    expect(url.searchParams.get('character')).toBe(ALICE.character)
    close()
  })

  test('a current-set replaces the world, a join adds, a leave removes — keyed by the record character', () => {
    const { store, source, close } = boot()

    source().emit('current-set', { world: WORLD, presence: [ALICE] })
    expect(online_state_by_address(store.getState(), ALICE.address)?.id).toBe(ALICE.character)

    source().emit('join', BOB)
    expect(online_state_by_address(store.getState(), BOB.address)?.id).toBe(BOB.character)

    source().emit('leave', ALICE)
    expect(online_state_by_address(store.getState(), ALICE.address)).toBeNull()
    expect(online_state_by_address(store.getState(), BOB.address)?.id).toBe(BOB.character)

    // the set is server-authored: a fresh snapshot is the whole truth, not a merge
    source().emit('current-set', { world: WORLD, presence: [ALICE] })
    expect(online_state_by_address(store.getState(), BOB.address)).toBeNull()
    expect(store.getState().peers.size).toBe(0) // position peers are a different table entirely
    close()
  })

  test('an address-only (spectating) connection still folds — the wallet is its identity', () => {
    const { store, source, close } = boot()
    source().emit('current-set', { world: WORLD, presence: [{ world: WORLD, address: '0xghost' }] })
    expect(online_state_by_address(store.getState(), '0xghost')?.id).toBe('0xghost')
    close()
  })

  test('the retry budget is finite: the source is CLOSED and the failure is surfaced, never an immortal loop', () => {
    const { statuses, source, close } = boot()
    for (let attempt = 0; attempt <= REJOIN_MAX_ATTEMPTS; attempt++) source().fail()
    expect(source().readyState).toBe(2)
    const [status, error] = statuses.at(-1)
    expect(status).toBe('failed')
    expect(error).toContain(String(REJOIN_MAX_ATTEMPTS + 1))
    close()
  })
})
