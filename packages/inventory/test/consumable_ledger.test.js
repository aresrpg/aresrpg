// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Unit coverage of the consumable pending-delta ledger + trailing-click batcher (the PURE half of the
// rapid-use flow; the tx/toast wiring in consumable_actions.js is the live half). Proves the brief's bar:
// 5 rapid clicks fold into ONE flush carrying amount 5; a chain landing racing an in-flight batch renders
// chain − pending (never a bounce); a failed batch drains so the refetched chain truth restores the count;
// the LAST units mask the row away entirely (the cell removal D307c keys on); clicks during a flight form
// exactly one follow-up batch.
//
// The ledger is a plain record the REDUCER owns (`sui.pending_uses`); these transforms are records in, records
// out, and the batcher only REPORTS its deltas. The `fold` helper below stands in for the reducer's two ops.
import { describe, expect, it } from 'bun:test'

import {
  add_pending_units,
  create_consume_batcher,
  drain_pending_units,
  mask_pending_items,
  pending_units,
} from '../src/consumable_ledger.js'

const POTION = '0xp0'
const CHAR = '0xc0'
const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms))

/** The reducer's door, in miniature: the batcher reports deltas, this folds them into the owned ledger. */
const fold = () => {
  let ledger = {}
  return {
    on_pending: (id, units) => (ledger = add_pending_units(ledger, id, units)),
    on_drain: (id, units) => (ledger = drain_pending_units(ledger, id, units)),
    units: (id) => pending_units(ledger, id),
  }
}

describe('pending ledger', () => {
  it('accumulates and drains per id, flooring at zero', () => {
    let ledger = add_pending_units({}, POTION, 3)
    ledger = add_pending_units(ledger, POTION, 2)
    expect(pending_units(ledger, POTION)).toBe(5)
    ledger = drain_pending_units(ledger, POTION, 4)
    expect(pending_units(ledger, POTION)).toBe(1)
    ledger = drain_pending_units(ledger, POTION, 99)
    expect(pending_units(ledger, POTION)).toBe(0)
    expect(ledger, 'a fully drained id leaves no key behind').toEqual({})
  })

  it('mask renders chain_amount − pending on a reconcile racing an active batch', () => {
    const ledger = add_pending_units({}, POTION, 3)
    const chain = [
      { id: POTION, amount: 10 },
      { id: '0xother', amount: 4 },
    ]
    const masked = mask_pending_items(chain, ledger)
    expect(masked.find((i) => i.id === POTION)?.amount).toBe(7)
    // untouched rows pass through by reference (no pending on them)
    expect(masked.find((i) => i.id === '0xother')).toBe(chain[1])
  })

  it('an empty ledger is a pass-through (same ref — the common path costs nothing)', () => {
    const chain = [{ id: POTION, amount: 10 }]
    expect(mask_pending_items(chain, {})).toBe(chain)
    expect(mask_pending_items(chain, undefined)).toBe(chain)
  })

  it('mask drops a row whose last units are pending (cell removal, D307c)', () => {
    expect(mask_pending_items([{ id: POTION, amount: 2 }], add_pending_units({}, POTION, 2))).toEqual([])
    // amount absent on chain shape means 1
    expect(mask_pending_items([{ id: '0xsingle' }], add_pending_units({}, '0xsingle', 1))).toEqual([])
  })

  it('failure restore: draining the failed batch hands the render back to chain truth', () => {
    const claimed = add_pending_units({}, POTION, 5) // 5 optimistic clicks
    expect(mask_pending_items([{ id: POTION, amount: 5 }], claimed)).toEqual([])
    const drained = drain_pending_units(claimed, POTION, 5) // the batch failed — nothing burned on chain
    expect(mask_pending_items([{ id: POTION, amount: 5 }], drained)).toEqual([{ id: POTION, amount: 5 }])
  })
})

describe('trailing-click batcher', () => {
  it('folds 5 rapid clicks into ONE flush with amount 5, then drains', async () => {
    const calls = []
    const ledger = fold()
    const batcher = create_consume_batcher({ ...ledger, flush: async (args) => calls.push(args), delay: 10 })
    for (let i = 0; i < 5; i += 1) batcher.click({ character_id: CHAR, potion_id: POTION })
    expect(ledger.units(POTION)).toBe(5) // instant optimistic delta, before any flush
    await tick(30)
    expect(calls).toEqual([{ character_id: CHAR, potion_id: POTION, amount: 5 }])
    expect(ledger.units(POTION)).toBe(0) // settled → the mask defers to chain truth
  })

  it('clicks during a flight form exactly ONE follow-up batch', async () => {
    const calls = []
    let release
    const gate = new Promise((resolve) => {
      release = resolve
    })
    const ledger = fold()
    const batcher = create_consume_batcher({
      ...ledger,
      flush: async (args) => {
        calls.push(args)
        if (calls.length === 1) await gate // hold the first flight open
      },
      delay: 10,
    })
    batcher.click({ character_id: CHAR, potion_id: POTION })
    batcher.click({ character_id: CHAR, potion_id: POTION })
    await tick(20) // first batch (2) is now in flight, gated
    expect(calls.length).toBe(1)
    batcher.click({ character_id: CHAR, potion_id: POTION })
    batcher.click({ character_id: CHAR, potion_id: POTION })
    batcher.click({ character_id: CHAR, potion_id: POTION })
    expect(ledger.units(POTION)).toBe(5) // 2 in flight + 3 queued
    release()
    await tick(30) // flight settles → the trailing 3 fire as ONE second batch
    expect(calls).toEqual([
      { character_id: CHAR, potion_id: POTION, amount: 2 },
      { character_id: CHAR, potion_id: POTION, amount: 3 },
    ])
    expect(ledger.units(POTION)).toBe(0)
  })

  it('a failed batch drains pending and reports once', async () => {
    const failures = []
    const ledger = fold()
    const batcher = create_consume_batcher({
      ...ledger,
      flush: async () => {
        throw new Error('nope')
      },
      on_failed: (_e, batch) => failures.push(batch),
      delay: 10,
    })
    for (let i = 0; i < 3; i += 1) batcher.click({ character_id: CHAR, potion_id: POTION })
    await tick(30)
    expect(failures).toEqual([{ potion_id: POTION, units: 3 }]) // ONE report → ONE toast
    expect(ledger.units(POTION)).toBe(0) // drained → the authoritative refetch restores the count
  })

  it('reports success through on_settled with the flush result', async () => {
    const settles = []
    const batcher = create_consume_batcher({
      ...fold(),
      flush: async () => ({ ok: true }),
      on_settled: (out, batch) => settles.push([out, batch]),
      delay: 10,
    })
    batcher.click({ character_id: CHAR, potion_id: POTION })
    await tick(30)
    expect(settles).toEqual([[{ ok: true }, { potion_id: POTION, units: 1 }]])
  })
})
