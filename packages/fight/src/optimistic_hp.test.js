// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// RED-FIRST regression for died×2: DungeonBoard subtracts the whole queued cast damage from a mob HP base.
// That base must exclude this turn's own optimistic Hit intents, or cast 2 subtracts casts 1+2 from an HP value
// that already includes cast 1. Peer/receipt Hits remain committed and must still lower the base.
import { describe, expect, test } from 'bun:test'

import * as project from './project.js'
import { create_fight_store, PLAYER_TURN_FLOOR_MS } from './store.js'

const FIGHT = '0xf1'
const CHAR = '0xc1'
const TURN_STARTED_AT = 10_000
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
  mobs: [{ hp: 16, max_hp: 100, cell: 120 }],
  queue: [
    { is_mob: false, idx: 0 },
    { is_mob: true, idx: 0 },
  ],
  turn_ptr: 0,
  turn_deadline_ms: 100_000,
  last_action_ms: 0,
}

const store_from_snapshot = (fight = FIGHT_OBJECT, now = TURN_STARTED_AT) => {
  const store = create_fight_store()
  store.getState().input({ type: 'init', fight_id: FIGHT, my_key: 'p0', ctx: { my_entity_id: CHAR } })
  store.getState().input({ type: 'snapshot', fight, version: 5 }, now)
  return store
}

// Before the product selector exists, fall back to the folded board HP so the RED run captures the exact bug
// (10 - 12 = 0), not an unrelated missing-export module error. Once exported, this same test uses committed HP.
const committed_mob_hp = (state, idx) =>
  project.committed_mob_hp?.(state, idx) ?? project.board_view(state)?.mobs?.[idx]?.hp ?? 0

const peer_hit = (remaining_hp) => ({
  type: '0x0::fight_events::Hit',
  parsedJson: {
    fight: FIGHT,
    victim_is_mob: true,
    victim_idx: 0,
    amount: 16 - remaining_hp,
    remaining_hp,
  },
})

describe('committed mob HP — cumulative optimistic casts', () => {
  test('16 HP minus two queued casts of 6 stays at 4 alive, not false-dead at 0', () => {
    const store = store_from_snapshot()
    // Cast 1 has already folded its local Hit to 10. Cast 2 is now in the cumulative UI queue but has not folded.
    store.getState().input(
      {
        type: 'intent',
        intent: { kind: 'cast', target_cell: 120, damaging: true },
        version: 6,
        event_idx: 0,
      },
      TURN_STARTED_AT + 100
    )
    store.getState().input(
      {
        type: 'intent',
        intent: { kind: 'Hit', victim_is_mob: true, victim_idx: 0, remaining_hp: 10 },
        version: 6,
        event_idx: 1,
      },
      TURN_STARTED_AT + 100
    )
    const state = store.getState()
    const queued_damage = [6, 6].reduce((sum, damage) => sum + damage, 0)
    const hp = Math.max(0, committed_mob_hp(state, 0) - queued_damage)

    expect(project.board_view(state).mobs[0].hp, 'the presented HP already contains cast 1').toBe(10)
    expect({ hp, alive: hp > 0 }, 'the cumulative queue must subtract from committed 16 HP').toEqual({
      hp: 4,
      alive: true,
    })
  })

  test('a peer Hit is committed and lowers the selector HP', () => {
    const store = store_from_snapshot()
    store.getState().input({ type: 'p2p', events: [peer_hit(13)], version: 6 }, TURN_STARTED_AT + 100)

    expect(committed_mob_hp(store.getState(), 0)).toBe(13)
  })
})

describe('intent-free authoritative floor', () => {
  test('an intent does not block the next authoritative floor — the receipt raises it (M2b)', () => {
    const store = store_from_snapshot()
    store
      .getState()
      .input({ type: 'intent', intent: { kind: 'Hit', victim_is_mob: true, victim_idx: 0, remaining_hp: 10 } })

    expect(store.getState().applied_version, 'an optimistic intent is not an authoritative version').toBe(5)

    // M2b · ONE INGRESS: authoritative state enters through the receipt/journal door, never a re-adopted object read.
    // The receipt raises the floor to v6 and retires the matching prediction by claim (M6); the trailing object read
    // is only a checkpoint (a last_action_ms watermark), never a competing state source.
    store.getState().input({ type: 'receipt', receipt: { events: [peer_hit(10)] }, version: 6 }, 12_050)
    expect(store.getState().applied_version, 'the authoritative receipt raises the floor').toBe(6)
    expect(committed_mob_hp(store.getState(), 0), 'committed adopts the authoritative hit; the intent retired').toBe(10)

    const confirmed = { ...FIGHT_OBJECT, last_action_ms: 12_000, mobs: [{ ...FIGHT_OBJECT.mobs[0], hp: 10 }] }
    store.getState().input({ type: 'snapshot', fight: confirmed, version: 6 }, 12_100)
    expect(store.getState().last_action_ms, 'the checkpoint still adopts last_action_ms (events omit it)').toBe(12_000)
  })
})

describe('lethal auto-commit floor', () => {
  // Owner ruling 2026-07-21: the killing blow auto-commits after the death beat drains — the LOCAL prediction now
  // fires it (this REPLACES the old "prediction stays manual, only the receipt auto-commits" rule). The full drain
  // + only-lethal + single-fire + failure-latch matrix lives in lethal_auto_commit.test.js; here we hold the FLOOR.
  test('a drained lethal prediction auto-commits after the player-turn floor', () => {
    const store = store_from_snapshot()
    store.getState().input({ type: 'stage', intent: { kind: 1, target: 120 } })
    store
      .getState()
      .input({ type: 'intent', intent: { kind: 'Hit', victim_is_mob: true, victim_idx: 0, remaining_hp: 0 } })

    store.getState().input({ type: 'tick' }, TURN_STARTED_AT + PLAYER_TURN_FLOOR_MS - 1)
    expect(project.commit_due(store.getState()), 'the min-turn floor still gates the auto-commit').toBe(false)

    store.getState().input({ type: 'tick' }, TURN_STARTED_AT + PLAYER_TURN_FLOOR_MS)
    expect(
      project.commit_due(store.getState()),
      'the lethal prediction auto-commits once the floor passes and its beat has drained'
    ).toBe(true)
  })
})
