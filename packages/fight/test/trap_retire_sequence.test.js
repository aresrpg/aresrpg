// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// trap_retire_sequence.test.js — #1219, THE REGRESSION #1213 SHIPPED.
//
// #1213 widened `my_traps` retirement from the mover's LANDED cell to every cell its committed walk ENTERED,
// which is what a mid-path detonation requires (#954). It compared those entries by VERSION alone — and a
// player's whole turn commits as ONE receipt at ONE version, so a walk and a trap cast in that same turn are
// indistinguishable by version. Walk through X, then drop a trap on X: the walk that happened BEFORE the trap
// existed retired it on arrival. The trap never rendered.
//
// Retirement must therefore be SEQUENCE-aware, not merely version-aware: a committed movement retires a trap
// only when it crosses the cell AT OR AFTER the trap's own placement point in the log. The log is already keyed
// `(version, event_idx)` (fold.js `entry_key`) and the placement is the `Cast` row that targeted the anchor, so
// the ordering is read off the receipts — no new state home.
//
// The direction of the error matters: this fold "errs toward it stays" (a FALSELY retired trap makes the next
// cast abort `ECellAlreadyTrapped` and nukes the batch), so a placement whose row is not in the current tail
// keeps the old, permissive behaviour rather than inventing an ordering it cannot see.

import { describe, expect, test } from 'bun:test'

import { create_fight_store } from '../src/store.js'
import { engine_view } from '../src/project.js'
import { produce_receipt_render_turns } from '../src/fight_render_events.js'

const FIGHT = '0xf1'
const CHAR = '0xc1'
const W = 20
const enc = (x, y) => y * W + x
const START = enc(5, 5)
const X = enc(8, 5) // a cell the walk crosses AND the trap later takes
const PAST_X = enc(10, 5)
const MOB = enc(14, 5)

const ev = (kind, fields) => ({ type: `0x0::fight_events::${kind}`, parsedJson: { fight: FIGHT, ...fields } })

const FIGHT_OBJECT = {
  id: FIGHT,
  status: 1,
  width: W,
  height: 19,
  participants: [
    {
      owner: '0xaaa',
      character: CHAR,
      class: 'senshi',
      team: 0,
      ap: 9,
      mp: 6,
      base_ap: 9,
      base_mp: 6,
      hp: 50,
      max_hp: 50,
      cell: START,
    },
  ],
  mobs: [{ template: '0xabc', hp: 200, max_hp: 200, cell: MOB, ap: 4, mp: 4, level: 1 }],
  queue: [{ is_mob: false, idx: 0 }],
  turn_ptr: 0,
  turn_deadline_ms: 90_000,
  turn_entropy: 90_000,
  turn_ordinal: 1,
}

const boot = () => {
  const store = create_fight_store()
  store
    .getState()
    .input({ type: 'init', fight_id: FIGHT, my_key: 'p0', ctx: { my_entity_id: CHAR, beat_ctx: { grid_width: W } } })
  store.getState().input({ type: 'snapshot', fight: FIGHT_OBJECT, version: 5 }, 1_000)
  return store
}

/** Draft a trap onto `cell` — the optimistic write that owns `my_traps` (DungeonBoard's `optimistic_cast`). */
const draft_trap = (store, cell, intent_id = 'trap1', at = 1_100) =>
  store.getState().input(
    {
      type: 'predicted',
      basis_version: 6,
      intent_id,
      actions: [{ kind: 'Cast', caster_is_mob: false, caster_idx: 0, target_cell: cell, ap_cost: 2 }],
      beats: [{ kind: 'cast', at: 0, duration: 100, payload: {} }],
      place_traps: [cell],
    },
    at
  )

const commit = (store, events, version, at = 1_200) => {
  store.getState().input({ type: 'receipt', version, receipt: { events } }, at)
  for (const turn of store.getState().wave) {
    for (const [index, beat] of turn.beats.entries())
      if (beat.kind === 'trap_trigger')
        store.getState().input({
          type: 'trap_triggered',
          anchor: beat.payload.trap_anchor,
          cell: beat.payload.trap_cell,
          trigger_id: `wave:${turn.seq}:${index}`,
        })
    store.getState().input({ type: 'presented', seq: turn.seq }, at + 100)
  }
}

const traps_of = (store) => engine_view(store.getState()).my_traps

describe('#1219 — a trap outlives the walk that preceded it', () => {
  test('walk through X, THEN place a trap on X, same turn: the trap survives', () => {
    const store = boot()
    draft_trap(store, X)
    expect(traps_of(store)).toEqual([X])
    // ONE receipt, the turn's own order: the walk crossed X first, the trap took X after.
    commit(
      store,
      [
        ev('Moved', { character: CHAR, to_cell: PAST_X }),
        ev('Cast', { caster_is_mob: false, caster_idx: 0, target_cell: X }),
      ],
      7
    )
    expect(traps_of(store)).toEqual([X])
  })

  // CONTROL ② — the ordering guard must not become a blanket immunity: a crossing AFTER the placement still
  // detonates and consumes, which is the whole of #954.
  test('an enemy crossing X on a LATER receipt still retires it', () => {
    const store = boot()
    draft_trap(store, X)
    commit(
      store,
      [
        ev('Moved', { character: CHAR, to_cell: PAST_X }),
        ev('Cast', { caster_is_mob: false, caster_idx: 0, target_cell: X }),
      ],
      7
    )
    expect(traps_of(store)).toEqual([X])
    // the mob walks the clear column through X (nothing between it and its destination)
    commit(
      store,
      [ev('MobMoved', { idx: 0, to_cell: enc(8, 9) }), ev('MobMoved', { idx: 0, to_cell: enc(8, 2) })],
      8,
      1_400
    )
    expect(traps_of(store)).toEqual([])
  })

  // CONTROL ③ — the #1050 ruling, entrant-blind: I spring my OWN trap by walking over it on a later turn.
  test('placing then walking over my own trap on a later receipt still retires it', () => {
    const store = boot()
    draft_trap(store, X)
    commit(store, [ev('Cast', { caster_is_mob: false, caster_idx: 0, target_cell: X })], 7) // I stay at START
    expect(traps_of(store)).toEqual([X])
    commit(store, [ev('Moved', { character: CHAR, to_cell: PAST_X })], 8, 1_400) // 5,5 → 10,5 crosses 8,5
    expect(traps_of(store)).toEqual([])
  })

  // CONTROL — the SAME receipt, the other order: the trap was placed first and the walk crossed it after, so it
  // detonated. Sequence-awareness must read the order, not merely notice that both share a version.
  test('place on X then walk through X in ONE receipt: the trap detonates', () => {
    const store = boot()
    draft_trap(store, X)
    commit(
      store,
      [
        ev('Cast', { caster_is_mob: false, caster_idx: 0, target_cell: X }),
        ev('Moved', { character: CHAR, to_cell: PAST_X }),
      ],
      7
    )
    expect(traps_of(store)).toEqual([])
  })
})

// ── THE RENDER TWIN ────────────────────────────────────────────────────────────────────────────────────────
// The same blindness, one layer up. `my_traps` is written OPTIMISTICALLY at draft time, so by the moment the
// receipt is narrated the client's trap ledger already holds the cell — and #1213's walk-splitting matched it
// against a walk that had happened BEFORE the trap was cast. The player watched their own move stop mid-path
// and flash a detonation that never occurred. A trap whose placing `Cast` row sits LATER in this same receipt
// was not armed while that walk ran.
describe('#1219 render twin — a later cast never arms an earlier walk', () => {
  const enc_r = (x, y) => y * 20 + x
  const rev = (kind, f) => ({ type: `0xE::fight_events::${kind}`, parsedJson: { fight: FIGHT, ...f } })
  const render = (events) =>
    produce_receipt_render_turns(events, {
      fight_id: FIGHT,
      trap_cells: new Set([enc_r(8, 5)]),
      resolve_fighter_id: ({ character, is_mob, idx }) => character ?? (is_mob ? `m${idx}` : CHAR),
      fighter_cells: new Map([[CHAR, { x: 5, y: 5 }]]),
    })

  test('walk through X then cast a trap on X: ONE unbroken walk, no phantom boom', () => {
    const receipt = render([
      rev('Moved', { character: CHAR, to_cell: String(enc_r(10, 5)) }),
      rev('Cast', { caster_is_mob: false, caster_idx: 0, target_cell: String(enc_r(8, 5)) }),
    ])
    expect(receipt.turns[0].events.map((b) => b.kind)).toEqual(['move', 'arrival', 'cast'])
  })

  test('cast the trap FIRST, then walk through it: the walk still splits and detonates', () => {
    const receipt = render([
      rev('Cast', { caster_is_mob: false, caster_idx: 0, target_cell: String(enc_r(8, 5)) }),
      rev('Moved', { character: CHAR, to_cell: String(enc_r(10, 5)) }),
    ])
    expect(receipt.turns[0].events.map((b) => b.kind)).toEqual([
      'cast',
      'move',
      'arrival',
      'trap_trigger',
      'move',
      'arrival',
    ])
  })
})
