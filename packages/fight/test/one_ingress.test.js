// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// M2b — ONE INGRESS (#291). The trace-corpus acceptance: receipts and journal pages are ONE ordered log
// folded through ONE door (the accept machine, keyed `(fight_id, seq)`), and the 4s snapshot is DEMOTED to a
// bootstrap base + a live-fight checkpoint — never a state source that overwrites the fold.
//
// The property (the idempotence of #290 extended to the WHOLE ingress): whatever order the two transports and a
// stale snapshot arrive in — receipt-first, journal-first, interleaved, DUPLICATED, out of order — the committed
// fold is BYTE-IDENTICAL. A snapshot arriving mid-fight NEVER changes the fold. And a fight BOOTSTRAPPED from a
// snapshot + backfilled from the journal converges to the same state as one folded from the journal from zero.

import { describe, expect, test } from 'bun:test'

import { create_fight_store, committed_state } from '../src/store.js'
import { state_hash } from '../src/inputs.js'

const FIGHT = '0xf1647'
const ME = '0xchar_a'
const T0 = 1_000_000
const PKG = '0xpkg::fight_events::'

const participant = (character, cell, over = {}) => ({
  owner: '0xa11ce',
  character,
  class: 'warrior',
  team: 0,
  hp: 50,
  max_hp: 50,
  ap: 12,
  mp: 3,
  base_ap: 12,
  base_mp: 3,
  cell,
  ready: true,
  casts_this_turn: 0,
  weapon: null,
  ...over,
})

const mob = (cell, over = {}) => ({ template: '0xmob_t', level: 3, hp: 20, max_hp: 20, cell, ap: 6, mp: 3, ...over })

const fight_object = (over = {}) => ({
  id: FIGHT,
  status: 1,
  width: 20,
  height: 19,
  participants: [participant(ME, 21)],
  group_template: '0xmob_t',
  group_base_ap: 6,
  group_base_mp: 3,
  mobs: [mob(45)],
  obstacles: [],
  holes: [],
  shape_mask: [],
  start_cells_a: [21, 22],
  start_cells_b: [],
  turn_ptr: 0,
  queue: [],
  turn_deadline_ms: 0,
  placement_deadline_ms: 0,
  world_seed: null,
  spawn_id: null,
  last_action_ms: 0,
  ...over,
})

// The ONE canonical event stream, fullnode-shaped (u32 numbers) — a mob's whole turn: it walks, strikes me, ends.
// Each entry carries its authoritative `seq` (per-fight ordinal) and the `version` of the tx that emitted it.
// A mob turn keeps MY prediction overlay out of the picture, isolating the pure canonical fold under test.
const STREAM = [
  { seq: '0', version: '2', kind: 'TurnStarted', data: { fight: FIGHT, is_mob: true, idx: 0, deadline_ms: 0 } },
  { seq: '1', version: '2', kind: 'MobMoved', data: { fight: FIGHT, idx: 0, to_cell: 44 } },
  { seq: '2', version: '3', kind: 'Cast', data: { fight: FIGHT, caster_is_mob: true, caster_idx: 0, target_cell: 21 } },
  {
    seq: '3',
    version: '3',
    kind: 'Hit',
    data: {
      fight: FIGHT,
      victim_is_mob: false,
      victim_idx: 0,
      amount: 6,
      remaining_hp: 44,
      caster_is_mob: true,
      caster_idx: 0,
    },
  },
  { seq: '4', version: '3', kind: 'TurnEnded', data: { fight: FIGHT, is_mob: true, idx: 0 } },
]

// A journal PAGE ({ fight, events:[{ seq, kind, data, version }], journal_head }) — the M1 read wire shape.
const journal_page = (rows, journal_head = String(rows.length)) => ({
  type: 'journal',
  fight_id: FIGHT,
  page: {
    fight: FIGHT,
    events: rows.map((r) => ({ seq: r.seq, kind: r.kind, data: r.data, digest: '0xdig', version: r.version })),
    journal_head,
  },
})

// A tx RECEIPT ({ events:[{ type, parsedJson }] }) carrying the SAME logical events — no seq (the accept machine
// assigns them optimistically from its head). `parsedJson` is byte-identical to the journal's `data`, so a receipt
// event and its journal twin hash EQUAL (content_key) and the accept machine makes the later of the two a no-op.
const receipt = (rows, version) => ({
  type: 'receipt',
  fight_id: FIGHT,
  version,
  receipt: { version, digest: '0xdig', events: rows.map((r) => ({ type: PKG + r.kind, parsedJson: r.data })) },
})

// A stale mid-fight OBJECT read that DISAGREES with the fold (mob elsewhere, my hp lower) at a fresh version — the
// exact snapshot whose adoption used to rewrite committed truth. Under M2b it is a checkpoint, never a state source.
const stale_snapshot = (version) => ({
  type: 'snapshot',
  fight_id: FIGHT,
  version,
  fight: fight_object({ mobs: [mob(60, { hp: 3 })], participants: [participant(ME, 21, { hp: 12 })] }),
})

/** A store bootstrapped from the opening snapshot (v1, an empty journal) — the base every arrival order shares. */
const booted = () => {
  const store = create_fight_store()
  store
    .getState()
    .input(
      { type: 'init', fight_id: FIGHT, ctx: { my_entity_id: ME, address: '0xa11ce', beat_ctx: { grid_width: 20 } } },
      T0
    )
  store.getState().input({ type: 'snapshot', fight: fight_object(), version: 1, journal_head: '0' }, T0 + 10)
  return store
}

const drive = (inputs) => {
  const store = booted()
  inputs.forEach((msg, i) => store.getState().input(msg, T0 + 100 + i * 10))
  return store
}

const committed_hash = (store) => state_hash(committed_state(store.getState()))

describe('M2b — one ingress: the fold is invariant to arrival order (idempotence #290 → full ingress)', () => {
  // The reference: the whole stream folded once, in order, through the receipt door.
  const reference = committed_hash(drive([receipt(STREAM, '3')]))

  test('the mob turn folds — mob walked to 44, my hp is 44, the turn is over', () => {
    const committed = committed_state(drive([receipt(STREAM, '3')]).getState())
    expect(committed.fighters.m0.cell).toBe(44)
    expect(committed.fighters.p0.hp).toBe(44)
    expect(committed.active).toBeNull()
  })

  test('JOURNAL-ONLY converges to the same fold as receipt-only', () => {
    expect(committed_hash(drive([journal_page(STREAM)]))).toBe(reference)
  })

  test('RECEIPT then a full JOURNAL redelivery is idempotent (the journal page is a silent no-op)', () => {
    expect(committed_hash(drive([receipt(STREAM, '3'), journal_page(STREAM)]))).toBe(reference)
  })

  test('JOURNAL then a RECEIPT redelivery is idempotent (the receipt is a silent no-op)', () => {
    expect(committed_hash(drive([journal_page(STREAM), receipt(STREAM, '3')]))).toBe(reference)
  })

  test('INTERLEAVED + DUPLICATED (receipt tx1, journal tx1, receipt whole, journal whole) converges', () => {
    const tx1 = STREAM.slice(0, 2)
    expect(
      committed_hash(drive([receipt(tx1, '2'), journal_page(tx1, '5'), receipt(STREAM, '3'), journal_page(STREAM)]))
    ).toBe(reference)
  })

  test('a mid-fight SNAPSHOT never changes the fold (adoption is dead — checkpoint only)', () => {
    const with_snapshot = committed_hash(drive([receipt(STREAM, '3'), stale_snapshot(9)]))
    expect(with_snapshot, 'the stale object read must not rewrite committed truth').toBe(reference)
  })

  test('a stale SNAPSHOT interleaved anywhere is inert to the fold', () => {
    expect(
      committed_hash(
        drive([stale_snapshot(9), receipt(STREAM.slice(0, 2), '2'), stale_snapshot(10), journal_page(STREAM)])
      )
    ).toBe(reference)
  })

  test('BOOTSTRAP-from-snapshot + journal backfill == journal-from-zero', () => {
    // Bootstrap a client that JOINS after tx1 already happened: its opening snapshot reflects tx1 (journal_head 2),
    // then it backfills the journal TAIL (tx2, seq 2..4). It must converge to the from-zero fold.
    const store = create_fight_store()
    store
      .getState()
      .input(
        { type: 'init', fight_id: FIGHT, ctx: { my_entity_id: ME, address: '0xa11ce', beat_ctx: { grid_width: 20 } } },
        T0
      )
    // The join snapshot already reflects tx1's result — the mob has moved to 44 and is MID-TURN (its TurnStarted is
    // seq 0, below the seeded head), so the authoritative object shows the mob active; the log extends to seq 2.
    store.getState().input(
      {
        type: 'snapshot',
        fight: fight_object({ mobs: [mob(44)], queue: [{ is_mob: true, idx: 0 }] }),
        version: 2,
        journal_head: '2',
      },
      T0 + 10
    )
    // Backfill only the TAIL the snapshot did not already fold (seq 2..4); seq 0..1 are below the seeded head.
    store.getState().input(journal_page(STREAM.slice(2), '5'), T0 + 100)
    expect(committed_hash(store)).toBe(reference)
  })

  test('OUT-OF-ORDER journal pages: the tail page waits on the gap, the fold converges once the gap fills', () => {
    // The tail page (seq 2..4) arrives BEFORE the head page (seq 0..1): the accept machine holds it behind the gap
    // (nothing folds past a hole), then the head page fills seq 0..1 and its re-walk delivers the tail contiguously.
    const store = drive([journal_page(STREAM.slice(2), '5'), journal_page(STREAM, '5')])
    expect(committed_hash(store)).toBe(reference)
  })
})
