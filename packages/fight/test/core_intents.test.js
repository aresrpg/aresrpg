// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//
// §③ INTENTS + FORECAST unit truth (Fight V2 build step 2). The ledger lifecycle (draft→…→observed/refused/stale),
// effect_id idempotence, and the recompute-whole forecast — prediction is a pure derivation, never a stored overlay.

import { describe, test, expect } from 'bun:test'

import { empty_state } from '../src/inputs.js'
import { empty_inbox } from '../src/core_state.js'
import {
  queue_intent,
  mark_submitted,
  refuse_intents,
  resolve_intents,
  active_intents,
  fold_forecast,
  compact_ledger,
} from '../src/core_intents.js'

/** An idx-keyed optimistic Hit (no resolver needed) — the shape the door's normalize step would produce. */
const hit_action = (victim_idx, remaining_hp) => ({
  kind: 'Hit',
  victim_is_mob: false,
  victim_idx,
  remaining_hp,
  version: 10,
  event_idx: 0,
})

/** A committed board carrying one live fighter p0 (the forecast folds intents on top of this). */
const canonical = () => ({
  ...empty_state('0xfight'),
  fighters: { p0: { key: 'p0', is_mob: false, cell: 5, hp: 70, alive: true } },
})

describe('the intent ledger — lifecycle + effect_id idempotence', () => {
  test('a fresh commit queues; the same effect_id upserts (folds once, never doubles)', () => {
    const once = queue_intent([], { effect_id: 'cast:a', basis_version: 10, actions: [hit_action(0, 40)] })
    const twice = queue_intent(once, { effect_id: 'cast:a', basis_version: 10, actions: [hit_action(0, 30)] })
    expect(twice).toHaveLength(1) // idempotent upsert
    expect(twice[0].actions[0].remaining_hp).toBe(30) // latest content wins
  })

  test('an effect_id-less commit always appends (distinct clicks)', () => {
    const ledger = queue_intent(queue_intent([], { effect_id: null, basis_version: 10, actions: [] }), {
      effect_id: null,
      basis_version: 10,
      actions: [],
    })
    expect(ledger).toHaveLength(2)
  })

  test('mark_submitted advances queued → submitted; both stay ACTIVE', () => {
    const ledger = mark_submitted(queue_intent([], { effect_id: 'a', basis_version: 10, actions: [] }))
    expect(ledger[0].status).toBe('submitted')
    expect(active_intents(ledger)).toHaveLength(1)
  })

  test('refuse deactivates the matched intent; an already-resolved row is immutable', () => {
    const ledger = queue_intent([], { effect_id: 'a', basis_version: 10, actions: [] })
    const refused = refuse_intents(ledger, (intent) => intent.effect_id === 'a')
    expect(refused[0].status).toBe('refused')
    expect(active_intents(refused)).toHaveLength(0)
    // re-refusing / resolving an inert row does not flip it back
    expect(resolve_intents(refused, 99, 'observed')[0].status).toBe('refused')
  })

  test('a receipt at/past the basis marks it observed; a snapshot floor marks it stale', () => {
    const ledger = queue_intent([], { effect_id: 'a', basis_version: 10, actions: [] })
    expect(resolve_intents(ledger, 10, 'observed')[0].status).toBe('observed')
    expect(resolve_intents(ledger, 12, 'stale')[0].status).toBe('stale')
    expect(resolve_intents(ledger, 9, 'observed')[0].status).toBe('queued') // below basis — untouched
  })
})

describe('fold_forecast — recompute-whole twin of active intents on canonical', () => {
  test('active intents paint on top of canonical truth', () => {
    const ledger = queue_intent([], { effect_id: 'a', basis_version: 10, actions: [hit_action(0, 40)] })
    const forecast = fold_forecast(canonical(), ledger, empty_inbox())
    expect(forecast.fighters.p0.hp).toBe(40) // the optimistic hit painted
  })

  test('no active intent ⇒ forecast IS canonical (prediction is derivation, not stored state)', () => {
    const observed = resolve_intents(
      queue_intent([], { effect_id: 'a', basis_version: 10, actions: [hit_action(0, 40)] }),
      10,
      'observed'
    )
    const forecast = fold_forecast(canonical(), observed, empty_inbox())
    expect(forecast.fighters.p0.hp).toBe(70) // the observed intent left the forecast — canonical truth stands
  })

  test('a refusal rebuilds the whole forecast without the intent (no per-effect rollback)', () => {
    const ledger = refuse_intents(
      queue_intent([], { effect_id: 'a', basis_version: 10, actions: [hit_action(0, 40)] }),
      () => true
    )
    expect(fold_forecast(canonical(), ledger, empty_inbox()).fighters.p0.hp).toBe(70)
  })
})

describe('compact_ledger — bounded across a long session', () => {
  test('inert rows below the floor drop; active + recent rows stay', () => {
    const ledger = [
      { effect_id: 'old', status: 'observed', basis_version: 5, actions: [] },
      { effect_id: 'live', status: 'submitted', basis_version: 5, actions: [] },
      { effect_id: 'recent', status: 'stale', basis_version: 20, actions: [] },
    ]
    const kept = compact_ledger(ledger, 20)
    expect(kept.map((i) => i.effect_id).sort()).toEqual(['live', 'recent']) // 'old' (inert, below floor) pruned
  })
})
