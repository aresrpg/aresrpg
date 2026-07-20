// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// RED-FIRST regression for the D36 turn-theft wall: deadline auto-commit used to live in a setTimeout closure.
// A new TurnStarted could fold a fresh deadline while that closure still held the prior turn's deadline, so the
// callback committed in the middle of the live turn. Time now enters the reducer as `tick`; its decision must read
// the currently folded deadline on every tick, never a deadline captured by an edge callback.
import { describe, expect, test } from 'bun:test'

import * as project from './project.js'
import { create_fight_store } from './store.js'

const FIGHT = '0xf1'
const CHAR = '0xc1'
const FIGHT_OBJECT = {
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
  mobs: [],
  turn_deadline_ms: 40_000,
  last_action_ms: 50_000,
}
const STALE_FIGHT_OBJECT = { ...FIGHT_OBJECT, last_action_ms: 1_000 }
const turn_started_me = {
  type: '0x0::fight_events::TurnStarted',
  parsedJson: { fight: FIGHT, is_mob: false, idx: 0, deadline_ms: 100_000 },
}
const turn_ended_me = {
  type: '0x0::fight_events::TurnEnded',
  parsedJson: { fight: FIGHT, is_mob: false, idx: 0 },
}
const hit_mob = (idx, remaining_hp) => ({
  type: '0x0::fight_events::Hit',
  parsedJson: { fight: FIGHT, victim_is_mob: true, victim_idx: idx, remaining_hp },
})
const starved_turn_started_me = {
  type: '0x0::fight_events::TurnStarted',
  parsedJson: { fight: FIGHT, is_mob: false, idx: 0, deadline_ms: 0 },
}
const FIGHT_WITH_MOBS = {
  ...FIGHT_OBJECT,
  turn_deadline_ms: 100_000,
  last_action_ms: 10_000,
  queue: [
    { is_mob: false, idx: 0 },
    { is_mob: true, idx: 0 },
    { is_mob: true, idx: 1 },
  ],
  mobs: [
    { hp: 10, max_hp: 10, cell: 120 },
    { hp: 10, max_hp: 10, cell: 121 },
  ],
}

const commit_due = project.commit_due ?? ((state) => !!state.commit_due)
const deadline_starved = (state) => project.engine_view(state)?.deadline_starved ?? false

describe('tick auto-commit — the reducer reads the live folded deadline', () => {
  test('TurnStarted adopts its authoritative deadline without a client-side deadline floor', () => {
    const store = create_fight_store()
    store.getState().input({ type: 'init', fight_id: FIGHT, my_key: 'p0', ctx: { my_entity_id: CHAR } })
    store.getState().input({ type: 'snapshot', fight: FIGHT_OBJECT, version: 5 }, 1_000)
    store.getState().input({ type: 'receipt', receipt: { events: [turn_started_me] }, version: 6 }, 2_000)
    expect(store.getState().turn_deadline_ms).toBe(100_000)
  })

  test('stale snapshot after fresh TurnStarted waits for the live deadline', () => {
    const store = create_fight_store()
    store.getState().input({ type: 'init', fight_id: FIGHT, my_key: 'p0', ctx: { my_entity_id: CHAR } })
    store.getState().input({ type: 'snapshot', fight: FIGHT_OBJECT, version: 5 }, 1_000)
    store.getState().input({ type: 'receipt', receipt: { events: [turn_started_me] }, version: 6 }, 2_000)
    // Version inflation makes this semantically stale object look newer. Observed chain clocks remain monotonic.
    store.getState().input({ type: 'snapshot', fight: STALE_FIGHT_OBJECT, version: 7 }, 55_000)
    expect(store.getState().turn_deadline_ms, 'the stale higher-version deadline cannot regress live time').toBe(
      100_000
    )
    expect(store.getState().last_action_ms, 'the stale higher-version action floor cannot regress').toBe(50_000)
    store.getState().input({ type: 'stage', intent: { kind: 0, target: 101 } })

    store.getState().input({ type: 'tick' }, 55_000)
    expect(commit_due(store.getState()), 'the prior turn timer would already have fired here').toBe(false)

    store.getState().input({ type: 'tick' }, 99_000)
    expect(commit_due(store.getState()), 'the live 100s deadline becomes due inside its commit buffer').toBe(true)
  })

  test('a last-mob kill waits for the chain action floor and receipt, then becomes due', () => {
    const store = create_fight_store()
    store.getState().input({ type: 'init', fight_id: FIGHT, my_key: 'p0', ctx: { my_entity_id: CHAR } })
    store.getState().input({ type: 'snapshot', fight: FIGHT_WITH_MOBS, version: 5 }, 1_000)
    store.getState().input({ type: 'stage', intent: { kind: 1, target: 120 } })
    store
      .getState()
      .input({ type: 'intent', intent: { kind: 'Hit', victim_is_mob: true, victim_idx: 0, remaining_hp: 0 } })

    store.getState().input({ type: 'tick' }, 15_000)
    expect(commit_due(store.getState()), 'one living mob keeps kill-flush disarmed').toBe(false)

    store
      .getState()
      .input({ type: 'intent', intent: { kind: 'Hit', victim_is_mob: true, victim_idx: 1, remaining_hp: 0 } })
    store.getState().input({ type: 'tick' }, 14_999)
    expect(commit_due(store.getState()), 'the final kill cannot bypass last_action_ms + 5s').toBe(false)
    store.getState().input({ type: 'tick' }, 15_000)
    expect(commit_due(store.getState()), 'an optimistic final kill cannot auto-submit before its receipt').toBe(false)

    store.getState().input({ type: 'receipt', receipt: { events: [hit_mob(0, 0), hit_mob(1, 0)] }, version: 6 }, 15_000)
    store.getState().input({ type: 'tick' }, 15_000)
    expect(commit_due(store.getState())).toBe(true)
  })

  test('a drafted killing cast with an unknown deadline never raises the due edge', () => {
    const store = create_fight_store()
    const starved = {
      ...FIGHT_WITH_MOBS,
      mobs: [FIGHT_WITH_MOBS.mobs[0]],
      queue: [
        { is_mob: false, idx: 0 },
        { is_mob: true, idx: 0 },
      ],
      turn_deadline_ms: 0,
    }
    store.getState().input({ type: 'init', fight_id: FIGHT, my_key: 'p0', ctx: { my_entity_id: CHAR } })
    store.getState().input({ type: 'snapshot', fight: starved, version: 5 }, 1_000)
    store.getState().input({ type: 'stage', intent: { kind: 1, target: 120 } })
    store
      .getState()
      .input({ type: 'intent', intent: { kind: 'Hit', victim_is_mob: true, victim_idx: 0, remaining_hp: 0 } })

    store.getState().input({ type: 'tick' }, 15_000)
    expect(commit_due(store.getState()), 'deadline 0 must disarm both deadline and kill auto-commit').toBe(false)
  })

  test('a same-actor next turn cannot reuse the prior turn deadline', () => {
    const store = create_fight_store()
    store.getState().input({ type: 'init', fight_id: FIGHT, my_key: 'p0', ctx: { my_entity_id: CHAR } })
    store.getState().input({ type: 'snapshot', fight: STALE_FIGHT_OBJECT, version: 5 }, 1_000)
    store
      .getState()
      .input({ type: 'receipt', receipt: { events: [turn_ended_me, starved_turn_started_me] }, version: 6 }, 2_000)
    store.getState().input({ type: 'stage', intent: { kind: 1, target: 120 } })

    store.getState().input({ type: 'tick' }, 39_000)
    expect(commit_due(store.getState()), 'the prior 40s clock is stale for this new p0 turn').toBe(false)
  })

  test('a starved active turn exposes the sync-chip flag alongside the disarmed due edge', () => {
    const store = create_fight_store()
    store.getState().input({ type: 'init', fight_id: FIGHT, my_key: 'p0', ctx: { my_entity_id: CHAR } })
    store.getState().input({ type: 'snapshot', fight: { ...FIGHT_OBJECT, turn_deadline_ms: 0 }, version: 5 }, 1_000)
    store.getState().input({ type: 'stage', intent: { kind: 1, target: 120 } })
    store.getState().input({ type: 'tick' }, 39_000)

    expect(deadline_starved(store.getState()), 'the global sync chip must surface the missing current-turn clock').toBe(
      true
    )
    expect(commit_due(store.getState()), 'the same starved state must stay disarmed').toBe(false)

    store.getState().input({ type: 'receipt', receipt: { events: [turn_started_me] }, version: 6 }, 40_000)
    expect(deadline_starved(store.getState()), 'a freshly observed current-turn deadline clears the chip').toBe(false)
  })
})
