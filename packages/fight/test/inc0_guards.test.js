// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// INC-0 — the additive guards + honest oracle (CONSENSUS_PLAN §2/§3, VIOLATION_REGISTER #6 #9(part) #18
// #30(part) #42 #50 #52). RED-FIRST: every row below FAILS against HEAD (no provider token, no session-identity
// drop, no rollback input, a blind parity oracle) and GREENS once the guards land. Plain objects through the ONE
// door — the scenario_solo idiom (D768).
import { describe, test, expect } from 'bun:test'

import { create_fight_store } from '../src/store.js'
import { fingerprint_state } from '../src/core.js'
import { engine_view, board_view } from '../src/project.js'

const FIGHT = '0xf1647'
const OTHER_FIGHT = '0xdead0'
const ME = '0xchar_a'
const OWNER = '0xa11ce'
const T0 = 1_000_000

const ev = (kind, json) => ({ type: `0xpkg::fight_events::${kind}`, parsedJson: { fight: FIGHT, ...json } })

const fight_object = ({ status = 0, my = {}, mob = {}, deadline = 0 } = {}) => ({
  id: FIGHT,
  status,
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
      ap: 0,
      mp: 0,
      base_ap: 12,
      base_mp: 3,
      cell: 0,
      ready: false,
      casts_this_turn: 0,
      weapon: null,
      ...my,
    },
  ],
  group_template: '0xmob_t',
  group_base_ap: 6,
  group_base_mp: 3,
  mobs: [{ template: '0xmob_t', level: 3, hp: 20, max_hp: 20, cell: 45, ap: 6, mp: 3, ...mob }],
  obstacles: [],
  holes: [],
  shape_mask: [],
  start_cells_a: [21, 22],
  start_cells_b: [],
  turn_ptr: 0,
  queue: [],
  turn_deadline_ms: deadline,
  turn_entropy: deadline,
  turn_ordinal: 1,
  placement_deadline_ms: T0 + 60_000,
  world_seed: null,
  spawn_id: null,
  last_action_ms: 0,
})

const boot = () => {
  const store = create_fight_store()
  store
    .getState()
    .input(
      { type: 'init', fight_id: FIGHT, ctx: { my_entity_id: ME, address: OWNER, beat_ctx: { grid_width: 20 } } },
      T0
    )
  return store
}

const D1 = T0 + 30_000
/** init → placement snapshot → placed+ready → my TurnStarted (playable, provider = local_turn). */
const active_store = () => {
  const store = boot()
  store.getState().input({ type: 'snapshot', fight: fight_object({ status: 0 }), version: 1 }, T0 + 100)
  store.getState().input(
    {
      type: 'receipt',
      receipt: { events: [ev('Placed', { character: ME, cell: 21 }), ev('Ready', { character: ME })] },
      version: 2,
    },
    T0 + 500
  )
  store.getState().input(
    {
      type: 'receipt',
      receipt: { events: [ev('TurnStarted', { is_mob: false, idx: 0, deadline_ms: D1 })] },
      version: 3,
    },
    T0 + 1_000
  )
  return store
}

const image_of = (store) => fingerprint_state(store.getState().core)

/** A single-PTB turn receipt: my turn ends → a mob turn (paced into a draining wave) → my next turn. */
const turn_receipt = () => ({
  events: [
    ev('TurnEnded', { is_mob: false, idx: 0 }),
    ev('TurnStarted', { is_mob: true, idx: 0 }),
    ev('MobMoved', { idx: 0, to_cell: 41 }),
    ev('Cast', { caster_is_mob: true, caster_idx: 0, target_cell: 21 }),
    ev('Hit', { victim_is_mob: false, victim_idx: 0, amount: 6, remaining_hp: 44, caster_is_mob: true, caster_idx: 0 }),
    ev('TurnEnded', { is_mob: true, idx: 0 }),
    ev('TurnStarted', { is_mob: false, idx: 0, deadline_ms: T0 + 90_000 }),
  ],
})

describe('INC-0 · provider token (NORTH_STAR C2/C3 — the mechanical floor)', () => {
  test('my intent during my local turn is applied (provider = local_turn)', () => {
    const store = active_store()
    expect(store.getState().provider).toBe('local_turn')
    store
      .getState()
      .input({ type: 'intent', intent: { kind: 'cast', ap_cost: 5, damaging: true, target_cell: 45 } }, T0 + 1_100)
    expect(board_view(store.getState()).escrow[0].ap).toBe(7) // the draft debited — applied
    expect(store.getState().refused).toBeNull()
  })

  test('an intent during a draining mob wave is REFUSED + logged, never applied (provider = chain_replay)', () => {
    const store = active_store()
    store.getState().input({ type: 'receipt', receipt: turn_receipt(), version: 4 }, T0 + 6_000)
    const before = {
      ap: board_view(store.getState()).escrow[0].ap,
      entries: store.getState().entries,
    }
    expect(store.getState().provider).toBe('chain_replay')
    // A HUD click that would push predicted state while the chain holds the mic (C3: "HUD triggers NOTHING").
    store
      .getState()
      .input({ type: 'intent', intent: { kind: 'cast', ap_cost: 5, damaging: true, target_cell: 45 } }, T0 + 6_100)
    expect(
      {
        ap: board_view(store.getState()).escrow[0].ap,
        entries: store.getState().entries,
      },
      'the refused intent changed no prediction state'
    ).toEqual(before)
    expect(store.getState().refused).toMatchObject({ type: 'intent', reason: 'provider', provider: 'chain_replay' })
  })
})

describe('INC-0 · session identity (B-F02/F06 — A→B crossings drop, id-less resume HELD)', () => {
  test('a snapshot for a DIFFERENT fight is dropped + logged, never adopted', () => {
    const store = active_store()
    const before = image_of(store)
    store.getState().input(
      {
        type: 'snapshot',
        fight: { ...fight_object({ status: 1 }), id: OTHER_FIGHT },
        version: 99,
        fight_id: OTHER_FIGHT,
      },
      T0 + 2_000
    )
    expect(store.getState().view_version).not.toBe(99) // fight B never adopted into fight A
    expect(image_of(store)).toEqual(before)
    expect(store.getState().refused).toMatchObject({ type: 'snapshot', reason: 'fight_id' })
  })

  test('a snapshot with a MISSING fight_id is HELD (adopted), not dropped (PLAN_SEQUENCING R5)', () => {
    const store = active_store()
    // A legit resume read that carries no explicit fight_id must NOT be dropped — the current session claims it.
    store.getState().input(
      {
        type: 'snapshot',
        fight: fight_object({ status: 1, my: { hp: 44, cell: 21, ready: true }, mob: { hp: 4, cell: 41 } }),
        version: 7,
      },
      T0 + 2_000
    )
    // The identity gate claims the id-less read for this session, then the single snapshot door re-adopts it because
    // v7 is ahead. It is neither rejected nor partially merged with the v1 base.
    expect(store.getState().refused, 'the id-less read passed the identity gate').toBeNull()
    expect(store.getState().view_version, 'the ahead read replaces the base').toBe(7)
    expect(engine_view(store.getState()).fighters.get(ME).health).toBe(44)
  })
})

describe('INC-0 · rollback input (B-F03 — a reverted tx clears predicted state)', () => {
  test('a reverted tx clears exactly the predicted entry; recompute falls back to committed', () => {
    const store = active_store()
    store.getState().input(
      {
        type: 'intent',
        intent: { kind: 'cast', ap_cost: 5, damaging: true, target_cell: 45 },
        version: 4,
        event_idx: 0,
      },
      T0 + 1_100
    )
    store.getState().input(
      {
        type: 'intent',
        intent: { kind: 'Hit', victim_is_mob: true, victim_idx: 0, remaining_hp: 8 },
        version: 4,
        event_idx: 1,
      },
      T0 + 1_100
    )
    // the prediction painted: mob HP shows 8, my AP debited to 7
    expect(engine_view(store.getState()).fighters.get('mob-0').health).toBe(8)
    expect(board_view(store.getState()).escrow[0].ap).toBe(7)
    expect(Object.values(store.getState().entries).some((e) => e.source === 'intent')).toBe(true)

    // the tx reverted — the reducer removes the predicted entries and recomputes to committed truth
    store.getState().input({ type: 'rollback' }, T0 + 1_500)
    expect(Object.values(store.getState().entries).some((e) => e.source === 'intent')).toBe(false)
    expect(engine_view(store.getState()).fighters.get('mob-0').health).toBe(20) // committed HP restored
    expect(board_view(store.getState()).escrow[0].ap).toBe(12) // AP prediction cleared
  })

  test('a targeted rollback removes only the named predicted entry', () => {
    const store = active_store()
    store.getState().input(
      {
        type: 'intent',
        intent: { kind: 'Hit', victim_is_mob: true, victim_idx: 0, remaining_hp: 12 },
        version: 4,
        event_idx: 0,
      },
      T0 + 1_100
    )
    store.getState().input(
      {
        type: 'intent',
        intent: { kind: 'Hit', victim_is_mob: true, victim_idx: 0, remaining_hp: 4 },
        version: 4,
        event_idx: 1,
      },
      T0 + 1_200
    )
    store.getState().input({ type: 'rollback', predicts: { version: 4, event_idx: 1 } }, T0 + 1_300)
    // only event_idx 1 removed — the first prediction (HP 12) survives
    expect(engine_view(store.getState()).fighters.get('mob-0').health).toBe(12)
    expect(Object.values(store.getState().entries).filter((e) => e.source === 'intent').length).toBe(1)
  })
})

describe('INC-0 · composite prediction (rider #1 — a whole cast folds atomically)', () => {
  const cast_batch = () => ({
    type: 'predicted',
    intent_id: 'cast-1',
    basis_version: 5,
    actions: [
      { kind: 'cast', ap_cost: 5, damaging: true, target_cell: 45 },
      { kind: 'Hit', victim_is_mob: true, victim_idx: 0, remaining_hp: 6 },
    ],
  })

  test('a `predicted` cast folds all effects in ONE store update — never a partial cast', () => {
    const store = active_store()
    let notifications = 0
    const seen = []
    const unsub = store.subscribe(() => {
      notifications++
      seen.push({
        ap: board_view(store.getState()).escrow[0].ap,
        mob_hp: engine_view(store.getState()).fighters.get('mob-0').health,
      })
    })
    store.getState().input(cast_batch(), T0 + 1_100)
    unsub()
    // THE LAW: a subscriber can never observe the Cast without its Hit (register #22 dissolved) — EVERY update
    // this message produces already carries the whole composite. The legacy fold commits it in exactly one set();
    // box 4 (issue #522) adds the headless core's own fold of the same message as a second, later update, and the
    // guard is that neither one can ever show a partial cast.
    expect(seen).toEqual(seen.map(() => ({ ap: 7, mob_hp: 6 })))
    expect(notifications).toBe(2) // the legacy commit, then the core's fold of the same message
  })

  test('a reverted composite cast rolls back atomically by intent_id', () => {
    const store = active_store()
    store.getState().input(cast_batch(), T0 + 1_100)
    expect(engine_view(store.getState()).fighters.get('mob-0').health).toBe(6)
    store.getState().input({ type: 'rollback', intent_id: 'cast-1' }, T0 + 1_200)
    expect(engine_view(store.getState()).fighters.get('mob-0').health).toBe(20) // the whole batch gone
    expect(Object.values(store.getState().entries).some((e) => e.intent_id === 'cast-1')).toBe(false)
  })

  test('a composite prediction is refused during chain_replay (same local-push law as a bare intent)', () => {
    const store = active_store()
    store.getState().input({ type: 'receipt', receipt: turn_receipt(), version: 4 }, T0 + 6_000)
    const before = {
      ap: board_view(store.getState()).escrow[0].ap,
      mob_hp: engine_view(store.getState()).fighters.get('mob-0').health,
      entries: store.getState().entries,
    }
    store.getState().input(cast_batch(), T0 + 6_100)
    expect(
      {
        ap: board_view(store.getState()).escrow[0].ap,
        mob_hp: engine_view(store.getState()).fighters.get('mob-0').health,
        entries: store.getState().entries,
      },
      'the refused composite changed no prediction state'
    ).toEqual(before)
    expect(store.getState().refused).toMatchObject({ type: 'predicted', reason: 'provider' })
  })
})

describe('INC-0 · honest oracle (B-F18 — the load-bearing widening)', () => {
  const folded = () => {
    const store = active_store()
    store
      .getState()
      .input({ type: 'intent', intent: { kind: 'cast', ap_cost: 5, damaging: true, target_cell: 45 } }, T0 + 1_100)
    return store.getState().core
  }

  test('the parity hash DIVERGES on an AP-only corruption (was blind at HEAD)', () => {
    const clean = folded()
    const clean_image = fingerprint_state(clean)
    // Plant an AP-only corruption in the canonical snapshot budget. TurnStarted re-folds it into committed AP.
    const corrupt = {
      ...clean,
      inbox: {
        ...clean.inbox,
        base_view: {
          ...clean.inbox.base_view,
          escrow: clean.inbox.base_view.escrow.map((fighter, idx) =>
            idx === 0 ? { ...fighter, base_ap: fighter.base_ap - 1 } : fighter
          ),
        },
      },
    }
    expect(fingerprint_state(corrupt).roster.find((fighter) => fighter.id === ME).ap).not.toBe(
      clean_image.roster.find((fighter) => fighter.id === ME).ap
    )
    expect(fingerprint_state(corrupt)).not.toEqual(clean_image) // a green oracle on known corruption is no oracle
  })

  test('MP and ready corruptions also diverge (the reconcile-corrupted fields are all watched)', () => {
    const clean = folded()
    const mp_corrupt = {
      ...clean,
      inbox: {
        ...clean.inbox,
        base_view: {
          ...clean.inbox.base_view,
          escrow: clean.inbox.base_view.escrow.map((fighter, idx) =>
            idx === 0 ? { ...fighter, base_mp: 99 } : fighter
          ),
        },
      },
    }
    // Remove the authoritative Ready fact at its canonical coordinate; the rest of the fold stays identical.
    const ready_corrupt = {
      ...clean,
      inbox: {
        ...clean.inbox,
        log: Object.fromEntries(
          Object.entries(clean.inbox.log).map(([coord, action]) => [
            coord,
            action.kind === 'Ready' ? { ...action, kind: 'CorruptReady' } : action,
          ])
        ),
      },
    }
    expect(fingerprint_state(mp_corrupt)).not.toEqual(fingerprint_state(clean))
    expect(fingerprint_state(ready_corrupt)).not.toEqual(fingerprint_state(clean))
  })
})
