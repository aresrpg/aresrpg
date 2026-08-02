// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Issue #2000 (D42) — THE PREVIEW'S HALF OF THE TURN-START EXPIRY, pinned against the twin's own arc.
//
// The chain law (`spell_board::decrement_fighter_statuses` + `cast::tick_turn_expiry`, mirrored by
// `sim/fight_actions.expire_turn_effects`): `remaining_turns` counts the bearer's turns STILL TO COME, a row is
// kept while it has any (its counter landing on 0 marks its LAST covered turn) and drops only on the aging that
// finds it already at 0 — and that aging fires at the BEARER's turn START, ahead of the pool refill, never at
// turn end. So an authored N covers the cast turn plus N further bearer turns.
//
// THE REFERENCE ARC is the sim replay capsule `buff_duration_one_covers_the_casters_next_turn` (authored
// 2026-08-02 with the twin): a `turns = 1` self-buff read through THREE damage casts on three consecutive caster
// turns produces 30 / 30 / 20, where the superseded end-turn cadence produced 30 / 20 / 20 — the middle read is
// the whole fork. The fight core cannot run that capsule (it folds chain EVENTS, not sim commands, and the
// sim helper is not importable law here — see `inputs.age_statuses`), so this file pins the same three reads
// through the preview's own observables:
//   · read 1 — the cast turn: the row exists, counter still at its authored 1.
//   · read 2 — the caster's NEXT turn: the row is STILL THERE at 0 and its pool grant still moves the refill.
//     (The old cadence deleted it at the caster's preceding turn end — this read is the capsule's middle 30.)
//   · read 3 — the turn after: the aging finds it spent, the row is gone and the refill is back to base.
// A mob turn in between must move nothing: aging is keyed on the BEARER, never the global turn ordinal.
//
// Refs #2000 (D42), #973 (the refill a timed grant prices), #1540 (the glyph clock this does NOT move).

import { describe, expect, test } from 'bun:test'

import * as SE from '../../sim/src/spell_effect.js'
import { encode } from '../src/los.js'
import { engine_view } from '../src/project.js'
import { committed_truth, create_fight_store } from '../src/store.js'

const FIGHT = '0xf2000'
const CHAR = '0xc2000'
const CASTER = encode(5, 5)
const MOB = encode(9, 9)
const PKG = '0xpkg::fight_events::'

const ev = ([kind, fields]) => ({ type: PKG + kind, parsedJson: { fight: FIGHT, ...fields } })

/** A self-cast `+1 MP` point grant, CENTERED nowhere (GIVE_POINTS rides its plain magnitude on the wire). */
const mp_grant = (turns) => ({
  area_shape: SE.SHAPE_POINT,
  area_size: '0',
  chance: 100,
  element: 255,
  flags: 0,
  kind: SE.K_GIVE_POINTS,
  phase: SE.PHASE_ON_ENTER,
  stat: SE.POINT_MP,
  target_filter: SE.TF_ONLY_CASTER,
  turns,
  value: '1',
})

/** One self-cast, exactly as `action_envelope` brackets it. */
const cast_events = (row) =>
  [
    [
      'ActionStarted',
      {
        action_kind: 0,
        action_ordinal: '0',
        ap_cost: '3',
        caster_idx: '0',
        caster_is_mob: false,
        effect_count: '1',
        target_cell: String(CASTER),
        turn_ordinal: '1',
      },
    ],
    [
      'ActionEffect',
      {
        action_ordinal: '0',
        caster_idx: '0',
        caster_is_mob: false,
        effect: row,
        effect_ordinal: '0',
        turn_ordinal: '1',
      },
    ],
    ['Cast', { caster_is_mob: false, caster_idx: 0, target_cell: CASTER }],
    [
      'ActionResolved',
      {
        action_kind: 0,
        action_ordinal: '0',
        ap_cost: '3',
        caster_idx: '0',
        caster_is_mob: false,
        effects: [row],
        fumbled: false,
        returned: false,
        turn_ordinal: '1',
      },
    ],
  ].map(ev)

const fight_object = {
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
      hp: 50,
      max_hp: 50,
      ap: 6,
      mp: 3,
      base_ap: 6,
      base_mp: 3,
      cell: CASTER,
      base_stats: { intelligence: 0 },
    },
  ],
  mobs: [{ template: '0xabc', hp: 30, max_hp: 30, cell: MOB, ap: 4, mp: 3, level: 1 }],
  queue: [
    { is_mob: false, idx: 0 },
    { is_mob: true, idx: 0 },
  ],
  turn_ptr: 0,
  turn_deadline_ms: 90_000,
  turn_entropy: 90_000,
  turn_ordinal: 1,
  invisibility_statuses: [],
}

const boot = () => {
  const store = create_fight_store()
  store
    .getState()
    .input({ type: 'init', fight_id: FIGHT, my_key: 'p0', ctx: { my_entity_id: CHAR, beat_ctx: { grid_width: 20 } } })
  store.getState().input({ type: 'snapshot', fight: fight_object, version: 1, journal_head: '0' }, 1_000)
  return store
}

const feed = (store, version, events, now) =>
  store.getState().input({ type: 'receipt', fight_id: FIGHT, version, receipt: { events } }, now)

/** One full lap of the queue: my turn ends, the mob plays, my next turn STARTS. Returns the next free version. */
const lap = (store, version, now) => {
  feed(store, version, [ev(['TurnEnded', { is_mob: false, idx: 0 }])], now)
  feed(store, version + 1, [ev(['TurnStarted', { is_mob: true, idx: 0, deadline_ms: now + 100 }])], now + 10)
  feed(store, version + 2, [ev(['TurnEnded', { is_mob: true, idx: 0 }])], now + 20)
  feed(store, version + 3, [ev(['TurnStarted', { is_mob: false, idx: 0, deadline_ms: now + 200 }])], now + 30)
  return version + 4
}

const my_row = (store) =>
  engine_view(store.getState())
    .fighters.get(CHAR)
    .effects.find((row) => row.kind === SE.K_GIVE_POINTS) ?? null
const my_mp = (store) => committed_truth(store.getState()).fighters.p0.mp

describe('#2000 the fight preview ages statuses at the bearer s turn START', () => {
  test('an authored 1 covers the cast turn AND the caster s next turn — the capsule s 30/30/20 middle read', () => {
    const store = boot()
    feed(store, 2, cast_events(mp_grant(1)), 1_100)

    // READ 1 — the cast turn. The aging for this turn already ran before the cast, so the authored counter stands.
    expect(my_row(store), 'minted by the receipt door on the cast turn').toMatchObject({
      kind: SE.K_GIVE_POINTS,
      stat: SE.POINT_MP,
      value: 1,
      remaining_turns: 1,
    })

    // READ 2 — the caster's NEXT turn. This is the read the end-turn cadence got wrong: it aged the row at MY
    // turn end and the buff was gone before I ever played under it.
    const v = lap(store, 3, 1_200)
    expect(my_row(store), 'still live on the turn its counter lands on').toMatchObject({ remaining_turns: 0 })
    expect(my_mp(store), 'and its grant still prices the refill: base 3 + 1').toBe(4)

    // READ 3 — the turn after. The aging finds the row spent and drops it; the refill is base again.
    lap(store, v, 1_400)
    expect(my_row(store), 'the aging that finds a spent row is the one that drops it').toBeNull()
    expect(my_mp(store), 'the refill is back to base_mp').toBe(3)
  })

  test('a MOB turn ages nothing of mine — the clock is the BEARER s, not the global ordinal', () => {
    const store = boot()
    feed(store, 2, cast_events(mp_grant(1)), 1_100)
    // The mob plays a whole turn while I hold mine open: no TurnStarted of MINE, so no aging of mine.
    feed(store, 3, [ev(['TurnStarted', { is_mob: true, idx: 0, deadline_ms: 1_300 }])], 1_200)
    feed(store, 4, [ev(['TurnEnded', { is_mob: true, idx: 0 }])], 1_250)
    expect(my_row(store), 'untouched by another fighter s turn').toMatchObject({ remaining_turns: 1 })
  })

  test('an authored 3 spends exactly three further turns of mine', () => {
    const store = boot()
    feed(store, 2, cast_events(mp_grant(3)), 1_100)
    expect(my_row(store)).toMatchObject({ remaining_turns: 3 })
    let v = lap(store, 3, 1_200)
    expect(my_row(store)).toMatchObject({ remaining_turns: 2 })
    v = lap(store, v, 1_400)
    expect(my_row(store)).toMatchObject({ remaining_turns: 1 })
    v = lap(store, v, 1_600)
    expect(my_row(store), 'the last turn it covers').toMatchObject({ remaining_turns: 0 })
    expect(my_mp(store), 'still granting on its last covered turn').toBe(4)
    lap(store, v, 1_800)
    expect(my_row(store), 'expired at the start of turn N+1').toBeNull()
  })
})
