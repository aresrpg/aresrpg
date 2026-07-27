// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #1336 cursor honesty at the presentation seam. A behind object cannot alter a receipt fold. An object ahead of
// the cursor is instead the complete new base, so every projection must drop the old retirement state together.

import { describe, expect, test } from 'bun:test'

import { committed_truth, create_fight_store } from '../src/store.js'
import { engine_view } from '../src/project.js'
import { presented_state, display_state } from '../src/fold.js'
import { local_intent_beats, synthetic_cast_events } from '../src/present.js'
import { encode } from '../src/los.js'

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
  turn_entropy: 90_000,
  turn_ordinal: 1,
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

describe('#1336 retirement state across snapshot boundaries', () => {
  test('a behind object is discarded and cannot resurrect a fighter during a masking wave', () => {
    const store = boot()
    predict_kill(store) // intent-predicted death
    confirm_kill(store) // the same death, proven by the receipt → retired floor set
    drain(store, 3_500)
    expect(mob0(store).dead, 'the confirmed kill presents dead once its own turn drains').toBe(true)
    expect(store.getState().retired?.m0, 'the receipt floored the death').toBeGreaterThanOrEqual(0)

    store.getState().input({ type: 'snapshot', fight: fight_object(8), version: 5 }, 4_000)
    expect(mob0(store).committed_dead, 'the behind object is inert').toBe(true)

    // A later event wave still folds over the death-proven base.
    store.getState().input(
      {
        type: 'receipt',
        fight_id: FIGHT,
        version: 7,
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
    expect(mob0(store).dead, 'a behind read cannot alter the presented fold').toBe(true)

    drain(store, 6_000)
    expect(mob0(store).dead, 'still dead after the wave — the death presented exactly once').toBe(true)
  })

  test('an ahead object replaces retirement state in committed, presented, and display projections', () => {
    const store = boot()
    predict_kill(store)
    confirm_kill(store)
    drain(store, 3_500)
    store.getState().input({ type: 'snapshot', fight: fight_object(8), version: 8 }, 4_000)
    expect(store.getState().view_version).toBe(8)
    expect(mob0(store).committed_dead, 'the complete v8 base says the mob is alive').toBe(false)
    // A masking wave keeps presented/display on their re-fold branch; neither may carry the discarded retirement.
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
    expect(committed_truth(s).fighters?.m0?.alive).toBe(true)
    expect(presented_state(s).fighters?.m0?.alive).toBe(true)
    expect(display_state(s).fighters?.m0?.alive).toBe(true)
  })
})
