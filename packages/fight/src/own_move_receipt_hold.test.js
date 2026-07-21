// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #25 — OWN-MOVE ROLLBACK: the predict→receipt-replay seam must HOLD the predicted move through receipt
// adoption. A visible rollback = the display cell, having reached (or held for) the destination, flickers
// back to the pre-move cell when the own-move receipt lands. The receipt CONFIRMS my move — it must never
// regress the presented projection to origin.

import { describe, expect, test } from 'bun:test'

import { create_fight_store } from './store.js'
import { board_view, engine_view } from './project.js'
import { local_move_beats } from './present.js'

const FIGHT = '0xf1'
const CHAR = '0xc1'
const GRID_W = 20
const cell = (x, y) => y * GRID_W + x

const ME_CELL = cell(5, 2)
const ME_DEST = cell(8, 2)

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
  mobs: [{ template: '0xabc', hp: 30, max_hp: 30, cell: cell(5, 5), ap: 4, mp: 3, level: 1, stats: { agility: 40 } }],
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

const board_me = (store) => board_view(store.getState()).escrow[0].cell
const engine_me = (store) => engine_view(store.getState()).fighters.get(CHAR).cell
const path_to = (dest) => {
  const out = []
  for (let x = 6; x <= dest % GRID_W; x++) out.push({ x, y: 2 })
  return out
}
const move_intent = (store, at) =>
  store.getState().input(
    {
      type: 'intent',
      intent: { kind: 'move', character: CHAR, to_cell: ME_DEST, mp_left: 0 },
      beats: local_move_beats({ fight_id: FIGHT, character: CHAR, to_cell: ME_DEST, path: path_to(ME_DEST) }),
    },
    at
  )
const move_receipt = (store, version, at) =>
  store
    .getState()
    .input({ type: 'receipt', version, receipt: { events: [ev('Moved', { character: CHAR, to_cell: ME_DEST })] } }, at)
const walk_turn = (store) => store.getState().wave.find((t) => t.is_local)

describe('#25 own-move receipt must not roll the display back to origin', () => {
  // ORDER 1 — walk ACKS, THEN the receipt lands (the slow-chain norm). Display is at DEST; receipt must keep it.
  test('receipt after ack keeps the destination', () => {
    const store = boot()
    move_intent(store, 1_100)
    const t = walk_turn(store)
    store.getState().input({ type: 'presented', seq: t.seq }, 1_500)
    expect(board_me(store)).toBe(ME_DEST) // walk done → at dest
    move_receipt(store, 6, 3_000) // the confirming receipt lands
    expect(board_me(store)).toBe(ME_DEST) // MUST hold — no rollback
    expect(engine_me(store)).toEqual({ x: 8, y: 2 })
  })

  // ORDER 1b — the confirming POLL (a wholesale Fight OBJECT read at the move's version) lands after the ack.
  // The adopted view already carries me at DEST; adoption must not regress the display to origin.
  test('poll snapshot after ack keeps the destination', () => {
    const store = boot()
    move_intent(store, 1_100)
    const t = walk_turn(store)
    store.getState().input({ type: 'presented', seq: t.seq }, 1_500)
    expect(board_me(store)).toBe(ME_DEST)
    // the chain object at v6 shows me already at DEST (my move committed)
    const moved_object = {
      ...FIGHT_OBJECT,
      participants: [{ ...FIGHT_OBJECT.participants[0], cell: ME_DEST }],
    }
    store.getState().input({ type: 'snapshot', fight: moved_object, version: 6 }, 3_000)
    expect(board_me(store)).toBe(ME_DEST) // MUST hold — no rollback on adoption
  })

  // ORDER 1c — the confirming POLL lands DURING the walk (deferred behind the masking walk leg), then the ack
  // flushes the deferred adopt. The double-show hint: adoption must reveal DEST once, never origin-then-dest.
  test('poll snapshot deferred behind the walk, flushed at ack, lands on dest', () => {
    const store = boot()
    move_intent(store, 1_100)
    expect(board_me(store)).toBe(ME_CELL)
    const moved_object = {
      ...FIGHT_OBJECT,
      participants: [{ ...FIGHT_OBJECT.participants[0], cell: ME_DEST }],
    }
    store.getState().input({ type: 'snapshot', fight: moved_object, version: 6 }, 1_300) // deferred (walk masks)
    expect(board_me(store)).toBe(ME_CELL) // still held behind the walk
    const t = walk_turn(store)
    store.getState().input({ type: 'presented', seq: t.seq }, 1_600) // ack → deferred adopt flushes
    expect(board_me(store)).toBe(ME_DEST) // revealed on dest, no origin flicker
  })

  // MULTI-STEP (D254 cumulative) — the intent moves to the FINAL cell in one shot; the receipt confirms it as
  // per-segment Moved events. The display must land on the final cell with no origin flicker across the fold.
  test('a multi-step cumulative move: per-segment receipt lands on the final cell', () => {
    const store = boot()
    move_intent(store, 1_100) // one intent → ME_DEST (8,2)
    const t = walk_turn(store)
    store.getState().input({ type: 'presented', seq: t.seq }, 1_500)
    expect(board_me(store)).toBe(ME_DEST)
    store.getState().input(
      {
        type: 'receipt',
        version: 6,
        receipt: {
          events: [
            ev('Moved', { character: CHAR, to_cell: cell(6, 2) }),
            ev('Moved', { character: CHAR, to_cell: cell(7, 2) }),
            ev('Moved', { character: CHAR, to_cell: ME_DEST }),
          ],
        },
      },
      3_000
    )
    expect(board_me(store)).toBe(ME_DEST) // final cell held, no regression
    expect(engine_me(store)).toEqual({ x: 8, y: 2 })
  })

  // ORDER 2 — the receipt lands BEFORE the walk beat finished presenting (fast chain / slow rAF). The window was
  // keyed to the INTENT's (version, event_idx); after the intent purges, the receipt's Moved must not fall INTO
  // that window and hold origin only to reveal dest later — and must never flicker origin after the ack.
  test('receipt before ack, then ack, never regresses to origin', () => {
    const store = boot()
    move_intent(store, 1_100)
    expect(board_me(store)).toBe(ME_CELL) // held during the walk
    move_receipt(store, 6, 1_300) // fast receipt, walk still animating (turn unacked)
    // whatever the display shows now, acking the walk must land it on DEST — never a fresh origin frame.
    const before_ack = board_me(store)
    const t = walk_turn(store)
    if (t) store.getState().input({ type: 'presented', seq: t.seq }, 1_600)
    expect(board_me(store)).toBe(ME_DEST)
    expect(engine_me(store)).toEqual({ x: 8, y: 2 })
    // and the pre-ack frame must be either the hold (origin, walk still playing) or dest — a receipt-confirmed
    // move is authoritative; it may reveal early but must never invent a NEW rollback the eye reads as a snap-back.
    expect([ME_CELL, ME_DEST]).toContain(before_ack)
  })
})
