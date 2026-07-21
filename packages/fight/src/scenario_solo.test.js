// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// M1 HEADLESS SCENARIO — a COMPLETE solo fight driven with PLAIN OBJECTS through the ONE door (D768:
// "test a fight programatically with simple objects"). No DOM, no React, no chain: explicit clocks, synthetic
// Fight objects and receipts, every assertion a projection read. Covers: create → placement → activation
// (turn-start budget refill) → STACKED casts (the 12−5−5 double-charge class, red-first) → the single-PTB
// turn receipt (intent purge + mob wave pacing + presented mask) → snapshot deferral under a draining wave →
// kill death-hold (§7b: attack → hit → floater → only then despawn) → victory → settlement machine →
// commit_due edge → the 3s player min-turn floor.
import { describe, test, expect } from 'bun:test'

import { create_fight_store } from './store.js'
import { engine_view, board_view, presenting, commit_due, min_turn_left } from './project.js'
import { STATUS_PLACEMENT, STATUS_WON } from './board_state.js'
import { MOB_TURN_MS, local_intent_beats, synthetic_cast_events } from './present.js'
import { turn_submit_epoch } from './turn_commit.js'

const FIGHT = '0xf1647'
const ME = '0xchar_a'
const OWNER = '0xa11ce'
const T0 = 1_000_000

const ev = (kind, json) => ({ type: `0xpkg::fight_events::${kind}`, parsedJson: { fight: FIGHT, ...json } })

/** A decoded-Fight-shaped PLAIN object (the board_state_from_fight input contract). */
const fight_object = ({ status = 0, my = {}, mob = {}, deadline = 0 } = {}) => ({
  id: FIGHT,
  status, // 0 = engine PLACEMENT, 1 = ACTIVE
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
      ap: 0, // drained pre-refill snapshot — the TurnStarted budget injection must paint 12, not this
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
/** init → placement snapshot → placed+ready receipt → TurnStarted (my playable turn, deadline D1). */
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

describe('solo lifecycle — create → placement → activation', () => {
  test('placement snapshot adopts: my seat resolves, status PLACEMENT, spawn cells decoded', () => {
    const store = boot()
    store.getState().input({ type: 'snapshot', fight: fight_object({ status: 0 }), version: 1 }, T0 + 100)
    const s = store.getState()
    expect(s.my_key).toBe('p0')
    expect(board_view(s).status).toBe(STATUS_PLACEMENT)
    const view = engine_view(s)
    expect(view.placement).toBe(true)
    expect(view.placement_cells[0]).toEqual([
      { x: 1, y: 1 },
      { x: 2, y: 1 },
    ])
  })

  test('Placed + Ready fold onto my seat (the v1.12.28 dropped-Placed class, now a scenario row)', () => {
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
    const s = store.getState()
    expect(s.fighters.p0.cell).toBe(21)
    const view = engine_view(s)
    expect(view.fighters.get(ME).cell).toEqual({ x: 1, y: 1 })
    expect(view.ready.has(ME)).toBe(true)
  })

  test('TurnStarted predicts the begin_turn refill: budget paints 12/3 over the drained snapshot 0/0', () => {
    const store = active_store()
    const s = store.getState()
    expect(s.active).toBe('p0')
    expect(s.turn_deadline_ms).toBe(D1)
    expect(s.turn_started_at).toBe(T0 + 1_000) // the playable rising edge stamped the floor anchor
    const me = engine_view(s).fighters.get(ME)
    expect(me.ap).toBe(12)
    expect(me.mp).toBe(3)
  })
})

describe('stacked casts — the double-charge class (12 − 5 − 5 affordability)', () => {
  test('the committed anchor never debits with my drafts: presented shrinks 12→7→2, anchor stays 12', () => {
    const store = active_store()
    const cast = (n) =>
      store
        .getState()
        .input(
          { type: 'intent', intent: { kind: 'cast', ap_cost: 5, damaging: true, target_cell: 45 } },
          T0 + 1_000 + n * 100
        )
    cast(1)
    let [row] = board_view(store.getState()).escrow
    expect(row.ap).toBe(7) // presented: the draft debits what the eye sees
    expect(row.committed.ap).toBe(12) // the chain anchor the draft-budget math subtracts its OWN ledger from
    cast(2)
    ;[row] = board_view(store.getState()).escrow
    expect(row.ap).toBe(2)
    expect(row.committed.ap).toBe(12)
    // The affordability identity that makes the SECOND cast legal: anchor − drafted_cost ≥ next_cost.
    // Budgeting from the presented value instead counts cast #1 twice (7 − 5 − 5 < 0 → the dead second cast).
    const drafted_before_second = 5
    expect(row.committed.ap - drafted_before_second >= 5).toBe(true)
    expect(row.ap - 5 >= 0).toBe(false) // the buggy (presented-anchored) budget would refuse a third… and read 2−5 for the second
  })
})

describe('the single-PTB turn receipt — purge, wave pacing, presented mask', () => {
  const turn_receipt = () => ({
    events: [
      ev('Cast', { caster_is_mob: false, caster_idx: 0, target_cell: 45 }),
      ev('Hit', {
        victim_is_mob: true,
        victim_idx: 0,
        amount: 8,
        remaining_hp: 12,
        caster_is_mob: false,
        caster_idx: 0,
      }),
      ev('Cast', { caster_is_mob: false, caster_idx: 0, target_cell: 45 }),
      ev('Hit', {
        victim_is_mob: true,
        victim_idx: 0,
        amount: 8,
        remaining_hp: 4,
        caster_is_mob: false,
        caster_idx: 0,
      }),
      ev('TurnEnded', { is_mob: false, idx: 0 }),
      ev('TurnStarted', { is_mob: true, idx: 0 }),
      ev('MobMoved', { idx: 0, to_cell: 41 }),
      ev('Cast', { caster_is_mob: true, caster_idx: 0, target_cell: 21 }),
      ev('Hit', {
        victim_is_mob: false,
        victim_idx: 0,
        amount: 6,
        remaining_hp: 44,
        caster_is_mob: true,
        caster_idx: 0,
      }),
      ev('TurnEnded', { is_mob: true, idx: 0 }),
      ev('TurnStarted', { is_mob: false, idx: 0, deadline_ms: T0 + 90_000 }),
    ],
  })

  test('receipt purges my intents, folds committed truth, and paces EXACTLY the mob turn at ~3s', () => {
    const store = active_store()
    store
      .getState()
      .input({ type: 'intent', intent: { kind: 'cast', ap_cost: 5, damaging: true, target_cell: 45 } }, T0 + 1_100)
    store.getState().input({ type: 'receipt', receipt: turn_receipt(), version: 4 }, T0 + 6_000)
    const s = store.getState()
    expect(Object.values(s.entries).filter((e) => e.source === 'intent')).toEqual([]) // prediction settled
    // committed truth is instant (chain parity — never delayed by presentation):
    expect(s.fighters.m0.hp).toBe(4)
    expect(s.fighters.m0.cell).toBe(41)
    expect(s.fighters.p0.hp).toBe(44)
    expect(s.active).toBe('p0')
    // the wave carries ONLY the non-local (mob) turn, paced to the tuned 3s slot:
    const remote = s.wave.filter((t) => !t.is_local)
    expect(remote.length).toBe(1)
    expect(remote[0].duration).toBe(MOB_TURN_MS)
    expect(remote[0].source_id).toBe('mob-0')
    expect(presenting(s)).toBe(true)
    expect(engine_view(s).presenting_entity_id).toBe('mob-0')
  })

  test('THE MASK: the eye holds the mob at its pre-turn cell until the ack; ack reveals committed', () => {
    const store = active_store()
    store.getState().input({ type: 'receipt', receipt: turn_receipt(), version: 4 }, T0 + 6_000)
    let view = engine_view(store.getState())
    expect(view.fighters.get('mob-0').cell).toEqual({ x: 5, y: 2 }) // still cell 45 — the slide hasn't presented
    expect(view.fighters.get(ME).health).toBe(50) // the mob's strike rides ITS window: floater lands before my HP drops
    const { seq } = store.getState().wave.at(-1)
    store.getState().input({ type: 'presented', seq }, T0 + 9_100)
    const s = store.getState()
    expect(presenting(s)).toBe(false)
    view = engine_view(s)
    expect(view.fighters.get('mob-0').cell).toEqual({ x: 1, y: 2 }) // cell 41 revealed at the drain
    expect(view.fighters.get(ME).health).toBe(44) // …and my HP drops exactly at the ack
  })

  test('M2b: a fresher object read is an inert CHECKPOINT — the receipt drives the wave, no leapfrog', () => {
    const store = active_store()
    store.getState().input({ type: 'receipt', receipt: turn_receipt(), version: 4 }, T0 + 6_000)
    // M2b · ONE INGRESS: the object read NEVER adopts mid-fight, so it can neither leapfrog the draining wave nor
    // overwrite the receipt-folded truth. The old deferral is deleted — there is nothing to stash.
    store.getState().input(
      {
        type: 'snapshot',
        fight: fight_object({
          status: 1,
          my: { hp: 44, ap: 12, mp: 3, cell: 21, ready: true },
          mob: { hp: 4, cell: 41 },
          deadline: T0 + 90_000,
        }),
        version: 5,
      },
      T0 + 6_500
    )
    expect(store.getState().view_version).toBe(1) // the checkpoint never re-adopts the base
    const { seq } = store.getState().wave.at(-1)
    store.getState().input({ type: 'presented', seq }, T0 + 9_100)
    const s = store.getState()
    expect(s.view_version).toBe(1) // still the bootstrap base — canonical catch-up rides the journal, not a re-adopt
    expect(engine_view(s).fighters.get('mob-0').cell).toEqual({ x: 1, y: 2 }) // the receipt's wave moved the mob
  })
})

describe('§7b death law + victory + settlement', () => {
  test('a killed mob HOLDS visible until its killing beats ack (attack→hit→floater→only then despawn)', () => {
    const store = active_store()
    const beats = local_intent_beats(
      synthetic_cast_events({
        fight_id: FIGHT,
        caster_idx: 0,
        target_cell: 45,
        victims: [{ is_mob: true, idx: 0, amount: 20, remaining_hp: 0 }],
      }),
      { fight_id: FIGHT }
    )
    // #170 (5th recurrence): no 'death'-kind beat anymore — the killing 'damage' beat carries `killed` (the
    // presenter derives the death visual from the presented-state edge, see voxel_fight_adapter.observe_death).
    expect(beats.some((b) => b.kind === 'damage' && b.payload?.killed)).toBe(true)
    store
      .getState()
      .input(
        { type: 'intent', intent: { kind: 'cast', ap_cost: 5, damaging: true, target_cell: 45 }, beats },
        T0 + 1_200
      )
    store.getState().input(
      {
        type: 'receipt',
        receipt: {
          events: [
            ev('Cast', { caster_is_mob: false, caster_idx: 0, target_cell: 45 }),
            ev('Hit', {
              victim_is_mob: true,
              victim_idx: 0,
              amount: 20,
              remaining_hp: 0,
              caster_is_mob: false,
              caster_idx: 0,
            }),
            ev('Victory', {}),
          ],
        },
        version: 4,
      },
      T0 + 2_000
    )
    let s = store.getState()
    expect(s.fighters.m0.alive).toBe(false) // committed truth: dead the instant the chain says so
    expect(engine_view(s).fighters.get('mob-0').dead).toBe(false) // presentation holds the body (death beat unacked)
    const { seq } = s.wave.at(-1)
    store.getState().input({ type: 'presented', seq }, T0 + 6_000)
    s = store.getState()
    expect(engine_view(s).fighters.get('mob-0').dead).toBe(true) // despawn exactly at the killing turn's ack
  })

  test('victory folds committed, the settlement machine runs one bounded attempt to OPENED', () => {
    const store = active_store()
    store.getState().input(
      {
        type: 'receipt',
        receipt: {
          events: [
            ev('Cast', { caster_is_mob: false, caster_idx: 0, target_cell: 45 }),
            ev('Hit', {
              victim_is_mob: true,
              victim_idx: 0,
              amount: 20,
              remaining_hp: 0,
              caster_is_mob: false,
              caster_idx: 0,
            }),
            ev('Victory', {}),
          ],
        },
        version: 4,
      },
      T0 + 2_000
    )
    const s1 = store.getState()
    expect(s1.phase).toBe('victory')
    expect(s1.winner).toBe(0)
    const request = board_view(s1).settlement_request
    expect(request).not.toBe(null)
    expect(request.phase).toBe('victory')
    expect(request.last_room).toBe(true) // no run ctx ⇒ terminal room
    expect(request.status).toBe(STATUS_WON)
    // the tx edge claims the attempt, then reports the executed outcome — all through the door:
    store.getState().input({ type: 'settlement_attempt', signal: request.signal }, T0 + 2_100)
    expect(store.getState().settlement.attempt.verdict).toBe('inflight')
    expect(board_view(store.getState()).settlement_request).toBe(null) // one attempt per confirmation
    store.getState().input({ type: 'settlement_outcome', signal: request.signal, verdict: 'opened' }, T0 + 2_500)
    expect(store.getState().settlement.attempt.verdict).toBe('opened')
    store.getState().input({ type: 'settlement_request_consumed', signal: request.signal }, T0 + 2_600)
    expect(store.getState().settlement.chain_terminal.consumed).toBe(true)
  })
})

describe('the reducer clocks — commit_due edge and the 3s min-turn floor', () => {
  test('a drafted turn near its deadline raises commit_due; the busy claim suppresses it', () => {
    const store = active_store()
    store
      .getState()
      .input(
        { type: 'stage', intent: { kind: 1, target: 45, spell_template_id: '0xspell', spell_key: 'strike' } },
        T0 + 1_100
      )
    store.getState().input({ type: 'tick', draft_count: 1 }, D1 - 900) // past fire_at = deadline − commit buffer
    let s = store.getState()
    expect(commit_due(s)).toBe(true)
    const epoch = turn_submit_epoch(s)
    expect(epoch).toBe(`${FIGHT}@${T0 + 1_000}#2`) // receipt_seq 2: the placement + turn-start receipts
    store.getState().input({ type: 'busy', value: true, attempt_epoch: epoch }, D1 - 850)
    s = store.getState()
    expect(commit_due(s)).toBe(false) // level suppressed while the PTB is in flight
    expect(s.commit_attempt_epoch).toBe(epoch) // the once-claim survives busy clearing
  })

  test('PLAYER MIN-TURN FLOOR: an instant end_turn holds until t+3s, then flushes through the door', () => {
    const store = active_store() // my turn opened at T0+1000
    expect(min_turn_left(store.getState(), T0 + 1_500)).toBe(2_500)
    store.getState().input({ type: 'intent', intent: { kind: 'end_turn' } }, T0 + 1_500)
    let s = store.getState()
    expect(s.active).toBe('p0') // NOT folded — held under the floor
    expect(s.pending_end_turn?.ready_at).toBe(T0 + 4_000)
    store.getState().input({ type: 'flush' }, T0 + 4_100)
    s = store.getState()
    expect(s.active).toBe(null) // the held end-turn re-drove itself once the floor passed
    expect(min_turn_left(s, T0 + 4_200)).toBe(0)
  })
})
