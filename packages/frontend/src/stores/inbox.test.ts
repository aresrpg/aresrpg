// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// inbox.test.ts — the ONE-PIPELINE reducer (M2 twin of the M1 shop template). Pure reducer tests (no React, no
// RPC, no zustand store) proving the three doctrine reds for CLIENT_DESIGN_AUDIT row #5: a stale 20s poll must
// never resurrect a just-claimed / just-recalled gift.
import { describe, test, expect } from 'bun:test'

import type { RpcInboxGift } from '../rpc/views'

import { reduce, empty_inbox_state, type InboxState } from './inbox'

const single_item = [{ item_id: 'i1', template_id: 't', name: 'Sword', appearance: '', category: 'weapon', level: 1 }]
const two_items = [
  ...single_item,
  { item_id: 'i2', template_id: 't2', name: 'Shield', appearance: '', category: 'armor', level: 1 },
]

const gift = (over: Partial<RpcInboxGift> & { gift_id: string }): RpcInboxGift => ({
  sender: '0xsender',
  sender_kiosk_id: '0xkiosk',
  recipient: '0xme',
  items: single_item,
  royalty_mist: '0',
  created_at_ms: 0,
  ...over,
})

const has_incoming = (st: InboxState, id: string) => st.incoming.some((g) => g.gift_id === id)
const has_outgoing = (st: InboxState, id: string) => st.outgoing.some((g) => g.gift_id === id)
const snap = (incoming: RpcInboxGift[], outgoing: RpcInboxGift[] = []) => ({
  type: 'snapshot' as const,
  incoming,
  outgoing,
})

describe('reduce — claim race (row #5): a stale snapshot must never resurrect a just-claimed gift', () => {
  test('RED #1: an optimistic claim holds through an indexer-lagged snapshot that still lists the gift', () => {
    let st = empty_inbox_state()
    st = reduce(st, snap([gift({ gift_id: 'X' })])).state
    st = reduce(st, { type: 'receipt', gift_id: 'X', kind: 'claim' }).state
    expect(has_incoming(st, 'X')).toBe(false) // optimistic hide
    // the reported bug: a STALE poll (indexer hasn't projected the claim) arrives, still listing the gift
    st = reduce(st, snap([gift({ gift_id: 'X' })])).state
    expect(has_incoming(st, 'X')).toBe(false) // held by the pending ledger — NOT resurrected
  })

  test('the pending row self-drains once a snapshot proves the claim (gift omitted)', () => {
    let st = empty_inbox_state()
    st = reduce(st, snap([gift({ gift_id: 'X' })])).state
    st = reduce(st, { type: 'receipt', gift_id: 'X', kind: 'claim' }).state
    st = reduce(st, snap([])).state // chain caught up — gone from the feed (OMIT SEMANTICS, same as M1's shop)
    expect(has_incoming(st, 'X')).toBe(false)
    expect(st.pending.X).toBeUndefined() // drained
  })
})

describe('reduce — recall race: the same law protects outgoing rows', () => {
  test('an optimistic recall holds through a stale snapshot that still lists the gift as outgoing', () => {
    let st = empty_inbox_state()
    st = reduce(st, snap([], [gift({ gift_id: 'Y' })])).state
    st = reduce(st, { type: 'receipt', gift_id: 'Y', kind: 'recall' }).state
    expect(has_outgoing(st, 'Y')).toBe(false)
    st = reduce(st, snap([], [gift({ gift_id: 'Y' })])).state // stale
    expect(has_outgoing(st, 'Y')).toBe(false) // held
  })
})

describe('reduce — receipt_failed rolls back by re-deriving (never a stored snapshot)', () => {
  test('RED #2: a failed claim restores the current snapshot base, not a stale pre-claim snapshot', () => {
    let st = empty_inbox_state()
    st = reduce(st, snap([gift({ gift_id: 'X' }), gift({ gift_id: 'Z' })])).state
    st = reduce(st, { type: 'receipt', gift_id: 'X', kind: 'claim' }).state
    expect(has_incoming(st, 'X')).toBe(false)
    // a concurrent poll lands WHILE the claim is in flight — proves the fix isn't a frozen-array replay
    st = reduce(st, snap([gift({ gift_id: 'X' }), gift({ gift_id: 'Z' }), gift({ gift_id: 'NEW' })])).state
    st = reduce(st, { type: 'receipt_failed', gift_id: 'X', kind: 'claim' }).state
    expect(has_incoming(st, 'X')).toBe(true) // re-derived from the CURRENT raw
    expect(has_incoming(st, 'NEW')).toBe(true) // the concurrent poll's fresh row survives — never wiped
    expect(st.pending.X).toBeUndefined()
  })
})

describe('reduce — divergence: still-pending content mismatch flags it (never resurrects the row)', () => {
  test('RED #3: a still-present gift whose contents shifted while pending is flagged, and stays held', () => {
    let st = empty_inbox_state()
    st = reduce(st, snap([gift({ gift_id: 'X' })])).state
    st = reduce(st, { type: 'receipt', gift_id: 'X', kind: 'claim' }).state
    const out = reduce(st, snap([gift({ gift_id: 'X', items: two_items })]))
    expect(out.divergence).not.toBeNull()
    expect(out.divergence?.predicted).toBe(1)
    expect(out.divergence?.snapshot).toBe(2)
    expect(has_incoming(out.state, 'X')).toBe(false) // still HELD — divergence is log-only, never resurrects
  })
})
