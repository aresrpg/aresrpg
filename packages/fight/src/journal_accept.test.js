// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// THE ACCEPT MACHINE (M2a, #291) — contiguity · idempotence · protocol-fault, all as DATA. RED-first:
// against a stub that accepts everything and emits nothing, the contiguity (gap→fetch) and fault
// (divergent redelivery→fault event) cases fail for the right reason — the reconciliation is absent.

import { describe, expect, test } from 'bun:test'

import { normalize_journal_page } from './journal_normalize.js'
import { accept_batch, empty_accept_state, seed_accept_state } from './journal_accept.js'

const FIGHT = '0xf1647' // house-synthetic ids (chain-id gate) — never a live 0x…64 object id
const CHAR = '0xchar_a'
const COURTESY_EVENT_BASE = 1_000_000

// Captured-wire VALUE shapes (packages/rpc/indexer/src/handlers/ares/journal_tests.rs); ids synthetic above.
const hit = (remaining_hp = '10') => ({
  kind: 'Hit',
  data: { fight: FIGHT, victim_is_mob: true, victim_idx: '0', amount: '7', remaining_hp },
})
const moved = (to_cell = '64') => ({ kind: 'Moved', data: { fight: FIGHT, character: CHAR, to_cell } })

/** An M1 page of the given `{kind,data}` events starting at `from`, then its normalized batch. */
const page = (from, events, head = from + events.length) => ({
  fight: FIGHT,
  journal_head: String(head),
  events: events.map((e, i) => ({
    seq: from + i,
    ...e,
    digest: `tx-${from + i}`,
    version: String(348_000_000 + from + i),
  })),
})
const batch = (from, events, head) => normalize_journal_page(page(from, events, head))

const effects_of = (kind) => (result) => result.effects.filter((e) => e.type === kind)

describe('accept machine — contiguity', () => {
  test('in-order events accept and emit one apply, head advances', () => {
    const { state, effects } = accept_batch(empty_accept_state(), batch(0, [moved(), hit(), moved('65')]))
    expect(state.head).toBe('2')
    const apply = effects_of('apply')({ effects })
    expect(apply.length).toBe(1)
    expect(apply[0].events.map((e) => e.seq)).toEqual(['0', '1', '2'])
    expect(effects_of('fetch_gap')({ effects }).length).toBe(0)
  })

  test('a gap below the batch yields a fetch_gap and applies NOTHING past it', () => {
    // empty state expects seq 0; a batch that starts at 2 is a gap.
    const { state, effects } = accept_batch(empty_accept_state(), batch(2, [hit(), hit('8')]))
    expect(effects_of('fetch_gap')({ effects })).toEqual([{ type: 'fetch_gap', fight_id: FIGHT, from: '0' }])
    expect(effects_of('apply')({ effects }).length).toBe(0)
    expect(state.head).toBe(null) // never applied past the gap
  })

  test('a gap above an established head requests exactly head+1', () => {
    const seeded = accept_batch(empty_accept_state(), batch(0, [moved(), hit(), moved()])).state // head '2'
    const { state, effects } = accept_batch(seeded, batch(5, [hit()]))
    expect(effects_of('fetch_gap')({ effects })).toEqual([{ type: 'fetch_gap', fight_id: FIGHT, from: '3' }])
    expect(state.head).toBe('2')
  })

  test('an overlapping batch re-delivers accepted seqs (no-op) and applies only the new tail', () => {
    const first = accept_batch(empty_accept_state(), batch(0, [moved(), hit(), moved('65')])).state // head '2'
    // seqs 1,2 re-delivered byte-identical; 3,4 are new.
    const { state, effects } = accept_batch(first, batch(1, [hit(), moved('65'), hit('8'), moved('66')]))
    expect(state.head).toBe('4')
    const apply = effects_of('apply')({ effects })
    expect(apply[0].events.map((e) => e.seq)).toEqual(['3', '4'])
    expect(effects_of('protocol_fault')({ effects }).length).toBe(0)
  })
})

describe('accept machine — idempotence', () => {
  test('re-delivering the same batch 3× interleaved is byte-identical (no apply, no fault)', () => {
    const one = batch(0, [moved(), hit(), moved('65')])
    const after_first = accept_batch(empty_accept_state(), one)
    // interleave: replay the whole page twice more.
    const replay_a = accept_batch(after_first.state, one)
    const replay_b = accept_batch(replay_a.state, batch(0, [moved(), hit(), moved('65')]))
    expect(replay_a.state).toEqual(after_first.state)
    expect(replay_b.state).toEqual(after_first.state)
    expect(replay_a.effects).toEqual([]) // nothing new to apply, nothing wrong
    expect(replay_b.effects).toEqual([])
  })

  test('a partial re-delivery straddling the head applies only the genuinely-new suffix once', () => {
    const s0 = accept_batch(empty_accept_state(), batch(0, [moved(), hit()])).state // head '1'
    const s1 = accept_batch(s0, batch(0, [moved(), hit(), moved('65')])) // re-sends 0,1 + new 2
    expect(s1.state.head).toBe('2')
    expect(effects_of('apply')(s1)[0].events.map((e) => e.seq)).toEqual(['2'])
    // sending it AGAIN now is a pure no-op.
    const s2 = accept_batch(s1.state, batch(0, [moved(), hit(), moved('65')]))
    expect(s2.effects).toEqual([])
  })
})

describe('accept machine — protocol fault', () => {
  test('a canonical event at the courtesy lane base is refused and recorded as a fault', () => {
    const before = seed_accept_state(COURTESY_EVENT_BASE)
    const result = accept_batch(before, batch(COURTESY_EVENT_BASE, [moved()]))
    const faults = effects_of('protocol_fault')(result)

    expect(faults).toHaveLength(1)
    expect(faults[0]).toMatchObject({
      type: 'protocol_fault',
      fight_id: FIGHT,
      seq: String(COURTESY_EVENT_BASE),
      accepted: null,
      source: 'journal',
    })
    expect(faults[0].received).toEqual(expect.any(String))
    expect(result.state).toEqual(before)
    expect(effects_of('apply')(result)).toEqual([])
  })

  test('same seq, DIFFERENT content emits a fault as data and never overwrites accepted truth', () => {
    const accepted = accept_batch(empty_accept_state(), batch(0, [moved(), hit('10')])) // seq 1 = Hit remaining_hp 10
    const before = accepted.state
    const { state, effects } = accept_batch(before, batch(1, [hit('99')])) // seq 1 re-sent with remaining_hp 99
    const faults = effects_of('protocol_fault')({ effects })
    expect(faults.length).toBe(1)
    expect(faults[0]).toMatchObject({ type: 'protocol_fault', fight_id: FIGHT, seq: '1' })
    expect(faults[0].accepted).not.toBe(faults[0].received) // the divergence is reported as data
    expect(state.digests['1']).toBe(before.digests['1']) // accepted content unchanged — no forward rewrite
    expect(state.head).toBe(before.head)
    expect(effects_of('apply')({ effects }).length).toBe(0)
  })

  test('faults never throw — the return is always {state, effects}', () => {
    const accepted = accept_batch(empty_accept_state(), batch(0, [hit('10')])).state
    expect(() => accept_batch(accepted, batch(0, [hit('42')]))).not.toThrow()
  })
})

describe('accept machine — snapshot seed', () => {
  test('a snapshot at journalHead N resumes the cursor at N-1 and folds only the tail', () => {
    const seeded = seed_accept_state('5') // object already reflects events 0..4
    expect(seeded.head).toBe('4')
    // a re-delivery of a seeded (pre-N) seq is trusted (no stored digest) — silent no-op, no fault.
    const redeliver = accept_batch(seeded, batch(3, [hit()]))
    expect(redeliver.effects).toEqual([])
    // the genuine tail (seq 5 = head+1) applies.
    const tail = accept_batch(seeded, batch(5, [moved()]))
    expect(tail.state.head).toBe('5')
    expect(effects_of('apply')(tail)[0].events.map((e) => e.seq)).toEqual(['5'])
  })
})
