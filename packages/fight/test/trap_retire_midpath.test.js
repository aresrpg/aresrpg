// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// trap_retire_midpath.test.js — MY_TRAPS RETIREMENT ON A CROSSING (#954 · #1050, the "trap did not disappear" half).
//
// `my_traps` is the client's durable local trap ledger and it retires ONLY on a receipt-proven ENTER (fold.js:
// "it errs toward it stays" — a version bump is not a firing, and falsely retiring a live trap makes the next
// cast abort `ECellAlreadyTrapped` and nuke the whole batch). The proof it sampled was the mover's LANDED cell,
// which a mid-path crossing never touches — so the chain detonated the trap while the client kept painting it.
//
// The walk is re-derivable: `Moved`/`MobMoved` carry the destination, the fold already tracks every fighter's
// cell, and the board's terrain facts ride on the adopted view. Same `reconstructed_path` the renderer uses —
// ONE home for "which cells did this walk ENTER".

import { describe, expect, test } from 'bun:test'

import { create_fight_store } from '../src/store.js'
import { engine_view } from '../src/project.js'

const FIGHT = '0xf1'
const CHAR = '0xc1'
const W = 20
const enc = (x, y) => y * W + x
const ME = enc(5, 5)
const MOB = enc(11, 5)
const TRAP = enc(9, 5) // ON the mob's approach lane, never its landing cell
const PAST_TRAP = enc(7, 5) // the mob walks 11 → 10 → 9 → 8 → 7, entering the trap on the way

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
      mp: 3,
      base_ap: 9,
      base_mp: 3,
      hp: 50,
      max_hp: 50,
      cell: ME,
    },
  ],
  mobs: [{ template: '0xabc', hp: 200, max_hp: 200, cell: MOB, ap: 4, mp: 4, level: 1 }],
  queue: [{ is_mob: false, idx: 0 }],
  turn_ptr: 0,
  turn_deadline_ms: 90_000,
  turn_entropy: 90_000,
  turn_ordinal: 1,
}

const boot = (trap_cell = TRAP) => {
  const store = create_fight_store()
  store
    .getState()
    .input({ type: 'init', fight_id: FIGHT, my_key: 'p0', ctx: { my_entity_id: CHAR, beat_ctx: { grid_width: W } } })
  store.getState().input({ type: 'snapshot', fight: FIGHT_OBJECT, version: 5 }, 1_000)
  store.getState().input(
    {
      type: 'predicted',
      basis_version: 6,
      intent_id: 'trap1',
      actions: [{ kind: 'Cast', caster_is_mob: false, caster_idx: 0, target_cell: trap_cell, ap_cost: 2 }],
      beats: [{ kind: 'cast', at: 0, duration: 100, payload: {} }],
      place_traps: [trap_cell],
    },
    1_100
  )
  return store
}

const commit = (store, to_cell, version) => {
  store
    .getState()
    .input({ type: 'receipt', version, receipt: { events: [ev('MobMoved', { idx: 0, to_cell })] } }, 1_200)
  for (const turn of store.getState().wave) {
    for (const [index, beat] of turn.beats.entries())
      if (beat.kind === 'trap_trigger')
        store.getState().input({
          type: 'trap_triggered',
          anchor: beat.payload.trap_anchor,
          cell: beat.payload.trap_cell,
          trigger_id: `wave:${turn.seq}:${index}`,
        })
    store.getState().input({ type: 'presented', seq: turn.seq }, 1_300)
  }
}

describe('my_traps retires on a MID-PATH crossing, not only on the landing cell (#954)', () => {
  test('a mob that walks THROUGH the trap retires it — the chain detonated it', () => {
    const store = boot()
    expect(engine_view(store.getState()).my_traps).toEqual([TRAP])
    commit(store, PAST_TRAP, 7)
    expect(engine_view(store.getState()).my_traps).toEqual([])
  })

  test('the retirement is DURABLE — the mob walking on later never resurrects it', () => {
    const store = boot()
    commit(store, PAST_TRAP, 7)
    commit(store, enc(3, 3), 8)
    expect(engine_view(store.getState()).my_traps).toEqual([])
  })

  // THE ERRS-TOWARD-IT-STAYS HALF, which the path widening must not break: a walk that never entered the
  // trap's cell leaves it armed. A falsely retired trap is the `ECellAlreadyTrapped` batch-nuke class.
  test('a walk that passes BESIDE the trap leaves it armed', () => {
    const store = boot()
    // the mob walks along row 6, one cell below the trap's row — the canonical route never enters (9,5).
    store.getState().input(
      {
        type: 'receipt',
        version: 7,
        receipt: {
          events: [ev('MobMoved', { idx: 0, to_cell: enc(11, 6) }), ev('MobMoved', { idx: 0, to_cell: enc(7, 6) })],
        },
      },
      1_200
    )
    for (const beat of store.getState().wave) store.getState().input({ type: 'presented', seq: beat.seq }, 1_300)
    expect(engine_view(store.getState()).my_traps).toEqual([TRAP])
  })
})
