// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//
// #1993 TRAIN 0 — THE ACCEPTANCE ASSERT for `fight_visible_view`, the one fight-visible projection.
//
// Design review constraint ①: a PURE function over the fold's state — no store of its own, no subscription, no
// write door; memoization keyed on STATE IDENTITY ONLY. The standing assert is therefore literal: recompute the
// view from the same raw state (a fresh object identity, so the memo cannot serve it) and it must be DEEP-EQUAL
// to the memoized served view. A memo keyed on anything else — a version counter, a dirty flag, a subscription —
// reds here the first time two different states share that key.
//
// Constraint "AT CURRENT PARITY": every key below is asserted against the fragment that produces it today
// (`engine_view` / `project_state` predicates), so train 0 provably moved the shape and not the values.

import { describe, expect, test } from 'bun:test'

import {
  cast_presenting,
  chain_terminal_status,
  commit_due,
  deadline_starved,
  decided_outcome,
  draining,
  engine_view,
  fight_visible_view,
  input_armed,
  is_my_turn,
  is_over,
  outcome_winner,
  settlement_request,
} from '../src/project.js'
import { create_fight_store, min_turn_ready_at } from '../src/store.js'

const FIGHT = '0xvisible_view_fight'
const ME = '0xchar_visible_view'
const OWNER = '0xowner_visible_view'
const T0 = 1_000_000

const ev = (kind, json) => ({ type: `0xpkg::fight_events::${kind}`, parsedJson: { fight: FIGHT, ...json } })

/** A decoded-Fight-shaped PLAIN object — the board_state_from_fight input contract (scenario_solo's shape). */
const fight_object = () => ({
  id: FIGHT,
  status: 1, // engine ACTIVE
  width: 20,
  height: 19,
  participants: [
    {
      owner: OWNER,
      character: ME,
      class: 'warrior',
      team: 0,
      hp: 50,
      max_hp: 50,
      ap: 12,
      mp: 3,
      base_ap: 12,
      base_mp: 3,
      cell: 21,
      ready: true,
      casts_this_turn: 0,
      weapon: null,
    },
  ],
  group_template: '0xmob_t',
  group_base_ap: 6,
  group_base_mp: 3,
  mobs: [{ template: '0xmob_t', level: 3, hp: 40, max_hp: 40, cell: 45, ap: 6, mp: 3 }],
  obstacles: [],
  holes: [],
  shape_mask: [],
  start_cells_a: [21, 22],
  start_cells_b: [],
  turn_ptr: 0,
  queue: [],
  turn_deadline_ms: T0 + 90_000,
  turn_entropy: T0 + 90_000,
  turn_ordinal: 1,
  placement_deadline_ms: 0,
  world_seed: null,
  spawn_id: null,
  last_action_ms: 0,
})

/** A live fight at MY turn, one exchange folded — a state with real entities, a real clock and a real actor. */
const live_state = () => {
  const store = create_fight_store()
  store
    .getState()
    .input(
      { type: 'init', fight_id: FIGHT, ctx: { my_entity_id: ME, address: OWNER, beat_ctx: { grid_width: 20 } } },
      T0
    )
  store.getState().input({ type: 'snapshot', fight: fight_object(), version: 1 }, T0 + 100)
  store.getState().input(
    {
      type: 'receipt',
      receipt: {
        events: [
          ev('TurnStarted', { is_mob: false, idx: 0, deadline_ms: T0 + 90_000 }),
          ev('Cast', { caster_is_mob: false, caster_idx: 0, target_cell: 45 }),
          ev('Hit', {
            victim_is_mob: true,
            victim_idx: 0,
            amount: 20,
            remaining_hp: 20,
            caster_is_mob: false,
            caster_idx: 0,
          }),
        ],
      },
      version: 2,
    },
    T0 + 2_000
  )
  return store.getState()
}

const KEYS = ['turn', 'entities', 'result', 'sync', 'mount', 'controls']

describe('#1993 train 0 — fight_visible_view owns all six fight-visible facts', () => {
  test('the six keys exist on a live fight AND on a session that never adopted a board', () => {
    expect(Object.keys(fight_visible_view(live_state())).sort()).toEqual([...KEYS].sort())
    // Never null: a pre-adoption session answers mount/sync honestly instead of forcing callers to invent it.
    const fresh = create_fight_store().getState()
    expect(Object.keys(fight_visible_view(fresh)).sort()).toEqual([...KEYS].sort())
    expect(fight_visible_view(fresh).mount.adopted).toBe(false)
    expect(fight_visible_view(fresh).entities).toEqual({})
  })

  test('entities are id-keyed rows of identity · cells · vitals · statuses', () => {
    const view = fight_visible_view(live_state())
    expect(Object.keys(view.entities).sort()).toEqual([ME, 'mob-0'])
    for (const row of Object.values(view.entities))
      expect(Object.keys(row).sort()).toEqual(['cells', 'id', 'identity', 'statuses', 'vitals'])
    expect(view.entities[ME].identity.is_player).toBe(true)
    expect(view.entities['mob-0'].identity.is_player).toBe(false)
    // committed / presented / display are DISTINCT named facts, not three spellings of one read.
    expect(Object.keys(view.entities['mob-0'].cells).sort()).toEqual(['committed', 'display', 'presented', 'xy'])
    expect(view.entities['mob-0'].cells.committed).toBe(45)
    expect(view.entities['mob-0'].cells.xy).toEqual({ x: 5, y: 2 })
    expect(view.entities['mob-0'].vitals.committed).toBe(20) // the folded Hit, not the stale snapshot's 40
    expect(view.entities['mob-0'].vitals.max).toBe(40)
    expect(Array.isArray(view.entities[ME].statuses)).toBe(true)
  })
})

describe('#1993 constraint ① — pure projection, memoized on state identity ONLY', () => {
  test('THE ACCEPTANCE ASSERT: a recompute from the same raw state deep-equals the memoized served view', () => {
    const state = live_state()
    const served = fight_visible_view(state)
    expect(fight_visible_view(state)).toBe(served) // memo hit: same identity in, same object out
    // A FRESH identity over the SAME raw state cannot hit the memo, so this recomputes from scratch.
    const recomputed = fight_visible_view({ ...state })
    expect(recomputed).not.toBe(served)
    expect(recomputed).toEqual(served)
  })

  test('projecting reads nothing beside the state and writes nothing back to the store', () => {
    const store = create_fight_store()
    store.getState().input({ type: 'init', fight_id: FIGHT, ctx: { my_entity_id: ME } }, T0)
    store.getState().input({ type: 'snapshot', fight: fight_object(), version: 1 }, T0 + 100)
    const before = store.getState()
    let notifications = 0
    const unsubscribe = store.subscribe(() => {
      notifications += 1
    })
    fight_visible_view(before)
    unsubscribe()
    expect(store.getState()).toBe(before) // no write door
    expect(notifications).toBe(0) // no dispatch, no listener
  })

  test('the served object is deeply immutable', () => {
    const view = fight_visible_view(live_state())
    expect(Object.isFrozen(view)).toBe(true)
    expect(Object.isFrozen(view.turn)).toBe(true)
    expect(Object.isFrozen(view.turn.deadlines)).toBe(true)
    expect(Object.isFrozen(view.entities[ME])).toBe(true)
    expect(Object.isFrozen(view.entities[ME].vitals)).toBe(true)
    expect(Object.isFrozen(view.entities[ME].statuses)).toBe(true)
    expect(() => {
      'use strict'
      view.turn.winner = 99
    }).toThrow()
  })

  test('a fresh state object always recomputes — a stale view is unrepresentable', () => {
    const store = create_fight_store()
    store.getState().input({ type: 'init', fight_id: FIGHT, ctx: { my_entity_id: ME } }, T0)
    const opening = fight_visible_view(store.getState())
    store.getState().input({ type: 'snapshot', fight: fight_object(), version: 1 }, T0 + 100)
    const adopted = fight_visible_view(store.getState())
    expect(opening.mount.adopted).toBe(false)
    expect(adopted.mount.adopted).toBe(true)
  })
})

describe('#1993 train 0 — every field is AT CURRENT PARITY with the fragment that produces it today', () => {
  const state = live_state()
  const view = fight_visible_view(state)
  const engine = engine_view(state)

  test('turn mirrors engine_view + the project_state predicates exactly', () => {
    expect(view.turn.order).toEqual(engine.turn_order)
    expect(view.turn.active_entity_id).toBe(engine.active_entity_id)
    expect(view.turn.presenting_entity_id).toBe(engine.presenting_entity_id)
    expect(view.turn.placement).toBe(engine.placement)
    expect(view.turn.placement_cells).toEqual(engine.placement_cells)
    expect(view.turn.winner).toBe(engine.winner)
    expect(view.turn.anchor_ordinal).toBe(engine.turn_ordinal)
    expect(view.turn.my_turn_no).toBe(engine.my_turn_no)
    expect(view.turn.turn_number).toBe(engine.turn_number)
    expect(view.turn.is_my_turn).toBe(is_my_turn(state))
    expect(view.turn.input_armed).toBe(input_armed(state))
    expect(view.turn.presenting).toBe(engine.presenting)
    expect(view.turn.cast_presenting).toBe(cast_presenting(state))
    expect(view.turn.draining).toBe(draining(state))
    expect(view.turn.deadlines.turn_deadline_ms).toBe(engine.turn_deadline_ms)
    expect(view.turn.deadlines.starved).toBe(deadline_starved(state))
    // The two facts that share the name `turn_ordinal` in the tree, named apart: the fold ANCHOR vs the CHAIN seed.
    expect(view.turn.seed.turn_ordinal).toBe(state.view.turn_ordinal)
    expect(view.turn.seed.turn_entropy).toBe(state.view.turn_entropy)
  })

  test('entities mirror the engine_view fighter rows, regrouped and named', () => {
    for (const [id, row] of Object.entries(view.entities)) {
      const fighter = engine.fighters.get(id)
      expect(row.identity.name).toBe(fighter.name)
      expect(row.identity.team).toBe(fighter.team)
      expect(row.identity.level).toBe(fighter.level)
      expect(row.cells.xy).toEqual(fighter.cell)
      expect(row.vitals.committed).toBe(fighter.committed_health)
      expect(row.vitals.predicted).toBe(fighter.health)
      expect(row.vitals.display).toBe(fighter.presented_health)
      expect(row.vitals.max).toBe(fighter.health_max)
      expect(row.vitals.alive).toBe(fighter.committed_alive)
      expect(row.vitals.dead).toBe(fighter.dead)
      expect(row.statuses).toEqual(fighter.effects)
    }
  })

  test('result mirrors the outcome selectors with the precedence they already apply', () => {
    expect(view.result.winner).toBe(outcome_winner(state))
    expect(view.result.chain_terminal_status).toBe(chain_terminal_status(state))
    expect(view.result.decided).toBe(decided_outcome(state))
    expect(view.result.is_over).toBe(is_over(state))
    expect(view.result.settlement_request).toEqual(settlement_request(state))
    expect(view.result.provenance).toBe(null) // an undecided live fight names no terminal home
  })

  test('sync/mount/controls mirror the ad-hoc verdicts the surfaces derive today', () => {
    // fight_actor_unresolved, verbatim: an id without a fighter row is a transient turn, never a playable one.
    expect(view.sync.actor_unresolved).toBe(
      engine.active_entity_id == null || !engine.fighters.has(engine.active_entity_id)
    )
    expect(view.sync.board_adopted).toBe(true)
    expect(view.sync.starved).toBe(deadline_starved(state))
    expect(typeof view.sync.truth_version).toBe('number')
    expect(view.mount.fight_id).toBe(engine.fight_id)
    expect(view.mount.scope).toBe('world') // a chain Fight object id; `sim:` sessions are the other scope
    expect(view.mount.viewer.my_entity_id).toBe(engine.my_entity_id)
    expect(view.mount.viewer.controlled_entity_ids).toEqual(engine.controlled_entity_ids)
    expect(view.mount.viewer.spectator).toBe(engine.spectator)
    expect(view.controls.busy).toBe(!!state.busy)
    expect(view.controls.commit_due).toBe(commit_due(state))
    expect(view.controls.draft_count).toBe(engine.draft_count)
    expect(view.controls.min_turn_ready_at).toBe(min_turn_ready_at(state))
    expect(view.controls.end_turn_eligible).toBe(is_my_turn(state) && !is_over(state))
    expect(view.controls.phase).toBe('armed') // my live turn, nothing draining, no commit in flight
  })

  test('a sim-scoped session reads as sim, never as a world fight', () => {
    const store = create_fight_store()
    store.getState().input({ type: 'init', fight_id: 'sim:local', ctx: { my_entity_id: ME } }, T0)
    store.getState().input({ type: 'snapshot', fight: { ...fight_object(), id: 'sim:local' }, version: 1 }, T0 + 100)
    const { mount } = fight_visible_view(store.getState())
    expect(mount.scope).toBe('sim')
    expect(mount.sim_active).toBe(true)
    expect(mount.world_active).toBe(false)
  })
})
