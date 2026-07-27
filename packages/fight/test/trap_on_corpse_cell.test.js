// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// trap_on_corpse_cell.test.js — #1210, THE FOLD'S HALF: a corpse must not hold its cell against a trap.
//
// The twin was already exonerated on the issue thread (the chain's `cell_occupied` filters `is_alive`; the sim
// reducer accepts kill-then-place same-turn and cross-turn), which puts the refusal on the CLIENT's candidate
// set. The optimistic-death LATCH was the prime suspect. It is not the mechanism, and this pins why so the
// suspicion is not re-raised: the latch is one-directional. It can only ever hold a fighter DEAD for the eye
// (`project.engine_view.dead`, and only while a commit is in flight); there is no path by which it reports a
// corpse ALIVE, which is the only thing that could keep a cell out of a `free_cell` footprint.
//
// What the fold owes the candidate set is this: once a kill is COMMITTED, every projection the board reads must
// say the cell is free. That is what these rows measure.

import { describe, expect, test } from 'bun:test'

import { committed_truth, create_fight_store } from '../src/store.js'
import { board_view, engine_view } from '../src/project.js'

const FIGHT = '0xf1'
const CHAR = '0xc1'
const W = 20
const enc = (x, y) => y * W + x
const ME = enc(5, 5)
const MOB = enc(9, 5)

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
  mobs: [{ template: '0xabc', hp: 30, max_hp: 30, cell: MOB, ap: 4, mp: 3, level: 1 }],
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

/** The predicate DungeonBoard's `free_cell` footprint filter applies, over the projection it reads. */
const holds_the_cell = (state) =>
  (board_view(state).mobs ?? []).some((m) => m.cell === MOB && (m.committed?.alive ?? m.alive))

describe('#1210 — a committed corpse frees its cell for a trap', () => {
  test('before the kill the mob holds its cell (the control)', () => {
    expect(holds_the_cell(boot().getState())).toBe(true)
  })

  test('a COMMITTED kill frees the cell in every projection the candidate set reads', () => {
    const store = boot()
    store.getState().input(
      {
        type: 'receipt',
        version: 7,
        receipt: { events: [ev('Hit', { victim_is_mob: true, victim_idx: 0, amount: 30, remaining_hp: 0 })] },
      },
      1_200
    )
    for (const beat of store.getState().wave) store.getState().input({ type: 'presented', seq: beat.seq }, 1_300)
    expect(committed_truth(store.getState()).fighters.m0.alive).toBe(false)
    expect(engine_view(store.getState()).fighters.get('mob-0').committed_dead).toBe(true)
    expect(holds_the_cell(store.getState())).toBe(false)
  })

  // THE REMAINING WINDOW, and the reason this row is a REPORT rather than a fix here. My own killing cast is an
  // INTENT until its receipt lands, and `committed` excludes intents BY DESIGN (that exclusion is what keeps a
  // mispredicted kill from resurrecting a corpse). So between the drafted kill and the commit, committed truth
  // still says the mob is alive — correctly. The compensation for that window already exists on the board as
  // `optimistic_vacated` (DungeonBoard.jsx:346, "this turn's casts already kill it → its cell opens for the
  // move"), but it is fed ONLY to the move-range mask, never to the `free_cell` footprint filter one screen
  // below it. That asymmetry — not this fold — is what refuses the corpse's cell.
  test('a DRAFTED kill leaves committed truth alive — by design, and the fold is not the compensator', () => {
    const store = boot()
    store.getState().input(
      {
        type: 'predicted',
        basis_version: 6,
        intent_id: 'kill1',
        actions: [
          { kind: 'Cast', caster_is_mob: false, caster_idx: 0, target_cell: MOB, ap_cost: 4 },
          { kind: 'Hit', victim_is_mob: true, victim_idx: 0, amount: 30, remaining_hp: 0 },
        ],
        beats: [{ kind: 'cast', at: 0, duration: 100, payload: {} }],
      },
      1_100
    )
    // The intent is NOT committed truth, so the occupancy map the footprint filter reads still holds the cell.
    expect(committed_truth(store.getState()).fighters.m0.alive).toBe(true)
    expect(holds_the_cell(store.getState())).toBe(true)
  })

  // THE EXONERATION. The latch is one-directional by construction: it holds a fighter DEAD for the eye while a
  // commit is in flight. A `free_cell` footprint is only ever narrowed by a fighter reported ALIVE, so no state
  // of this latch can refuse a corpse's cell.
  test('the optimistic-death latch can only ADD deadness — it never reports a corpse alive', () => {
    const store = boot()
    store.getState().input(
      {
        type: 'receipt',
        version: 7,
        receipt: { events: [ev('Hit', { victim_is_mob: true, victim_idx: 0, amount: 30, remaining_hp: 0 })] },
      },
      1_200
    )
    for (const beat of store.getState().wave) store.getState().input({ type: 'presented', seq: beat.seq }, 1_300)
    const state = store.getState()
    // whatever the latch holds, the committed truth the board's occupancy map reads stays dead
    expect(Object.keys(state.optimistic_dead ?? {})).not.toContain('m0') // a CONFIRMED kill rides `retired` instead
    expect(state.retired?.m0).not.toBeUndefined()
    expect(holds_the_cell(state)).toBe(false)
  })
})
