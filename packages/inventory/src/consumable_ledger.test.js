// Unit coverage of the consumable pending-delta ledger + trailing-click batcher (the PURE half of the
// rapid-use flow; the tx/toast wiring in consumable_actions.js is the live half). Proves the brief's bar:
// 5 rapid clicks fold into ONE flush carrying amount 5; a chain landing racing an in-flight batch renders
// chain − pending (never a bounce); a failed batch drains so the refetched chain truth restores the count;
// the LAST units mask the row away entirely (the cell removal D307c keys on); clicks during a flight form
// exactly one follow-up batch.
import { beforeEach, describe, expect, it } from 'bun:test'

import {
  add_pending,
  create_consume_batcher,
  drain_pending,
  mask_pending_items,
  pending_units,
  reset_pending,
} from './consumable_ledger.js'

const POTION = '0xp0'
const CHAR = '0xc0'
const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms))

beforeEach(() => reset_pending())

describe('pending ledger', () => {
  it('accumulates and drains per id, flooring at zero', () => {
    add_pending(POTION, 3)
    add_pending(POTION, 2)
    expect(pending_units(POTION)).toBe(5)
    drain_pending(POTION, 4)
    expect(pending_units(POTION)).toBe(1)
    drain_pending(POTION, 99)
    expect(pending_units(POTION)).toBe(0)
  })

  it('mask renders chain_amount − pending on a reconcile racing an active batch', () => {
    add_pending(POTION, 3)
    const chain = [
      { id: POTION, amount: 10 },
      { id: '0xother', amount: 4 },
    ]
    const masked = mask_pending_items(chain)
    expect(masked.find((i) => i.id === POTION)?.amount).toBe(7)
    // untouched rows pass through by reference (no pending on them)
    expect(masked.find((i) => i.id === '0xother')).toBe(chain[1])
  })

  it('mask drops a row whose last units are pending (cell removal, D307c)', () => {
    add_pending(POTION, 2)
    expect(mask_pending_items([{ id: POTION, amount: 2 }])).toEqual([])
    // amount absent on chain shape means 1
    add_pending('0xsingle', 1)
    expect(mask_pending_items([{ id: '0xsingle' }])).toEqual([])
  })

  it('failure restore: draining the failed batch hands the render back to chain truth', () => {
    add_pending(POTION, 5) // 5 optimistic clicks
    expect(mask_pending_items([{ id: POTION, amount: 5 }])).toEqual([])
    drain_pending(POTION, 5) // the batch failed — drained, nothing burned on chain
    expect(mask_pending_items([{ id: POTION, amount: 5 }])).toEqual([{ id: POTION, amount: 5 }])
  })
})

describe('trailing-click batcher', () => {
  it('folds 5 rapid clicks into ONE flush with amount 5, then drains', async () => {
    const calls = []
    const batcher = create_consume_batcher({ flush: async (args) => calls.push(args), delay: 10 })
    for (let i = 0; i < 5; i += 1) batcher.click({ character_id: CHAR, potion_id: POTION })
    expect(pending_units(POTION)).toBe(5) // instant optimistic delta, before any flush
    await tick(30)
    expect(calls).toEqual([{ character_id: CHAR, potion_id: POTION, amount: 5 }])
    expect(pending_units(POTION)).toBe(0) // settled → the mask defers to chain truth
  })

  it('clicks during a flight form exactly ONE follow-up batch', async () => {
    const calls = []
    let release
    const gate = new Promise((resolve) => {
      release = resolve
    })
    const batcher = create_consume_batcher({
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
    expect(pending_units(POTION)).toBe(5) // 2 in flight + 3 queued
    release()
    await tick(30) // flight settles → the trailing 3 fire as ONE second batch
    expect(calls).toEqual([
      { character_id: CHAR, potion_id: POTION, amount: 2 },
      { character_id: CHAR, potion_id: POTION, amount: 3 },
    ])
    expect(pending_units(POTION)).toBe(0)
  })

  it('a failed batch drains pending and reports once', async () => {
    const failures = []
    const batcher = create_consume_batcher({
      flush: async () => {
        throw new Error('nope')
      },
      on_failed: (_e, batch) => failures.push(batch),
      delay: 10,
    })
    for (let i = 0; i < 3; i += 1) batcher.click({ character_id: CHAR, potion_id: POTION })
    await tick(30)
    expect(failures).toEqual([{ potion_id: POTION, units: 3 }]) // ONE report → ONE toast
    expect(pending_units(POTION)).toBe(0) // drained → the authoritative refetch restores the count
  })

  it('reports success through on_settled with the flush result', async () => {
    const settles = []
    const batcher = create_consume_batcher({
      flush: async () => ({ ok: true }),
      on_settled: (out, batch) => settles.push([out, batch]),
      delay: 10,
    })
    batcher.click({ character_id: CHAR, potion_id: POTION })
    await tick(30)
    expect(settles).toEqual([[{ ok: true }, { potion_id: POTION, units: 1 }]])
  })
})
