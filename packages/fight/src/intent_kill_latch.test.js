// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #170 — THE DOUBLE-DEATH, 3rd recurrence (survived #134/#146). v1.12.36 floored AUTHORITATIVE deaths (`retired`)
// so a stale poll can't resurrect a CONFIRMED corpse (presented_retirement_floor.test.js). But an OPTIMISTIC
// (intent) kill is deliberately NOT floored — intents are predictions. So the 4s poll reading the Fight OBJECT
// BEFORE my commit lands (mob still alive on-chain) purges the intent and the corpse STANDS BACK UP; it dies a
// SECOND time when my commit receipt confirms the kill. One kill, two death animations.
//
// The latch: an intent-presented death holds the mob presented-dead (engine_view.dead) across that stale poll,
// cleared ONLY by MY-TURN RECEIPT (receipt_seq advances — a poll never bumps it). Confirm → `retired` takes over;
// DENY (a resisted survivor the client over-predicted dead — apply_resistance can leave a mob the raw base damage
// would have killed) → released, so a mispredict NEVER strands a live mob as a permanent corpse.

import { describe, expect, test } from 'bun:test'

import { create_fight_store } from './store.js'
import { engine_view, committed_mob_hp } from './project.js'
import { local_intent_beats, synthetic_cast_events } from './present.js'
import { encode } from './los.js'

const FIGHT = '0xf1'
const CHAR = '0xc1'
const MOB_CELL = encode(5, 4)
const ev = (kind, json) => ({ type: `0xpkg::fight_events::${kind}`, parsedJson: { fight: FIGHT, ...json } })

const fight_object = (mob0_hp) => ({
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
      cell: encode(2, 2),
    },
  ],
  mobs: [{ template: '0xabc', hp: mob0_hp, max_hp: 30, cell: MOB_CELL, ap: 4, mp: 3, level: 1 }],
  queue: [
    { is_mob: false, idx: 0 },
    { is_mob: true, idx: 0 },
  ],
  turn_ptr: 0,
  turn_deadline_ms: 90_000,
})

const boot = () => {
  const store = create_fight_store()
  store
    .getState()
    .input({ type: 'init', fight_id: FIGHT, my_key: 'p0', ctx: { my_entity_id: CHAR, beat_ctx: { grid_width: 20 } } })
  store.getState().input({ type: 'snapshot', fight: fight_object(8), version: 5 }, 1_000)
  return store
}

const mob0 = (store) => engine_view(store.getState()).fighters.get('mob-0')
const drain = (store, now) => {
  for (const t of [...store.getState().wave]) store.getState().input({ type: 'presented', seq: t.seq }, now)
}

// My optimistic killing cast (predicts mob-0 dead THIS frame) + its local wave turn with the death beat.
const predict_kill = (store, now = 2_000) => {
  const beats = local_intent_beats(
    synthetic_cast_events({
      fight_id: FIGHT,
      caster_idx: 0,
      target_cell: MOB_CELL,
      victims: [{ is_mob: true, idx: 0, amount: 8, remaining_hp: 0 }],
    }),
    {
      fight_id: FIGHT,
      resolve_fighter_id: ({ is_mob, idx, character }) =>
        character != null ? String(character) : is_mob ? `mob-${Number(idx)}` : CHAR,
      resolve_cast: () => ({ spell_id: 'ember_strike' }),
    }
  )
  store
    .getState()
    .input({ type: 'intent', intent: { kind: 'cast', target_cell: MOB_CELL, damaging: true }, beats }, now)
  store
    .getState()
    .input({ type: 'intent', intent: { kind: 'Hit', victim_is_mob: true, victim_idx: 0, remaining_hp: 0 } }, now)
}

// End Turn: my commit PTB is submitted and in-flight (txs.js dispatches this before submit).
const end_turn = (store) => store.getState().input({ type: 'busy', value: true })

// A version-inflated but semantically STALE poll: it read the Fight OBJECT before my commit landed, so mob-0 is
// still ALIVE at hp 8. In the real bug this is the 4s poll that arrives in the window before my turn's receipt.
const stale_poll = (store, now = 3_000) =>
  store.getState().input({ type: 'snapshot', fight: fight_object(8), version: 8 }, now)

describe('#170 — an optimistic kill latches through a stale poll (the mob dies exactly once)', () => {
  test('a stale poll does NOT resurrect an optimistically-killed mob before the confirming receipt', () => {
    const store = boot()
    predict_kill(store)
    drain(store, 2_500) // the death beat plays and acks → mob-0 is now a corpse (first and only death)
    expect(mob0(store).dead, 'the optimistic kill presents dead once its beat acks').toBe(true)

    end_turn(store) // my commit is in-flight — the kill IS coming, a stale poll must not undo it
    stale_poll(store) // the 4s poll reads mob-0 still alive on-chain (my commit has not landed)
    // THE BUG: the corpse stands back up because the intent was purged and nothing floored the death.
    expect(mob0(store).dead, 'a stale poll must NOT resurrect the optimistically-killed mob (no double death)').toBe(
      true
    )

    // My commit receipt confirms the kill → the authoritative retirement floor takes over; still dead, once.
    store.getState().input(
      {
        type: 'receipt',
        fight_id: FIGHT,
        version: 9,
        receipt: {
          events: [
            ev('TurnStarted', { is_mob: false, idx: 0 }),
            ev('Cast', { caster_is_mob: false, caster_idx: 0, target_cell: MOB_CELL }),
            ev('Hit', { victim_is_mob: true, victim_idx: 0, amount: 8, remaining_hp: 0, caster_is_mob: false, caster_idx: 0 }),
            ev('TurnEnded', { is_mob: false, idx: 0 }),
          ],
        },
      },
      3_500
    )
    expect(mob0(store).dead, 'the confirmed kill stays dead — the death presented exactly once').toBe(true)
  })

  test('SAFETY: a mispredicted kill (resisted survivor) is released by the receipt — no stranded corpse', () => {
    const store = boot()
    predict_kill(store) // client over-predicts a kill (ignored resistance)
    drain(store, 2_500)
    expect(mob0(store).dead, 'optimistically presents dead').toBe(true)
    end_turn(store) // commit in-flight — the latch is armed…

    // …but the receipt is the authoritative statement of my turn: the mob SURVIVED (resisted to hp 4). No lethal Hit.
    store.getState().input(
      {
        type: 'receipt',
        fight_id: FIGHT,
        version: 9,
        receipt: {
          events: [
            ev('TurnStarted', { is_mob: false, idx: 0 }),
            ev('Cast', { caster_is_mob: false, caster_idx: 0, target_cell: MOB_CELL }),
            ev('Hit', { victim_is_mob: true, victim_idx: 0, amount: 4, remaining_hp: 4, caster_is_mob: false, caster_idx: 0 }),
            ev('TurnEnded', { is_mob: false, idx: 0 }),
          ],
        },
      },
      3_500
    )
    expect(mob0(store).dead, 'the receipt denied the kill — the mob must be ALIVE, not a stranded corpse').toBe(false)
    expect(committed_mob_hp(store.getState(), 0), 'committed truth is the resisted survivor hp').toBe(4)
  })
})
