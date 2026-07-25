// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// SNAP-THEN-RUN — the board projection must serve PRESENTED cells for in-flight movers: a release-blocking bug
// where a character would appear on the target cell FIRST, then visibly run from the start to the target —
// for EVERY mover, local AND non-local. The DISPLAY cell must hold at the pre-move cell until
// the walk beat presents (the walk animation IS the move's render); the EFFECTIVE projection (legality/reach)
// keeps seeing the destination. Casts still paint their effects THIS frame (B3 — prediction paints first).

import { describe, expect, test } from 'bun:test'

import { create_fight_store, presented_state } from '../src/store.js'
import { board_view, engine_view } from '../src/project.js'
import { local_move_beats } from '../src/present.js'

const FIGHT = '0xf1'
const CHAR = '0xc1'
const GRID_W = 20
const cell = (x, y) => y * GRID_W + x

// me p0 at (5,2)=45; mob m0 at (5,5)=105.
const ME_CELL = cell(5, 2)
const MOB_CELL = cell(5, 5)
const ME_DEST = cell(8, 2) // a 3-cell horizontal walk
const MOB_DEST = cell(8, 5)

const ev = (kind, fields) => ({ type: `0x0::fight_events::${kind}`, parsedJson: { fight: FIGHT, ...fields } })

const FIGHT_OBJECT = {
  id: FIGHT,
  status: 1,
  width: GRID_W,
  height: 19,
  participants: [
    {
      owner: '0xaaa',
      character: CHAR,
      class: 'senshi',
      team: 0,
      ap: 6,
      mp: 3,
      base_ap: 6,
      base_mp: 3,
      hp: 50,
      max_hp: 50,
      cell: ME_CELL,
      stats: { agility: 40 },
    },
  ],
  mobs: [{ template: '0xabc', hp: 30, max_hp: 30, cell: MOB_CELL, ap: 4, mp: 3, level: 1, stats: { agility: 40 } }],
  queue: [
    { is_mob: false, idx: 0 },
    { is_mob: true, idx: 0 },
  ],
  turn_ptr: 0,
  turn_deadline_ms: 90_000,
}

const boot = () => {
  const store = create_fight_store()
  store.getState().input({
    type: 'init',
    fight_id: FIGHT,
    my_key: 'p0',
    ctx: { my_entity_id: CHAR, beat_ctx: { grid_width: GRID_W } },
  })
  store.getState().input({ type: 'snapshot', fight: FIGHT_OBJECT, version: 5 }, 1_000)
  return store
}

const board_mob_cell = (store, idx = 0) => board_view(store.getState()).mobs[idx].cell
const board_me_cell = (store) => board_view(store.getState()).escrow[0].cell
const engine_me_cell = (store) => engine_view(store.getState()).fighters.get(CHAR).cell

describe('SNAP-THEN-RUN — the display holds the pre-move cell until the walk beat presents', () => {
  // (a) NON-LOCAL: a mob's receipt move must show the START cell while its wave turn is unpresented, the
  //     destination only after its ack. The wave-mask already holds this in presented_state — proving the
  //     non-local class is masked IN CORE (any surviving teleport is the adapter's, out of this fence).
  test('(a) a non-local mob move holds at the start cell until its turn acks', () => {
    const store = boot()
    store.getState().input(
      {
        type: 'receipt',
        version: 6,
        receipt: {
          events: [
            ev('TurnEnded', { is_mob: false, idx: 0 }),
            ev('TurnStarted', { is_mob: true, idx: 0, deadline_ms: 0 }),
            ev('MobMoved', { idx: 0, to_cell: MOB_DEST }),
            ev('TurnEnded', { is_mob: true, idx: 0 }),
            ev('TurnStarted', { is_mob: false, idx: 0, deadline_ms: 99_000 }),
          ],
        },
      },
      2_000
    )
    expect(board_mob_cell(store)).toBe(MOB_CELL) // HELD at the start cell while unpresented
    const mob_turn = store.getState().wave.find((t) => t.source_id === 'mob-0')
    store.getState().input({ type: 'presented', seq: mob_turn.seq }, 3_000)
    expect(board_mob_cell(store)).toBe(MOB_DEST) // revealed only after its ack
  })

  // (b) LOCAL: MY own walk. The display must hold at the pre-move cell until the local walk turn acks — the walk
  //     animation IS the move's render, there is nothing to predict-paint but the walk itself. THIS is the red at
  //     HEAD: the Moved intent paints the destination the instant it folds (the snap-then-run bug).
  test('(b) my own walk holds at the pre-move cell until the walk turn acks (board + engine)', () => {
    const store = boot()
    const path = [cell(6, 2), cell(7, 2), ME_DEST].map((c) => ({ x: c % GRID_W, y: Math.floor(c / GRID_W) }))
    store.getState().input(
      {
        type: 'intent',
        intent: { kind: 'move', character: CHAR, to_cell: ME_DEST, mp_left: 0 },
        beats: local_move_beats({ fight_id: FIGHT, character: CHAR, to_cell: ME_DEST, path }),
      },
      1_100
    )
    // DISPLAY must hold at the pre-move cell while the walk beat is in flight.
    expect(board_me_cell(store)).toBe(ME_CELL)
    expect(engine_me_cell(store)).toEqual({ x: 5, y: 2 })
    // EFFECTIVE must already see the destination (it drives the next move's legality/reach — B-point-4 split).
    expect(presented_state(store.getState()).fighters.p0.cell).toBe(ME_DEST)
    // After the walk turn acks, the display arrives.
    const walk_turn = store.getState().wave.find((t) => t.is_local)
    store.getState().input({ type: 'presented', seq: walk_turn.seq }, 2_000)
    expect(board_me_cell(store)).toBe(ME_DEST)
    expect(engine_me_cell(store)).toEqual({ x: 8, y: 2 })
  })

  // (c) INVERSE GUARD (B3 — never regress prediction-paints-first for casts): a local cast's damage paints THIS
  //     frame. The walk is the ONLY exception; a cast's effects must never be held behind a beat.
  test('(c) a local cast still paints its damage the instant it folds', () => {
    const store = boot()
    store.getState().input(
      {
        type: 'predicted',
        basis_version: 6,
        intent_id: 'cast1',
        actions: [
          { kind: 'Cast', caster_is_mob: false, caster_idx: 0, target_cell: MOB_CELL, ap_cost: 3 },
          { kind: 'Hit', victim_is_mob: true, victim_idx: 0, amount: 10, remaining_hp: 20 },
        ],
      },
      1_100
    )
    expect(board_mob_cell(store)).toBe(MOB_CELL) // the caster's cast never moves the mob
    expect(board_view(store.getState()).mobs[0].hp).toBe(20) // damage painted THIS frame, no beat gate
  })
})
