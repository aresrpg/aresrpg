// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// FULL SESSION CLOSURE (acceptance-pack row 6) — the solo lifecycle extended to the OPEN-RESULT edge in ONE
// unbroken store: create → placement → activation → cast → single-PTB receipt + mob wave + acks → kill →
// victory → the FightResult claim/open intent SURFACES AS AN EFFECT REQUEST OUTPUT (board_view
// .settlement_request) → one bounded attempt → OPENED → consumed. Owner acceptance: the session ends with
// the result OPENED, not just settled. Extends src/scenario_solo.test.js (fragmented rows) — this is the
// whole life on one clock.
import { describe, test, expect } from 'bun:test'

import { evaluate_trace } from '../../../test/gold/specs_anchor/pacing_envelopes.ts'
import { create_fight_store } from '../src/store.js'
import { engine_view, board_view, presenting, settlement_request } from '../src/project.js'
import { STATUS_WON } from '../src/board_state.js'
import { local_intent_beats, synthetic_cast_events, MOB_TURN_MS } from '../src/present.js'
import { FIGHT, ME, T0, ev, participant, mob, fight_object } from '../harness/fixtures.js'
import { trace_of } from '../harness/cli.js'

const cast_beats = (amount, remaining_hp) =>
  local_intent_beats(
    synthetic_cast_events({
      fight_id: FIGHT,
      caster_idx: 0,
      target_cell: 45,
      victims: [{ is_mob: true, idx: 0, amount, remaining_hp }],
    }),
    { fight_id: FIGHT }
  )

describe('full session closure — the session ends with the FightResult OPENED, not just settled', () => {
  test('placement → turns → kill → victory → claim/open effect request → OPENED → consumed, one store, one clock', () => {
    const store = create_fight_store()
    const input = (msg, now) => store.getState().input(msg, now)

    // ── create + placement ───────────────────────────────────────────────────────────────────────────────
    input(
      { type: 'init', fight_id: FIGHT, ctx: { my_entity_id: ME, address: '0xa11ce', beat_ctx: { grid_width: 20 } } },
      T0
    )
    input(
      {
        type: 'snapshot',
        fight: fight_object({ status: 0, participants: [participant(ME, 0, { ap: 0, mp: 0, ready: false })] }),
        version: 1,
      },
      T0 + 100
    )
    input(
      {
        type: 'receipt',
        receipt: { events: [ev('Placed', { character: ME, cell: 21 }), ev('Ready', { character: ME })] },
        version: 2,
      },
      T0 + 500
    )
    input(
      {
        type: 'receipt',
        receipt: { events: [ev('TurnStarted', { is_mob: false, idx: 0, deadline_ms: T0 + 30_000 })] },
        version: 3,
      },
      T0 + 1_000
    )
    expect(store.getState().active).toBe('p0') // my playable turn opened (budget rows live in scenario_solo)

    // ── my turn: one cast, then the single-PTB commit receipt (my turn + the mob wave) ───────────────────
    input(
      {
        type: 'intent',
        intent: { kind: 'cast', ap_cost: 5, damaging: true, target_cell: 45 },
        beats: cast_beats(8, 12),
      },
      T0 + 2_000
    )
    input({ type: 'presented', seq: store.getState().wave.at(-1).seq }, T0 + 3_800) // my own beats acked
    input(
      {
        type: 'receipt',
        receipt: {
          events: [
            // authentic emitter order — effects before their Cast
            ev('Hit', {
              victim_is_mob: true,
              victim_idx: 0,
              amount: 8,
              remaining_hp: 12,
              caster_is_mob: false,
              caster_idx: 0,
            }),
            ev('Cast', { caster_is_mob: false, caster_idx: 0, target_cell: 45 }),
            ev('TurnEnded', { is_mob: false, idx: 0 }),
            ev('TurnStarted', { is_mob: true, idx: 0 }),
            ev('MobMoved', { idx: 0, to_cell: 41 }),
            ev('Hit', {
              victim_is_mob: false,
              victim_idx: 0,
              amount: 6,
              remaining_hp: 44,
              caster_is_mob: true,
              caster_idx: 0,
            }),
            ev('Cast', { caster_is_mob: true, caster_idx: 0, target_cell: 21 }),
            ev('TurnEnded', { is_mob: true, idx: 0 }),
            ev('TurnStarted', { is_mob: false, idx: 0, deadline_ms: T0 + 90_000 }),
          ],
        },
        version: 4,
      },
      T0 + 6_000
    )
    let s = store.getState()
    expect(s.fighters.m0.hp).toBe(12)
    expect(presenting(s)).toBe(true) // the mob wave presents
    const mob_wave = s.wave.filter((t) => !t.is_local)
    expect(mob_wave.length).toBe(1)
    expect(mob_wave[0].duration).toBe(MOB_TURN_MS)
    const verdict = evaluate_trace(trace_of(s.wave, { t0: T0 + 6_000 })) // §7b over this session's own stream
    expect(verdict.order_violations).toEqual([])
    expect(verdict.dead_air_violations).toEqual([])
    expect(verdict.envelope_violations).toEqual([])
    input({ type: 'presented', seq: mob_wave[0].seq }, T0 + 9_100)
    expect(presenting(store.getState())).toBe(false)

    // ── the kill: death holds until its beats ack, victory folds committed ───────────────────────────────
    input(
      {
        type: 'intent',
        intent: { kind: 'cast', ap_cost: 5, damaging: true, target_cell: 45 },
        beats: cast_beats(12, 0),
      },
      T0 + 10_000
    )
    input(
      {
        type: 'receipt',
        receipt: {
          events: [
            ev('Hit', {
              victim_is_mob: true,
              victim_idx: 0,
              amount: 12,
              remaining_hp: 0,
              caster_is_mob: false,
              caster_idx: 0,
            }),
            ev('Cast', { caster_is_mob: false, caster_idx: 0, target_cell: 45 }),
            ev('Victory', {}),
          ],
        },
        version: 5,
      },
      T0 + 11_000
    )
    s = store.getState()
    expect(s.phase).toBe('victory')
    expect(s.winner).toBe(0)
    expect(s.fighters.m0.alive).toBe(false) // committed truth: dead the instant the chain says so
    expect(engine_view(s).fighters.get('mob-0').dead).toBe(false) // …but the eye holds it until the death beat acks
    input({ type: 'presented', seq: s.wave.at(-1).seq }, T0 + 13_500)
    expect(engine_view(store.getState()).fighters.get('mob-0').dead).toBe(true)

    // ── the OPEN-RESULT edge: claim/open intent surfaces as an effect request output ─────────────────────
    const request = board_view(store.getState()).settlement_request
    expect(request).not.toBe(null)
    expect(request.phase).toBe('victory')
    expect(request.status).toBe(STATUS_WON)
    expect(request.last_room).toBe(true) // terminal room ⇒ the settle tx claims AND opens the FightResult
    input({ type: 'settlement_attempt', signal: request.signal }, T0 + 13_600)
    expect(store.getState().settlement.attempt.verdict).toBe('inflight')
    expect(board_view(store.getState()).settlement_request).toBe(null) // ONE attempt per confirmation
    input({ type: 'settlement_outcome', signal: request.signal, verdict: 'opened' }, T0 + 14_200)
    expect(store.getState().settlement.attempt.verdict).toBe('opened') // the result is OPENED, not just settled
    input({ type: 'settlement_request_consumed', signal: request.signal }, T0 + 14_300)

    // ── closure: nothing left to present, nothing left to request ────────────────────────────────────────
    s = store.getState()
    expect(s.settlement.chain_terminal.consumed).toBe(true)
    expect(s.wave).toEqual([])
    expect(presenting(s)).toBe(false)
    expect(settlement_request(s)).toBe(null) // no request survives an OPENED attempt — one settle per fight
    expect(s.settlement.chain_terminal.phase).toBe('victory') // …while the confirmed terminal stays history
  })
})
