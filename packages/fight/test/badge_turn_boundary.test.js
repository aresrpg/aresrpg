// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Issue #598 / #597 — THE BADGE MUST SURVIVE THE TURN BOUNDARY.
//
// Field report on edge: an applied multi-turn effect showed on the nametag and the turn card during the caster's
// turn, then disappeared entirely the moment the turn ended, while the effect was still mechanically active.
// #597 was folded into the V2 cutover (#522) as a POST-CUTOVER VERIFY row with an explicit instruction: if the
// symptom survives the cutover it reopens with a repro; if the new projection carries the lifetime correctly the
// row converts to a sealed check. This file is that check, driven end to end through the surface the player
// actually sees — a real store, real receipts, `engine_view(...).effects` (the array the badge HUD renders).
//
// The lifetime it pins is the chain's own (`cast.move:1585` ages the ENDING actor's rows): a `turns = 3` row
// renders 3 → 2 → 1 across the OWNER's three turn ends, is untouched by anyone else's turn, and dies exactly when
// the chain says it does — never at the first boundary.
//
// The other two legs of #598 are closed elsewhere and stay closed: the duration semantics leg is the design row
// #626 (turns should not consume the cast turn — a maintainer ruling, not a bug), and the MP-pool leg was the
// sim's refill-before-decrement ordering, fixed in `fight_state.active_pool_modifier` (its docstring cites #598).

import { describe, expect, test } from 'bun:test'

import * as SE from '../../sim/src/spell_effect.js'
import { encode } from '../src/los.js'
import { engine_view } from '../src/project.js'
import { read_fighter_statuses } from '../src/fight_status_snapshot.js'
import { create_fight_store } from '../src/store.js'

const FIGHT = '0xf598'
const CHAR = '0xc598'
const SEAT = encode(5, 5)
const MOB = encode(8, 8)
const ev = (kind, fields) => ({ type: `0x0::fight_events::${kind}`, parsedJson: { fight: FIGHT, ...fields } })

/** A live `+20 Strength · 3 turns` row on my seat, decoded off the wire exactly as the chain mints it (CENTERED). */
const ACTIVE_BUFF = read_fighter_statuses({
  fx: {
    statuses: [
      {
        fighter: 0,
        kind: SE.K_ALTER_STAT,
        remaining_turns: 3,
        source: 0,
        effect: { stat: SE.STAT_STRENGTH, value: 32_788, chance: 100, element: 255 },
      },
    ],
  },
})

const fight_object = (over = {}) => ({
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
      cell: SEAT,
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
  invisibility_statuses: ACTIVE_BUFF,
  ...over,
})

const boot = (fight = fight_object()) => {
  const store = create_fight_store()
  store
    .getState()
    .input({ type: 'init', fight_id: FIGHT, my_key: 'p0', ctx: { my_entity_id: CHAR, beat_ctx: { grid_width: 20 } } })
  store.getState().input({ type: 'snapshot', fight, version: 5 }, 1_000)
  return store
}

/** The array the effect-badge HUD renders — the projection the field report was about. */
const badges = (store) => engine_view(store.getState()).fighters.get(CHAR).effects
const buff_turns = (store) => badges(store).find((row) => row.kind === SE.K_ALTER_STAT)?.remaining_turns ?? null

const feed = (store, version, events, now) =>
  store.getState().input({ type: 'receipt', fight_id: FIGHT, version, receipt: { events } }, now)

/** Drain every paced wave turn so the eye reaches the frontier — the badge must be right on BOTH sides of this. */
const drain = (store, now) => {
  for (const turn of [...store.getState().wave]) store.getState().input({ type: 'presented', seq: turn.seq }, now)
}

/** One full round: my turn ends, the mob takes its turn, my turn opens again. */
const round = (store, version, now) => {
  feed(store, version, [ev('TurnEnded', { is_mob: false, idx: 0 })], now)
  feed(
    store,
    version + 1,
    [
      ev('TurnStarted', { is_mob: true, idx: 0, deadline_ms: 0 }),
      ev('Cast', { caster_is_mob: true, caster_idx: 0, target_cell: SEAT }),
      ev('TurnEnded', { is_mob: true, idx: 0 }),
    ],
    now + 100
  )
  drain(store, now + 200)
  feed(store, version + 2, [ev('TurnStarted', { is_mob: false, idx: 0, deadline_ms: 90_000 })], now + 300)
  return version + 3
}

describe('#598/#597 the badge lifetime survives the turn boundary (post-V2-cutover verify)', () => {
  test('a 3-turn buff renders 3 → 2 → 1 across MY turn ends and never blinks out early', () => {
    const store = boot()
    expect(buff_turns(store), 'the badge is there before anything moves').toBe(3)

    let version = 6
    const seen = []
    for (let turn = 0; turn < 3; turn += 1) {
      version = round(store, version, 2_000 + turn * 1_000)
      seen.push(buff_turns(store))
    }
    // THE REPORTED DEFECT would read [null, null, null] — gone at the first boundary while still active.
    expect(seen).toEqual([2, 1, null])
  })

  test("the badge is untouched by ANOTHER fighter's turn — only the owner's turn end ages it", () => {
    const store = boot()
    feed(
      store,
      6,
      [
        ev('TurnStarted', { is_mob: true, idx: 0, deadline_ms: 0 }),
        ev('Cast', { caster_is_mob: true, caster_idx: 0, target_cell: SEAT }),
        ev('Hit', { victim_is_mob: false, victim_idx: 0, amount: 10, remaining_hp: 40 }),
        ev('TurnEnded', { is_mob: true, idx: 0 }),
      ],
      2_000
    )
    // Mid-wave: the eye is behind the frontier and the badge must STILL render — a lagging cursor is not an expiry.
    expect(buff_turns(store), 'the badge holds while the mob turn paces').toBe(3)
    drain(store, 2_500)
    expect(buff_turns(store), 'and after the wave drains — nobody aged my row but me').toBe(3)
  })

  test('a mid-fight object read cannot blank the badge — a snapshot at/below the cursor is a checkpoint', () => {
    const store = boot()
    // The reported shape of the defect was "turn advance rebuilds the presentation from a turn-scoped snapshot".
    // It cannot: a mid-fight object read rides the SAME object version as the events of the tx that produced it, so
    // it lands AT OR BELOW the truth cursor those events already advanced — and `adopt_snapshot` drops a read that
    // is not ahead of the frontier. That is what makes the object a version WATERMARK mid-fight: not blindness to
    // its content (a read genuinely AHEAD of the frontier is authoritative — #1584), but the cursor gate.
    feed(store, 7, [ev('TurnStarted', { is_mob: true, idx: 0, deadline_ms: 0 })], 2_500)
    for (const statuses of [[], undefined])
      store
        .getState()
        .input({ type: 'snapshot', fight: fight_object({ invisibility_statuses: statuses }), version: 7 }, 3_000)

    expect(store.getState().view_version, 'the base did not move — the read was a checkpoint').toBe(5)
    expect(buff_turns(store), 'and the badge is still the fold s truth').toBe(3)
  })
})
