// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, test, expect } from 'bun:test'

import { create_fight_store, PLAYER_TURN_FLOOR_MS } from './store.js'
import { MOB_TURN_MS, pace_segment } from './present.js'
import * as project from './project.js'

// REGRESSION STUBS (two pacing corrections):
//  · PLAYER FLOOR: "minimum turn time is correct … 3s for players minimum … the issue is that right now you
//    enforced 3s per each of my spell cast and this is dumb." → ONE 3s floor per player turn from the turn's own
//    start; casts inside the turn are INSTANT and add ZERO gating (the per-cast disease must be impossible here).
//  · MOB PACING: "it's 3s per mob turn, if you're alone against 6 mobs then it's 3x6." → each mob turn ≈3s; a
//    6-mob wave ≈18s. (Chain-side: turns.move assert clock−turn_start≥3000 on end_turn is ticketed next wave.)

const PKG = '0xa11ce5_pkg_synthetic'
const FIGHT = '0xf16h7_synthetic'
const ev = (name, json) => ({ type: `${PKG}::fight_events::${name}`, parsedJson: { fight: FIGHT, ...json } })

const open_my_turn = (store, at) =>
  store.getState().input(
    {
      type: 'receipt',
      receipt: { events: [ev('TurnStarted', { is_mob: false, idx: 0, deadline_ms: at + 30_000 })] },
      version: 1,
    },
    at
  )

describe('player min-turn floor — one 3s floor per turn, casts free', () => {
  const T0 = 1_000_000

  test('the floor is 3s from turn start and it is MY turn', () => {
    const store = create_fight_store()
    store.getState().input({ type: 'init', fight_id: FIGHT, my_key: 'p0' })
    open_my_turn(store, T0)
    expect(store.getState().turn_started_at).toBe(T0)
    expect(project.is_my_turn(store.getState())).toBe(true)
    expect(project.min_turn_left(store.getState(), T0 + 1000)).toBe(PLAYER_TURN_FLOOR_MS - 1000)
    expect(project.can_end_turn(store.getState(), T0 + 1000)).toBe(false)
    expect(project.can_end_turn(store.getState(), T0 + 3000)).toBe(true)
  })

  test('three casts inside the turn add ZERO gating (the per-cast disease is impossible)', () => {
    const store = create_fight_store()
    store.getState().input({ type: 'init', fight_id: FIGHT, my_key: 'p0' })
    open_my_turn(store, T0)
    for (let i = 0; i < 3; i++)
      store
        .getState()
        .input(
          { type: 'intent', intent: { kind: 'cast', target_cell: 10 + i, damaging: false }, version: 2, event_idx: i },
          T0 + 100 * (i + 1)
        )
    // floor anchor NEVER re-stamped by a cast; still measured from T0 alone; still my turn
    expect(store.getState().turn_started_at).toBe(T0)
    expect(store.getState().active).toBe('p0')
    expect(project.min_turn_left(store.getState(), T0 + 300)).toBe(PLAYER_TURN_FLOOR_MS - 300)
  })

  test('a sub-3s end-turn is HELD until the floor, then commits', () => {
    const store = create_fight_store()
    store.getState().input({ type: 'init', fight_id: FIGHT, my_key: 'p0' })
    open_my_turn(store, T0)
    store.getState().input({ type: 'intent', intent: { kind: 'end_turn' }, version: 2, event_idx: 3 }, T0 + 2999)
    expect(store.getState().pending_end_turn).not.toBeNull()
    expect(store.getState().active).toBe('p0') // turn NOT ended yet
    store.getState().input({ type: 'flush' }, T0 + 2999) // still early
    expect(store.getState().active).toBe('p0')
    store.getState().input({ type: 'flush' }, T0 + 3000) // floor reached → commit
    expect(store.getState().pending_end_turn).toBeNull()
    expect(store.getState().active).toBeNull() // optimistic TurnEnded applied
  })
})

describe('mob wave pacing — 3s per mob turn (6 mobs = 18s)', () => {
  const ctx = {
    fight_id: FIGHT,
    grid_width: 20,
    resolve_fighter_id: ({ is_mob, idx }) => (is_mob ? `mob-${idx}` : `player-${idx}`),
  }
  const is_local = (turn) => turn.source_id.startsWith('player')
  const mob_wave = (n) => {
    const out = []
    for (let i = 0; i < n; i++) {
      out.push(ev('MobMoved', { idx: i, to_cell: 40 + i }))
      out.push(ev('Cast', { caster_is_mob: true, caster_idx: i, target_cell: 3 }))
      out.push(ev('Hit', { victim_is_mob: false, victim_idx: 0, amount: 1, remaining_hp: 40 - i }))
    }
    return out
  }

  test('one mob turn ≈ 3s', () => {
    const paced = pace_segment(mob_wave(1), ctx, { is_local })
    expect(paced.turns.length).toBe(1)
    expect(paced.total_duration).toBe(MOB_TURN_MS)
  })

  test('six mobs alone ≈ 18s, each mob a readable ~3s slot', () => {
    const paced = pace_segment(mob_wave(6), ctx, { is_local })
    expect(paced.turns.length).toBe(6)
    expect(paced.total_duration).toBe(6 * MOB_TURN_MS)
    for (const turn of paced.turns) {
      expect(turn.is_local).toBe(false)
      expect(turn.duration).toBe(MOB_TURN_MS)
      expect(turn.beats.length).toBeGreaterThan(0)
    }
  })
})
