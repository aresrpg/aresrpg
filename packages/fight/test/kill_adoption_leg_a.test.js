// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// LEG A — KILL DOESN'T STICK — a regression from v32 where a lethal cast made the mob die locally, then it
// got its hp back on the next turn. The lethal cast was PREDICTED locally (mob 0 hp) but the turn's tx
// reverted (the end-turn brick, tracked separately — SDK act_pass after a winning cast), so the chain never saw
// the kill. This fixture pins the FOLD contract the client owns: when chain truth arrives WITHOUT the kill, the
// fold must adopt it (mob alive at chain hp, NO lingering zombie 0-hp mob), flag the correction once, and leave
// the end-turn escape hatch composable against committed truth (never gated by the discarded prediction).
//
// ROLL-DETERMINISM RULING (dig #1): damage is DETERMINISTIC, not chain entropy. turn_seed.js: DAMAGE IS
// EXACT — a hit deals precisely its authored base; crit swaps to the crit base. Every
// per-turn roll (crit/dodge/tackle) derives from a PUBLIC turn_seed(world_seed, spawn_id, turn_deadline_ms,
// seat) + slot — fully client-previewable. So lethal prediction is NOT structurally divergent; the client CAN
// predict the exact kill. The kill fails to stick ONLY because the tx never lands, and the fix belongs to the
// tx composition (BLOCKED — out of fence), never to a min-roll prediction policy.

import { describe, expect, test } from 'bun:test'

import { create_fight_store } from '../src/store.js'
import { engine_view, is_over, can_end_turn, is_my_turn } from '../src/project.js'
import { build_turn_batch, stage_intent } from '../src/txs.js'

const FIGHT = '0xf1'
const CHAR = '0xc1'
const W = 20
const enc = (x, y) => y * W + x
const ME = enc(5, 5)
const MOB = enc(7, 5)
const ev = (kind, fields) => ({ type: `0x0::fight_events::${kind}`, parsedJson: { fight: FIGHT, ...fields } })

const FIGHT_OBJECT = {
  id: FIGHT,
  status: 1,
  width: W,
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
      cell: ME,
    },
  ],
  mobs: [{ template: '0xabc', hp: 8, max_hp: 30, cell: MOB, ap: 4, mp: 3, level: 1 }],
  queue: [
    { is_mob: false, idx: 0 },
    { is_mob: true, idx: 0 },
  ],
  turn_ptr: 0,
  turn_deadline_ms: 90_000,
}

const boot = () => {
  const store = create_fight_store()
  store
    .getState()
    .input({ type: 'init', fight_id: FIGHT, my_key: 'p0', ctx: { my_entity_id: CHAR, beat_ctx: { grid_width: W } } })
  store.getState().input({ type: 'snapshot', fight: FIGHT_OBJECT, version: 5 }, 1_000)
  return store
}

const mob0 = (store) => engine_view(store.getState()).fighters.get('mob-0')
const predict_lethal = (store) =>
  store.getState().input(
    {
      type: 'predicted',
      basis_version: 6,
      intent_id: 'lethal1',
      actions: [
        { kind: 'Cast', caster_is_mob: false, caster_idx: 0, target_cell: MOB, ap_cost: 3, damaging: true },
        { kind: 'Hit', victim_is_mob: true, victim_idx: 0, remaining_hp: 0 },
      ],
      beats: [{ kind: 'cast', at: 0, duration: 100, payload: {} }],
    },
    1_100
  )

describe('LEG A — a predicted kill the chain never saw adopts back, escape hatch stays open', () => {
  test('prediction paints the mob dead', () => {
    const store = boot()
    predict_lethal(store)
    expect(mob0(store).health, 'the prediction paints the kill this frame').toBe(0)
    // the escape hatch is NOT gated by the predicted kill — winner stays -1 (a Hit never paints Victory)
    expect(is_over(store.getState()), 'a predicted kill is not a committed victory').toBe(false)
    expect(is_my_turn(store.getState())).toBe(true)
  })

  test('a NEW chain read WITHOUT the kill restores the mob — no lingering zombie 0-hp mob', () => {
    const store = boot()
    predict_lethal(store)
    // the chain force-passed the turn (the reverted commit never landed the kill): a fresh Fight object at the
    // NEXT version shows the mob ALIVE, my turn again.
    const next = {
      ...FIGHT_OBJECT,
      mobs: [{ ...FIGHT_OBJECT.mobs[0], hp: 8 }],
      turn_deadline_ms: 120_000,
    }
    store.getState().input({ type: 'snapshot', fight: next, version: 6 }, 5_000)

    expect(mob0(store).committed_health, 'chain truth: the mob is alive').toBe(8)
    expect(mob0(store).health, 'no zombie — the presented mob is restored, not stuck at 0').toBe(8)
    expect(mob0(store).dead, 'the restored mob is not a corpse').toBe(false)
  })

  test('end-turn composes against COMMITTED truth after adoption (the escape hatch is never bricked)', () => {
    const store = boot()
    stage_intent(store, { kind: 1, target: MOB, spell_template_id: '0xspell' }) // the lethal cast staged
    predict_lethal(store)
    // chain truth adopts without the kill
    store
      .getState()
      .input(
        { type: 'snapshot', fight: { ...FIGHT_OBJECT, mobs: [{ ...FIGHT_OBJECT.mobs[0], hp: 8 }] }, version: 6 },
        5_000
      )
    // the escape hatch reads committed reality: still my live turn, end-turn composable
    expect(can_end_turn(store.getState(), 6_000), 'end turn stays available against committed truth').toBe(true)
    // the batch composes from the STAGED draft queue, never the (discarded) predicted fold
    expect(build_turn_batch(store, (c) => c).batch, 'the turn batch composes from staged').toEqual([
      { kind: 'cast', spell_template_id: '0xspell', target_cell: MOB },
    ])
  })

  test('a divergent receipt (chain resolved the turn differently) flags the correction ONCE', () => {
    // The "board was corrected" toast is subscribe_divergence(kind:'action') — an action delta mismatch between
    // my prediction and the authoritative receipt. Lock it: I predict the mob dead, the receipt resolves it ALIVE.
    const store = boot()
    predict_lethal(store)
    store.getState().input(
      {
        type: 'receipt',
        fight_id: FIGHT,
        version: 6,
        receipt: {
          events: [
            ev('Cast', { caster_is_mob: false, caster_idx: 0, target_cell: MOB }),
            ev('Hit', { victim_is_mob: true, victim_idx: 0, amount: 5, remaining_hp: 3 }), // survived — diverges from 0
          ],
        },
      },
      5_000
    )
    const { divergence } = store.getState()
    expect(divergence?.kind, 'the receipt-vs-prediction mismatch is an action divergence').toBe('action')
    expect(mob0(store).committed_health, 'chain truth wins: the mob survived').toBe(3)
    // consumed exactly once (remount-safe) — a second observe never re-toasts
    store.getState().input({ type: 'divergence_shown', version: divergence.version, action: divergence.action })
    expect(store.getState().divergence.shown, 'the correction is flagged once, then consumed').toBe(true)
  })
})
