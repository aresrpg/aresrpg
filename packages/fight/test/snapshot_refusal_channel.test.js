// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #1689 — A REFUSED SNAPSHOT SPEAKS.
//
// `adopt_snapshot` correctly refuses a torn read (#1277's completeness gate) and a stale one (the ordering
// gates), but it refused by returning its input unchanged: `last_read.adopted` came back false with no reason
// attached, the store's door returned without a set, and the presentation could not tell "the object came back
// incomplete" from "this read is legitimately behind". Both render as a board that simply does not move.
//
// Failures flow as data (docs/CODE_LAW.md): the door now names WHY. Every refusal lands on the store's
// rejections channel (`state.refused`, the same one the provider/session gate writes) with a typed reason, and
// the TORN class — a decoded record that is not whole — also lands on the core's `failures` channel, because
// that one is a fault rather than ordering. Routine behind/unchanged refusals deliberately stay OFF `failures`:
// a 4s poll would otherwise grow that array forever.

import { describe, expect, test } from 'bun:test'

import { create_fight_store } from '../src/store.js'

const FIGHT_ID = 'f1689'

/** A whole decoded Fight — real BoardGeom AND the lifecycle scalar (`fight_read_complete`). */
const whole = {
  width: 12,
  height: 12,
  status: 1,
  participants: [{ character: '0xa', cell: '5', hp: '70', ap: '6', mp: '3' }],
  mobs: [],
}

/** THE TORN READ (#1277): a record carrying a board but no `status`. There is no honest value to invent. */
const torn = { width: 12, height: 12, participants: whole.participants, mobs: [] }

const opened = () => {
  const store = create_fight_store()
  store.getState().input({ type: 'init', fight_id: FIGHT_ID, my_key: null, ctx: {} })
  store.getState().input({ type: 'snapshot', fight: whole, version: 200, fight_id: FIGHT_ID })
  expect(store.getState().view_version).toBe(200)
  expect(store.getState().refused).toBe(null)
  return store
}

describe('#1689 — the adoption door refuses out loud', () => {
  test('a TORN read surfaces as a typed refusal, never as silence', () => {
    const store = opened()
    store.getState().input({ type: 'snapshot', fight: torn, version: 300, fight_id: FIGHT_ID })
    const state = store.getState()
    expect(state.refused).toMatchObject({ type: 'snapshot', reason: 'torn', version: 300 })
    // and it is a FAULT, not ordering — the core records it beside the hash conflicts.
    expect(state.core.failures.at(-1)).toMatchObject({ kind: 'torn_read', version: 300 })
    // the refusal changes nothing else: the adopted base is exactly where it was.
    expect(state.view_version).toBe(200)
    expect(state.view.escrow).toHaveLength(1)
  })

  test('a BEHIND read is refused with its own reason — distinguishable from torn at the presentation layer', () => {
    const store = opened()
    store.getState().input({ type: 'snapshot', fight: whole, version: 100, fight_id: FIGHT_ID })
    const state = store.getState()
    expect(state.refused).toMatchObject({ type: 'snapshot', reason: 'behind', version: 100 })
    expect(state.view_version).toBe(200)
  })

  test('routine refusals stay OFF the unbounded failures channel — only faults land there', () => {
    const store = opened()
    const before = store.getState().core.failures.length
    for (let poll = 0; poll < 5; poll += 1)
      store.getState().input({ type: 'snapshot', fight: whole, version: 100 + poll, fight_id: FIGHT_ID })
    expect(store.getState().refused.reason).toBe('behind')
    expect(store.getState().core.failures.length).toBe(before)
  })

  // `refused` is a LATCH (the last refusal, whenever it happened — its `at` is how a reader judges freshness);
  // `core.last_read.refusal` is the LEVEL-triggered per-read fact, and that is the one a "syncing / torn /
  // behind" indicator reads, because an accepted read clears it by construction.
  test('the per-read reason is about THIS read — an accepted snapshot carries none', () => {
    const store = opened()
    store.getState().input({ type: 'snapshot', fight: torn, version: 300, fight_id: FIGHT_ID })
    expect(store.getState().core.last_read.refusal).toEqual({ reason: 'torn' })
    expect(store.getState().core.last_read.adopted).toBe(false)
    store.getState().input({ type: 'snapshot', fight: { ...whole, status: 3 }, version: 400, fight_id: FIGHT_ID })
    expect(store.getState().view_version).toBe(400)
    expect(store.getState().core.last_read.refusal).toBe(null)
    expect(store.getState().core.last_read.adopted).toBe(true)
  })
})
