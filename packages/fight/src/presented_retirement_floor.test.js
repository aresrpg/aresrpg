// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// THE DOUBLE-DEATH ("the mob is dying twice") — the eye's projection resurrected a floor-dead mob.
//
// v1.12.36 made kills STICK: an authoritative death floors `retired` (V1) and `apply_retirement` overrides any
// later higher-version read that carries a positive hp. But the floor was applied ONLY in committed_state (and
// recompute's output) — NOT in wave_masked_fold, the re-fold that backs presented_state / display_state. So
// while a MASKING wave drains (any mob/peer turn) over a version-inflated-but-stale view that still carries the
// dead mob alive, presented_state re-folds from that base WITHOUT the floor → engine_view.dead flips back to
// FALSE (the corpse stands up), then true again when the wave acks. The adapter re-upserts the corpse then
// despawns it a SECOND time: one kill, two death animations.
//
// The invariant these lock: a floor-dead fighter is dead in EVERY projection — committed, presented, display —
// regardless of masking waves or stale views. The death presents EXACTLY ONCE.

import { describe, expect, test } from 'bun:test'

import { create_fight_store } from './store.js'
import { engine_view } from './project.js'
import { committed_state, presented_state, display_state } from './fold.js'
import { local_intent_beats, synthetic_cast_events } from './present.js'
import { encode } from './los.js'

const FIGHT = '0xf1'
const CHAR = '0xc1'
const MOB_CELL = encode(5, 4)
const ev = (kind, json) => ({ type: `0xpkg::fight_events::${kind}`, parsedJson: { fight: FIGHT, ...json } })

// Two mobs: mob-0 is the one we kill; mob-1 exists only to take a later turn (the MASKING wave that exposes
// the re-fold branch of presented_state).
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
  mobs: [
    { template: '0xabc', hp: mob0_hp, max_hp: 30, cell: MOB_CELL, ap: 4, mp: 3, level: 1 },
    { template: '0xdef', hp: 20, max_hp: 30, cell: encode(8, 8), ap: 4, mp: 3, level: 1 },
  ],
  queue: [
    { is_mob: false, idx: 0 },
    { is_mob: true, idx: 0 },
    { is_mob: true, idx: 1 },
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

// My optimistic killing cast (predicts mob-0 dead THIS frame) + its local wave turn.
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

// The authoritative receipt for MY turn confirming the kill (floors retired[mob-0]).
const confirm_kill = (store, now = 3_000) =>
  store.getState().input(
    {
      type: 'receipt',
      fight_id: FIGHT,
      version: 6,
      receipt: {
        events: [
          ev('TurnStarted', { is_mob: false, idx: 0 }),
          ev('Cast', { caster_is_mob: false, caster_idx: 0, target_cell: MOB_CELL }),
          ev('Hit', {
            victim_is_mob: true,
            victim_idx: 0,
            amount: 8,
            remaining_hp: 0,
            caster_is_mob: false,
            caster_idx: 0,
          }),
          ev('TurnEnded', { is_mob: false, idx: 0 }),
          ev('TurnStarted', { is_mob: true, idx: 0 }),
          ev('TurnEnded', { is_mob: true, idx: 0 }),
          ev('TurnStarted', { is_mob: false, idx: 0, deadline_ms: 120_000 }),
        ],
      },
    },
    now
  )

describe('presented-projection retirement floor — the mob dies exactly once', () => {
  test('a floor-dead mob does not RESURRECT in engine_view while a masking wave drains over a stale view', () => {
    const store = boot()
    predict_kill(store) // intent-predicted death
    confirm_kill(store) // the same death, proven by the receipt → retired floor set
    drain(store, 3_500)
    expect(mob0(store).dead, 'the confirmed kill presents dead once its own turn drains').toBe(true)
    expect(store.getState().retired?.m0, 'the receipt floored the death').toBeGreaterThanOrEqual(0)

    // A version-inflated but semantically STALE object read adopts, carrying mob-0 ALIVE again (hp 8). The floor
    // must win — committed_state already does. (No masking wave yet, so presented still returns the floored `s`.)
    store.getState().input({ type: 'snapshot', fight: fight_object(8), version: 8 }, 4_000)
    expect(mob0(store).committed_dead, 'committed truth holds the floor').toBe(true)

    // Now a masking wave: mob-1 takes a turn. presented_state re-folds from the stale base for the whole wave.
    store.getState().input(
      {
        type: 'receipt',
        fight_id: FIGHT,
        version: 9,
        receipt: {
          events: [
            ev('TurnStarted', { is_mob: true, idx: 1 }),
            ev('MobMoved', { idx: 1, to_cell: encode(8, 7) }),
            ev('TurnEnded', { is_mob: true, idx: 1 }),
          ],
        },
      },
      5_000
    )
    // THE BUG: mob-0 (already killed AND floored) must NOT read alive again just because another mob is animating.
    // A false here is the corpse standing back up — the second death animation fires when the wave later acks.
    expect(mob0(store).dead, 'a floor-dead mob must never present alive during another turn (no double death)').toBe(
      true
    )

    drain(store, 6_000)
    expect(mob0(store).dead, 'still dead after the wave — the death presented exactly once').toBe(true)
  })

  test('presented_state and display_state respect the retirement floor (parity with committed_state)', () => {
    const store = boot()
    predict_kill(store)
    confirm_kill(store)
    drain(store, 3_500)
    store.getState().input({ type: 'snapshot', fight: fight_object(8), version: 8 }, 4_000)
    // A masking wave keeps presented/display on their re-fold branch.
    store.getState().input(
      {
        type: 'receipt',
        fight_id: FIGHT,
        version: 9,
        receipt: {
          events: [
            ev('TurnStarted', { is_mob: true, idx: 1 }),
            ev('MobMoved', { idx: 1, to_cell: encode(8, 7) }),
            ev('TurnEnded', { is_mob: true, idx: 1 }),
          ],
        },
      },
      5_000
    )
    const s = store.getState()
    expect(committed_state(s).fighters?.m0?.alive, 'committed floor').toBe(false)
    expect(presented_state(s).fighters?.m0?.alive, 'presented must not resurrect the floor-dead mob').toBe(false)
    expect(display_state(s).fighters?.m0?.alive, 'display must not resurrect the floor-dead mob').toBe(false)
  })
})
