// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// ③ COMMIT vs THE DEADLINE — a live race where "Ending turn — committing your drafted actions" is followed by
// "Turn lost: The turn timer ran out before your actions committed — they were rolled back". INSTRUMENT-FIRST
// (scratchpad probe, captured in the return): the pure draft→commit timeline is clean — the deadline auto-commit
// fires at deadline − COMMIT_BUFFER_MS — EXCEPT one deterministic unwinnable-race the probe named: the fire time was
//   fire_at = max(deadline − COMMIT_BUFFER_MS, last_action_ms + MIN_ACTION_MS)
// and `last_action_ms + MIN_ACTION_MS` can land AFTER the deadline, so the auto-commit is SCHEDULED past the turn's
// own expiry — a guaranteed forfeit no matter how fast the wallet is. It only bites a short turn dial: turn_ms is
// chain-clamped ≥ 5s (actions.move:30) and last_action ≈ turn_start, so at the 5s minimum last_action + 5000 ≈
// deadline. The floor is the WRONG one: the chain's earliest legal end-turn is `deadline − (turn_ms − MIN_TURN_MS)`
// (actions.move:118 assert_min_turn, MIN_TURN_MS 3s), which is ≤ deadline − 2000 for every valid turn_ms ≥ 5s — so
// The default turn now fires 5s early to survive submit latency; a short admin dial clamps to the real chain gate,
// `deadline − turn_ms + MIN_TURN_MS`, so the min-dial vector remains pre-deadline and ETurnTooFast-safe.
import { describe, expect, test } from 'bun:test'

import * as project from '../src/project.js'
import { auto_commit_fire_at, COMMIT_BUFFER_MS } from '../src/draft_budget.js'
import { create_fight_store } from '../src/store.js'

const FIGHT = '0xf1'
const CHAR = '0xc1'
const DEADLINE = 100_000
// min-dial turn: turn_ms = 5s (the chain clamp), last_action ≈ turn_start = deadline − 5s. So last_action +
// MIN_ACTION_MS (5s) == the deadline — the exact crowding the old fire_at math turned into a past-deadline fire.
const LAST_ACTION = DEADLINE - 5_000 // 95_000
const MIN_DIAL_TURN_MS = 5_000
const MIN_DIAL_FIRE_AT = auto_commit_fire_at(DEADLINE, MIN_DIAL_TURN_MS)
const CHAIN_TURN_START = 1_000_000
const CHAIN_TURN_MS = 45_000
const MOB_TURN_EXTRA_MS = 3_000
const SAFE_COMMIT_LEAD_MS = 5_000
const SUBMIT_LATENCY_BUDGET_MS = 3_000
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
  mobs: [{ hp: 10, max_hp: 10, cell: 120 }],
  turn_ms: MIN_DIAL_TURN_MS,
  queue: [
    { is_mob: false, idx: 0 },
    { is_mob: true, idx: 0 },
  ],
  turn_deadline_ms: DEADLINE,
  turn_entropy: DEADLINE,
  turn_ordinal: 1,
  last_action_ms: LAST_ACTION,
}
const turn_started = {
  type: '0x0::fight_events::TurnStarted',
  parsedJson: { fight: FIGHT, is_mob: false, idx: 0, deadline_ms: DEADLINE },
}
const commit_due = project.commit_due ?? ((s) => !!s.commit_due)

const boot = () => {
  const store = create_fight_store()
  store.getState().input({ type: 'init', fight_id: FIGHT, my_key: 'p0', ctx: { my_entity_id: CHAR } })
  store.getState().input({ type: 'snapshot', fight: FIGHT_OBJECT, version: 5 }, 1_000)
  store.getState().input({ type: 'receipt', receipt: { events: [turn_started] }, version: 6 }, 1_000)
  store.getState().input({ type: 'stage', intent: { kind: 0, target: 101 } })
  return store
}

const boot_post_mob_turn = (mob_count) => {
  const deadline = CHAIN_TURN_START + CHAIN_TURN_MS + mob_count * MOB_TURN_EXTRA_MS
  const mobs = Array.from({ length: mob_count }, (_, idx) => ({ hp: 10, max_hp: 10, cell: 120 + idx }))
  const store = create_fight_store()
  store.getState().input({ type: 'init', fight_id: FIGHT, my_key: 'p0', ctx: { my_entity_id: CHAR } })
  store.getState().input(
    {
      type: 'snapshot',
      fight: {
        ...FIGHT_OBJECT,
        turn_ms: CHAIN_TURN_MS,
        turn_deadline_ms: deadline,
        last_action_ms: CHAIN_TURN_START,
        mobs,
        queue: [{ is_mob: false, idx: 0 }, ...mobs.map((_, idx) => ({ is_mob: true, idx }))],
      },
      version: 5,
    },
    CHAIN_TURN_START
  )
  store.getState().input({ type: 'stage', intent: { kind: 0, target: 101 } })
  return { store, deadline }
}

describe('③ the deadline auto-commit fires within the buffer, never past the deadline', () => {
  for (const mob_count of [1, 3])
    test(`${mob_count} mob turn fires with enough lead for submit latency`, () => {
      const { store, deadline } = boot_post_mob_turn(mob_count)
      const fire_at = deadline - SAFE_COMMIT_LEAD_MS

      store.getState().input({ type: 'tick' }, fire_at - 1)
      expect(commit_due(store.getState()), 'not due before the safe fire point').toBe(false)
      store.getState().input({ type: 'tick' }, fire_at)
      expect(commit_due(store.getState()), 'due with a real submit margin').toBe(true)
      expect(
        fire_at + SUBMIT_LATENCY_BUDGET_MS,
        'submit latency still lands strictly before chain expiry'
      ).toBeLessThan(deadline)
    })

  test('a min-dial turn (last_action + MIN_ACTION_MS crowds the deadline) still becomes due at deadline − buffer', () => {
    const store = boot()
    expect(LAST_ACTION + 5_000).toBeGreaterThanOrEqual(DEADLINE) // the crowding the old max() turned into a late fire

    // one tick before the contract-legal clamped fire point: never due yet.
    store.getState().input({ type: 'tick' }, MIN_DIAL_FIRE_AT - 1)
    expect(commit_due(store.getState()), 'not due a hair before the buffer').toBe(false)

    // AT the legal fire point the auto-commit MUST be due — still strictly before expiry.
    // RED at HEAD: fire_at = max(99_000, 95_000+5_000=100_000) = 100_000, so it does not fire until the deadline.
    store.getState().input({ type: 'tick' }, MIN_DIAL_FIRE_AT)
    expect(
      commit_due(store.getState()),
      'the deadline commit must fire at deadline − buffer, not after the deadline'
    ).toBe(true)
  })

  test('the deadline commit is never scheduled AT/after the deadline (a guaranteed forfeit)', () => {
    const store = boot()
    // Walk the last buffer window: commit_due must have already gone true BEFORE the deadline, never first at it.
    let fired_before_deadline = false
    for (let now = MIN_DIAL_FIRE_AT; now < DEADLINE; now += 100) {
      store.getState().input({ type: 'tick' }, now)
      if (commit_due(store.getState())) fired_before_deadline = true
    }
    expect(fired_before_deadline, 'the commit had a real firing window before the deadline').toBe(true)
  })
})
