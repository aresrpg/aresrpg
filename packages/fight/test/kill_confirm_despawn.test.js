// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// KILL → DESPAWN, and the REVIVE that reads as "the model doesn't disappear".
//
// SYMPTOM: killing a mob makes the turn card grey, but the model doesn't disappear. ROOT (proven here): the
// fold is TRUTHFUL — a CONFIRMED kill presents `engine_view.dead = true` (the adapter's rig reconcile then
// despawns it, despawn_pacing.test.js). But ① was the HAND-WEAPON kill: its optimistic swing folds the mob dead
// (the turn card greys), then flush_commit DROPPED the swing (it gated on the optimistic corpse — the
// strike_flush_illegal root, turn_commit.test.js), so the authoritative receipt landed with the mob STILL ALIVE
// on-chain and the fold correctly REVIVED it — the rig re-upserts, "the model doesn't disappear".
//
// This file locks BOTH halves so the fix stays UPSTREAM (commit the weapon — strike_flush_illegal) and the fold
// is NEVER "fixed" by masking a revive: engine_view must always speak chain truth (casting at a corpse burns gas;
// a mob the chain says is alive MUST render alive). The confirmed-kill despawn is the adapter contract; the
// revive-on-unconfirmed is the correctness guard against a fold that lies a live mob dead.

import { describe, expect, test } from 'bun:test'

import { create_fight_store } from '../src/store.js'
import { engine_view } from '../src/project.js'
import { local_intent_beats, synthetic_cast_events } from '../src/present.js'
import { encode } from '../src/los.js'

const FIGHT = '0xf1'
const CHAR = '0xc1'
const MOB_CELL = encode(5, 4)
const ev = (kind, json) => ({ type: `0xpkg::fight_events::${kind}`, parsedJson: { fight: FIGHT, ...json } })

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
      cell: encode(2, 2),
    },
  ],
  mobs: [{ template: '0xabc', hp: 8, max_hp: 30, cell: MOB_CELL, ap: 4, mp: 3, level: 1 }],
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
    .input({ type: 'init', fight_id: FIGHT, my_key: 'p0', ctx: { my_entity_id: CHAR, beat_ctx: { grid_width: 20 } } })
  store.getState().input({ type: 'snapshot', fight: FIGHT_OBJECT, version: 5 }, 1_000)
  return store
}

/** My optimistic killing cast — folds hp→0 THIS frame + appends its local wave turn (the despawn_pacing harness). */
const optimistic_kill = (store, now = 2_000) => {
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

const mob0 = (store) => engine_view(store.getState()).fighters.get('mob-0')

describe('kill → despawn (the fold speaks chain truth; the fix for ① lives at the weapon commit)', () => {
  test('a CONFIRMED kill presents dead — the rig reconcile despawns it (the adapter contract)', () => {
    const store = boot()
    optimistic_kill(store)
    // core truth is immediate (chain parity); PRESENTATION holds until the killing turn drains (death-present hold).
    expect(mob0(store).health).toBe(0)
    expect(mob0(store).dead, 'death must not present before its own killing turn drains').toBe(false)
    for (const t of [...store.getState().wave]) store.getState().input({ type: 'presented', seq: t.seq }, 3_000)
    expect(mob0(store).dead, 'once the killing turn presents, the fold owns the despawn').toBe(true)
  })

  test('an UNCONFIRMED kill REVIVES — "the model doesn’t disappear" (the weapon swing was dropped)', () => {
    const store = boot()
    optimistic_kill(store)
    expect(mob0(store).health).toBe(0) // the turn card greys — the optimistic fold shows the mob dead
    // …but the killing action never reached the chain (the DROPPED weapon strike — strike_flush_illegal root): the
    // authoritative receipt for my turn lands with the mob STILL ALIVE, purging my optimistic intents ≤ its version.
    store.getState().input(
      {
        type: 'receipt',
        fight_id: FIGHT,
        version: 6,
        receipt: {
          events: [
            ev('TurnStarted', { is_mob: false, idx: 0 }),
            ev('TurnEnded', { is_mob: false, idx: 0 }),
            ev('TurnStarted', { is_mob: true, idx: 0 }),
            ev('TurnEnded', { is_mob: true, idx: 0 }),
            ev('TurnStarted', { is_mob: false, idx: 0, deadline_ms: 120_000 }),
          ],
        },
      },
      4_000
    )
    for (const t of [...store.getState().wave]) store.getState().input({ type: 'presented', seq: t.seq }, 4_500)
    // THE FOLD IS RIGHT to revive — the chain says the mob lives; the FIX is to not drop the swing (turn_commit).
    expect(mob0(store).health, 'the fold must never mask a revive — chain truth wins').toBe(8)
    expect(mob0(store).dead).toBe(false)
  })

  test('a kill CONFIRMED by a fresh snapshot stays despawned (no snapshot resurrection)', () => {
    const store = boot()
    optimistic_kill(store)
    store
      .getState()
      .input(
        { type: 'snapshot', fight: { ...FIGHT_OBJECT, mobs: [{ ...FIGHT_OBJECT.mobs[0], hp: 0 }] }, version: 7 },
        5_000
      )
    for (const t of [...store.getState().wave]) store.getState().input({ type: 'presented', seq: t.seq }, 5_500)
    expect(mob0(store).dead).toBe(true)
    expect(mob0(store).health).toBe(0)
  })
})
