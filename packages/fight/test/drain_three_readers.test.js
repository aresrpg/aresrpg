// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #1168 (re-cut 2026-07-30) — ONE APPLIED MP DRAIN, THREE READERS, ONE TRUTH.
//
// Driven observation on edge: a `-2 MP · 1 turn` drain split three ways.
//   · chain/receipt RESOLUTION — CORRECT: the fighter moved exactly 2 cells on the affected turn.
//   · the movement-range overlay — WRONG: the green reachable paint showed the FULL undrained range for the
//     whole effect window.
//   · the turn-card effect badge — WRONG: the `-2 MP · 1 turn` chip appeared on application, then dropped off
//     the fighter's card while the effect was still active.
//
// ONE MISSING HOME explains all three. `cast::resolve_drain` records a timed DEBT ROW next to the live-pool
// shave (`spell_board::add_status(.., spell_effect::drain_row(point_kind, removed, dur))`), so the chain's own
// state carries the drain for its full window. The client fold shaved the pool on `Drain` and stopped there —
// it never minted that row. `REMOVE_POINTS`/`STEAL_POINTS` are in `DERIVED_STATUS_KINDS` because the contested
// `removed` count is not on the envelope, and the `Drain` event that carries it was doing pool arithmetic only.
// So `fighter.statuses` never held the drain, and BOTH broken readers hang off `statuses`:
//   · `inputs.pool_grant` derives the turn-start refill from the timed point rows — no row, no debt, so the next
//     `TurnStarted` refilled to the FULL base and painted the undrained reach for the rest of the window;
//   · `project_views.effects_of` maps `statuses` into the badge array — no row, no chip.
// The pool shave is untouched, which is why resolution was right all along; it is pinned below so it stays.
//
// A fix that repairs the overlay but not the badge (or vice versa) would be two homes for the same effect
// state — hence one fixture, three assertions, one applied drain.

import { describe, expect, test } from 'bun:test'

import * as SE from '../../sim/src/spell_effect.js'
import { encode } from '../src/los.js'
import { presented_reachable_cells } from '../src/movement_candidates.js'
import { board_view, engine_view, move_wash } from '../src/project.js'
import { create_fight_store } from '../src/store.js'

const FIGHT = '0xf1168'
const CHAR = '0xc1168'
const SEAT = encode(5, 5)
const MOB = encode(8, 8)
const BASE_MP = 6
const REMOVED = 2

const ev = (kind, fields) => ({ type: `0x0::fight_events::${kind}`, parsedJson: { fight: FIGHT, ...fields } })

const fight_object = () => ({
  id: FIGHT,
  status: 1,
  width: 20,
  height: 19,
  participants: [
    {
      owner: '0xaaa',
      character: CHAR,
      class: 'senshi',
      team: 0,
      ap: 6,
      mp: BASE_MP,
      base_ap: 6,
      base_mp: BASE_MP,
      hp: 50,
      max_hp: 50,
      cell: SEAT,
    },
  ],
  mobs: [{ template: '0xabc', hp: 30, max_hp: 30, cell: MOB, ap: 4, mp: 3, level: 1 }],
  queue: [
    { is_mob: false, idx: 0 },
    { is_mob: true, idx: 0 },
  ],
  turn_ptr: 0,
  turn_deadline_ms: 90_000,
  turn_entropy: 90_000,
  turn_ordinal: 1,
})

const feed = (store, version, events, now) =>
  store.getState().input({ type: 'receipt', fight_id: FIGHT, version, receipt: { events } }, now)

/** My turn opens (the overlay pool is born at the refill), I end it, the mob's turn opens — the live flow the
 *  field report came from: a drain lands on me BETWEEN my turns, which is exactly when a debt has to survive. */
const boot = () => {
  const store = create_fight_store()
  store
    .getState()
    .input({ type: 'init', fight_id: FIGHT, my_key: 'p0', ctx: { my_entity_id: CHAR, beat_ctx: { grid_width: 20 } } })
  store.getState().input({ type: 'snapshot', fight: fight_object(), version: 5 }, 1_000)
  feed(
    store,
    6,
    [
      ev('TurnStarted', { is_mob: false, idx: 0, deadline_ms: 90_000 }),
      ev('TurnEnded', { is_mob: false, idx: 0 }),
      ev('TurnStarted', { is_mob: true, idx: 0, deadline_ms: 0 }),
    ],
    1_500
  )
  return store
}

/** The mob's cast: the authored `-2 MP · 1 turn` line, then the contested outcome the chain resolved for it.
 *  `emit_effect` fires immediately before `apply_effect` for that ordinal (cast.move:620-628), and
 *  `resolve_drain`'s `emit_drain` fires inside it — so the Drain's authored duration is the ActionEffect
 *  the fold has just seen. */
const cast_the_drain = (store, version, now) =>
  feed(
    store,
    version,
    [
      ev('ActionStarted', {
        caster_is_mob: true,
        caster_idx: 0,
        turn_ordinal: 1,
        action_ordinal: 0,
        action_kind: 0,
        target: SEAT,
        ap_cost: 3,
        effect_count: 1,
      }),
      ev('ActionEffect', {
        caster_is_mob: true,
        caster_idx: 0,
        turn_ordinal: 1,
        action_ordinal: 0,
        effect_ordinal: 0,
        effect: {
          kind: SE.K_REMOVE_POINTS,
          element: 255,
          value: 3,
          area_shape: SE.SHAPE_POINT,
          area_size: 0,
          target_filter: SE.TF_NOT_TEAM,
          chance: 100,
          turns: 1,
          stat: SE.POINT_MP,
          flags: SE.FLAG_DODGE,
          phase: 0,
        },
      }),
      ev('Drain', {
        target_is_mob: false,
        target_idx: 0,
        point_kind: SE.POINT_MP,
        removed: REMOVED,
        requested: 3,
      }),
      ev('ActionResolved', { caster_is_mob: true, caster_idx: 0, turn_ordinal: 1, action_ordinal: 0 }),
    ],
    now
  )

/** Reader 1 — RESOLUTION: the chain pool the board's own draft math anchors on. */
const committed_mp = (store) => board_view(store.getState()).escrow[0]?.committed?.mp ?? null

/** Reader 2 — THE REACH: the green movement paint, exactly as the board arms it. */
const painted_reach = (store) => move_wash(store.getState()).reach.length

/** Reader 3 — THE BADGE: the array the turn card's effect chips render. */
const drain_badge = (store) =>
  (engine_view(store.getState()).fighters.get(CHAR)?.effects ?? []).find(
    (row) => row.kind === SE.K_REMOVE_POINTS && Number(row.stat) === SE.POINT_MP
  ) ?? null

/** Ack every paced wave beat so the eye reaches the frontier and the board re-arms. */
const present_all = (store, now) => {
  for (const turn of [...store.getState().wave]) store.getState().input({ type: 'presented', seq: turn.seq }, now)
}

/** My turn re-opens after the drain — the window the field report was taken in. */
const my_turn_again = (store) => {
  feed(store, 8, [ev('TurnEnded', { is_mob: true, idx: 0 })], 2_100)
  present_all(store, 2_150)
  feed(store, 9, [ev('TurnStarted', { is_mob: false, idx: 0, deadline_ms: 90_000 })], 2_200)
  present_all(store, 2_250)
}

describe('#1168 re-cut — one applied MP drain, read the same by resolution, the reach and the badge', () => {
  test('resolution: the pool is shaved by the contested count (already correct — pinned so it stays)', () => {
    const store = boot()
    cast_the_drain(store, 7, 2_000)
    expect(committed_mp(store), 'resolution honors the drain').toBe(BASE_MP - REMOVED)
  })

  test('the reach: my next turn paints the DRAINED range, not the full undrained one', () => {
    const store = boot()
    cast_the_drain(store, 7, 2_000)
    // The chain refills to `base + credit − debt` (participant::net_refill) and the debt IS the drain row, so a
    // `-2 MP · 1 turn` drain opens my next turn at 4 MP. Without the row the client refilled to a full 6 and
    // painted the undrained reach for the whole effect window — the reported overlay bug.
    my_turn_again(store)
    const drained = presented_reachable_cells({ start: SEAT, movement_points: BASE_MP - REMOVED, blocked: [] }).length
    const undrained = presented_reachable_cells({ start: SEAT, movement_points: BASE_MP, blocked: [] }).length
    expect(drained, 'fixture sanity: the two reaches must differ or this proves nothing').toBeLessThan(undrained)
    expect(painted_reach(store), 'the green paint is the drained reach').toBe(drained)
  })

  test('the badge: the chip carries the contested count and its duration, for the whole window', () => {
    const store = boot()
    cast_the_drain(store, 7, 2_000)
    present_all(store, 2_050) // the drain's beat presents — from here the chip is owed for the whole window
    const chip = drain_badge(store)
    expect(chip, 'the turn card shows the drain while it is active').not.toBeNull()
    expect(chip?.value, 'the chip states the count the chain actually removed, not the requested one').toBe(REMOVED)
    expect(chip?.remaining_turns, 'the chip states the authored duration').toBe(1)
  })
})
