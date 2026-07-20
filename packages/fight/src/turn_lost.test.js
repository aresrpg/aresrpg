// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// RED-FIRST (PASS-53 MUST-2 — a bug where the auto-pass silently rolled back a movement): a drafted turn that
// expires UNCOMMITTED — busy past the deadline ('missed'), an executed on-chain failure ('latched'), or a
// consumed submit epoch with no receipt ('burned') — must surface ONCE as a reducer OUTPUT (`turn_lost`),
// never roll back silently. The toast edge consumes it through the door ('turn_lost_shown'), so a remounted
// subscriber can never re-toast the same lost turn.
import { describe, expect, mock, test } from 'bun:test'

import { turn_commit_key, turn_submit_epoch } from './turn_commit.js'
import { create_fight_store } from './store.js'
import { subscribe_turn_lost } from './txs.js'

const FIGHT = 'fight-1'
const CHAR = 'hero-1'
const DEADLINE = 100_000
const fight_object = {
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
      mp: 3,
      base_ap: 6,
      base_mp: 3,
      hp: 50,
      max_hp: 50,
      cell: 100,
    },
  ],
  mobs: [{ hp: 10, max_hp: 10, cell: 120 }],
  queue: [
    { is_mob: false, idx: 0 },
    { is_mob: true, idx: 0 },
  ],
  turn_deadline_ms: DEADLINE,
  last_action_ms: 1_000,
}
const my_turn_started = {
  type: '0x0::fight_events::TurnStarted',
  parsedJson: { fight: FIGHT, is_mob: false, idx: 0, deadline_ms: DEADLINE },
}

const booted_store = () => {
  const store = create_fight_store()
  store.getState().input({ type: 'init', fight_id: FIGHT, my_key: 'p0', ctx: { my_entity_id: CHAR } })
  store.getState().input({ type: 'snapshot', fight: fight_object, version: 5 }, 1_000)
  store.getState().input({ type: 'receipt', events: [my_turn_started], version: 6 }, 1_000)
  return store
}
const expected_key = (state) =>
  turn_commit_key({ fight_id: FIGHT, entity_id: CHAR, deadline_ms: Number(state.turn_deadline_ms ?? 0) })

describe('turn_lost — a drafted turn expiring uncommitted is a reducer output, once per turn', () => {
  test("busy past the deadline ('missed') sets turn_lost exactly once", () => {
    const store = booted_store()
    const epoch = turn_submit_epoch(store.getState())
    store.getState().input({ type: 'busy', value: true, attempt_epoch: epoch }, 90_000)
    store.getState().input({ type: 'tick', draft_count: 2 }, DEADLINE + 500)
    const lost = store.getState().turn_lost
    expect(lost, 'a busy turn expiring with a draft must set turn_lost').toBeTruthy()
    expect(lost.reason).toBe('missed')
    expect(lost.key).toBe(expected_key(store.getState()))
    store.getState().input({ type: 'tick', draft_count: 2 }, DEADLINE + 1_500)
    expect(store.getState().turn_lost).toEqual(lost) // same turn: never re-set, never re-armed
  })

  test("an executed failure latch ('latched') is lost immediately, deadline not required", () => {
    const store = booted_store()
    const key = expected_key(store.getState())
    store.getState().input({ type: 'tick', draft_count: 1, latch: { turn_key: key, digest: '0xdead' } }, 50_000)
    const lost = store.getState().turn_lost
    expect(lost, 'a latched turn with a draft must set turn_lost without waiting for the deadline').toBeTruthy()
    expect(lost.reason).toBe('latched')
  })

  test("a consumed submit epoch with no receipt ('burned') is lost at the deadline", () => {
    const store = booted_store()
    const epoch = turn_submit_epoch(store.getState())
    store.getState().input({ type: 'busy', value: true, attempt_epoch: epoch }, 90_000)
    store.getState().input({ type: 'busy', value: false }, 91_000) // submit finished; no receipt ever folds
    store.getState().input({ type: 'tick', draft_count: 1 }, DEADLINE + 500)
    const lost = store.getState().turn_lost
    expect(lost, 'a burned epoch expiring with a draft must set turn_lost').toBeTruthy()
    expect(lost.reason).toBe('burned')
  })

  // A live report: "the turn timer ran out before your actions were commited… I was in
  // time." Round 3 (commit d00bf777) re-anchored the auto-commit fire point to the CHAIN deadline with a 5s
  // margin (draft_budget.js COMMIT_BUFFER_MS) — this pins the residual: does a COMFORTABLE flush (well outside
  // that margin, ≥10s early) ever still get marked lost under realistic resolution latency? auto_commit_decision
  // gives up (flips 'retry' → 'missed') only inside the final 1_500ms before the deadline — a flush that starts
  // at deadline−10_000 and resolves at r8's measured real-world latency (2.6s, draft_budget.js comment) clears
  // busy ~7s before that cutover, with ~4x headroom to spare. Contrast the test above: THAT one starts busy at
  // the SAME instant (90_000 = deadline−10_000) but never clears it (an unbounded hang) — 'missed' is correct
  // there because the client genuinely cannot tell a hang from a loss. The distinguishing fact is resolution,
  // not start time.
  test('a manual flush 10s before the chain deadline, resolving at realistic latency, never sets turn_lost', () => {
    const store = booted_store()
    store.getState().input({ type: 'stage', intent: { kind: 0, target: 1 } })
    // Manual End Turn's busy mirror (world-shell/dungeon_run_store.js:1359, dungeon_run_store → fight_store)
    // carries no attempt_epoch — only the automatic auto-commit edge (txs.js subscribe_commit_due) claims one.
    store.getState().input({ type: 'busy', value: true }, DEADLINE - 10_000)
    store.getState().input({ type: 'tick' }, DEADLINE - 9_000)
    expect(store.getState().turn_lost, 'still in flight inside the comfortable window — no verdict yet').toBeFalsy()
    // The receipt lands well within realistic latency; flush_commit's own trailing clear_staged (DungeonBoard.jsx)
    // fires the instant commit_turn resolves — busy clears and the draft empties together.
    store.getState().input({ type: 'busy', value: false }, DEADLINE - 7_000)
    store.getState().input({ type: 'clear_staged' }, DEADLINE - 7_000)
    store.getState().input({ type: 'tick' }, DEADLINE + 500)
    expect(store.getState().turn_lost, 'a turn that committed with 7s to spare must never be marked lost').toBeFalsy()
  })

  test('an idle expiry (no draft) is NOT a lost turn', () => {
    const store = booted_store()
    store.getState().input({ type: 'tick', draft_count: 0 }, DEADLINE + 500)
    expect(store.getState().turn_lost).toBeFalsy()
  })

  test('the edge toasts once per lost turn and survives a remount (shown consumed through the door)', () => {
    const store = booted_store()
    const epoch = turn_submit_epoch(store.getState())
    store.getState().input({ type: 'busy', value: true, attempt_epoch: epoch }, 90_000)
    const on_lost = mock(() => {})
    const unsubscribe = subscribe_turn_lost(store, { on_lost })
    store.getState().input({ type: 'tick', draft_count: 2 }, DEADLINE + 500)
    store.getState().input({ type: 'tick', draft_count: 2 }, DEADLINE + 1_000)
    expect(on_lost).toHaveBeenCalledTimes(1)
    expect(store.getState().turn_lost.shown).toBe(true)
    unsubscribe()
    const remounted = mock(() => {})
    const unsubscribe_2 = subscribe_turn_lost(store, { on_lost: remounted })
    store.getState().input({ type: 'tick', draft_count: 2 }, DEADLINE + 2_000)
    expect(remounted, 'a remounted edge must not re-toast a shown lost turn').toHaveBeenCalledTimes(0)
    unsubscribe_2()
  })
})
