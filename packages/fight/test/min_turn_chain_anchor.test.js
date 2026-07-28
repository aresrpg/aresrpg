// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #1484 — "sometimes I get 'hold up the turn must be 3s' but it was 3s already, so it should not roll me back,
// at least it should wait a little and retry."
//
// TWO CLOCKS measured one turn and only one of them could refuse a transaction:
//   · the CHAIN — `actions::assert_min_turn` gates on `now + turn_ms >= turn_deadline_ms + MIN_TURN_MS`, i.e. a
//     floor of `turn_deadline_ms − turn_ms + MIN_TURN_MS`. `resolve_from` stamps
//     `deadline = start + turn_ms + 3s×N` (N = mobs replayed into my turn), so that floor is
//     `turn start + 3s×N + 3s` — it WIDENS with every mob the client has to replay.
//   · the CLIENT — a flat `turn_started_at + PLAYER_TURN_FLOOR_MS`, anchored to the local playable rising edge
//     (when the client's own wave finished draining). It carries NO per-mob widening of its own.
//
// Whenever the local replay drained faster than the chain's 3s-per-mob budget, the client's floor lifted FIRST,
// the End Turn button armed, the PTB went out, and the chain aborted ETurnTooFast — destroying a turn the
// player had legitimately spent 3+ seconds on. The fix reads the chain's OWN anchor (it is already on the
// state: `turn_deadline_ms` + `view.turn_ms`) and never submits before BOTH clocks allow.

import { describe, expect, test } from 'bun:test'

import * as project from '../src/project.js'
import { create_fight_store, PLAYER_TURN_FLOOR_MS } from '../src/store.js'

const FIGHT = '0xf1484'
const CHAR = '0xc1484'
const CHAIN_TURN_START = 1_000_000
const TURN_MS = 45_000
const MOB_REPLAY_MS = 3_000 // actions.move: `deadline = start + turn_ms + 3s * resolved_mobs`
const MOBS_REPLAYED = 2
const DEADLINE = CHAIN_TURN_START + TURN_MS + MOBS_REPLAYED * MOB_REPLAY_MS
// What actions.move::assert_min_turn will accept — the ONE instant this whole file is about.
const CHAIN_FLOOR = DEADLINE - TURN_MS + PLAYER_TURN_FLOOR_MS
// The client drained its mob replay AHEAD of the chain's budget, so its local anchor lands early.
const LOCAL_EDGE = CHAIN_TURN_START + 4_000

const fight_object = (over = {}) => ({
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
  mobs: Array.from({ length: MOBS_REPLAYED }, (_, idx) => ({ hp: 10, max_hp: 10, cell: 120 + idx })),
  turn_ms: TURN_MS,
  queue: [{ is_mob: false, idx: 0 }, ...Array.from({ length: MOBS_REPLAYED }, (_, idx) => ({ is_mob: true, idx }))],
  turn_deadline_ms: DEADLINE,
  turn_entropy: DEADLINE,
  turn_ordinal: 1,
  last_action_ms: CHAIN_TURN_START,
  ...over,
})

const boot = (over) => {
  const store = create_fight_store()
  store.getState().input({ type: 'init', fight_id: FIGHT, my_key: 'p0', ctx: { my_entity_id: CHAR } })
  store.getState().input({ type: 'snapshot', fight: fight_object(over), version: 5 }, LOCAL_EDGE)
  return store
}

describe('#1484 — the min-turn gate reads the CHAIN anchor, not a local guess', () => {
  test('the harness stamps the early local anchor (the disagreement this bug rides on)', () => {
    const store = boot()
    expect(store.getState().turn_started_at).toBe(LOCAL_EDGE)
    expect(project.is_my_turn(store.getState())).toBe(true)
    expect(LOCAL_EDGE + PLAYER_TURN_FLOOR_MS).toBeLessThan(CHAIN_FLOOR) // the client would arm 2s early
  })

  test('the button stays gated past the local floor, until the chain floor', () => {
    const store = boot()
    const state = store.getState()
    // the moment the OLD flat floor lifted — the chain would still abort ETurnTooFast here
    expect(project.can_end_turn(state, LOCAL_EDGE + PLAYER_TURN_FLOOR_MS)).toBe(false)
    expect(project.min_turn_left(state, LOCAL_EDGE + PLAYER_TURN_FLOOR_MS)).toBe(
      CHAIN_FLOOR - LOCAL_EDGE - PLAYER_TURN_FLOOR_MS
    )
    // one millisecond before the chain's own floor — still refused, locally, for zero gas
    expect(project.can_end_turn(state, CHAIN_FLOOR - 1)).toBe(false)
    expect(project.min_turn_left(state, CHAIN_FLOOR - 1)).toBe(1)
    // …and released exactly on it
    expect(project.can_end_turn(state, CHAIN_FLOOR)).toBe(true)
    expect(project.min_turn_left(state, CHAIN_FLOOR)).toBe(0)
  })

  test('AT THE BOUNDARY the end-turn intent is HELD for the remainder, never dropped', () => {
    const store = boot()
    store.getState().input({ type: 'intent', intent: { kind: 'end_turn' }, version: 6 }, CHAIN_FLOOR - 1)
    const held = store.getState().pending_end_turn
    expect(held).not.toBeNull() // delayed submit — not a rollback, not a burned turn
    expect(held.ready_at).toBe(CHAIN_FLOOR)

    // the flush door re-drives it once the remainder has passed
    store.getState().input({ type: 'flush' }, CHAIN_FLOOR - 1)
    expect(store.getState().pending_end_turn).not.toBeNull() // too early — still held
    store.getState().input({ type: 'flush' }, CHAIN_FLOOR)
    expect(store.getState().pending_end_turn).toBeNull() // submitted exactly once, on the chain's own floor
  })

  test('the SUBMIT door waits the exact remainder — the PTB never goes out early', () => {
    const store = boot()
    const state = store.getState()
    // `submit_wait_ms` is what dungeon_run_store.commit_turn sleeps for before signing: zero gas, no digest,
    // no rollback. (An EXECUTED ETurnTooFast could never be auto-retried — the burn law — so the only correct
    // answer at the boundary is to not submit yet.)
    expect(project.submit_wait_ms(state, LOCAL_EDGE + PLAYER_TURN_FLOOR_MS)).toBe(
      CHAIN_FLOOR - LOCAL_EDGE - PLAYER_TURN_FLOOR_MS
    )
    expect(project.submit_wait_ms(state, CHAIN_FLOOR - 1)).toBe(1)
    expect(project.submit_wait_ms(state, CHAIN_FLOOR)).toBe(0)
  })

  test('a turn about to EXPIRE submits now — losing it to the timer is strictly worse', () => {
    const store = boot()
    const at_the_wire = DEADLINE - PLAYER_TURN_FLOOR_MS
    // contrived, but this is the escape hatch's whole job: the min-turn floor has not lifted yet…
    const state = { ...store.getState(), turn_started_at: at_the_wire }
    expect(project.min_turn_left(state, at_the_wire)).toBeGreaterThan(0)
    // …and the submit door still lets it go, rather than sit on a turn the deadline is about to eat
    expect(project.submit_wait_ms(state, at_the_wire)).toBe(0)
  })

  test('no chain dial (a starved or stale read) falls back to the local anchor — never a fabricated floor', () => {
    const store = create_fight_store()
    store.getState().input({ type: 'init', fight_id: FIGHT, my_key: 'p0', ctx: { my_entity_id: CHAR } })
    store
      .getState()
      .input({ type: 'snapshot', fight: fight_object({ turn_ms: 0, turn_deadline_ms: 0 }), version: 5 }, LOCAL_EDGE)
    const state = store.getState()
    expect(project.min_turn_left(state, LOCAL_EDGE + 1_000)).toBe(PLAYER_TURN_FLOOR_MS - 1_000)
    expect(project.can_end_turn(state, LOCAL_EDGE + PLAYER_TURN_FLOOR_MS)).toBe(true)
  })

  test('a LATE local anchor still wins — the floor is the later of the two clocks, never the chain alone', () => {
    const store = create_fight_store()
    store.getState().input({ type: 'init', fight_id: FIGHT, my_key: 'p0', ctx: { my_entity_id: CHAR } })
    // the client only learned the turn was playable well after the chain's floor had already passed
    const late_edge = CHAIN_FLOOR + 2_000
    store.getState().input({ type: 'snapshot', fight: fight_object(), version: 5 }, late_edge)
    const state = store.getState()
    expect(project.can_end_turn(state, late_edge + PLAYER_TURN_FLOOR_MS - 1)).toBe(false)
    expect(project.can_end_turn(state, late_edge + PLAYER_TURN_FLOOR_MS)).toBe(true)
  })
})
