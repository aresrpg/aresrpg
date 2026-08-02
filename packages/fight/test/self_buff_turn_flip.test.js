// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Issue #1872 — THE FORK, CONVICTED, then RE-JUDGED by #2000. A self-cast `+10 Intelligence` buff vanished from
// the turn card at end-turn. The row named one read that decides it: does the buff still EXIST chain-side after
// the flip?
//   · chain ACTIVE  ⇒ the card's projection drops applied stat rows on the flip — a client defect.
//   · chain EXPIRED ⇒ the authored duration is spent and the card behaved honestly — a corpus question.
// The original read landed on EXPIRED for `turns = 1` and the answer was filed as content. #2000 (D42) overturned
// the LAW instead: an authored 1 that dies before its owner ever plays under it is not a duration, and the
// cadence — not the corpus — was wrong.
//
// This file is still that read, driven through the production doors rather than argued: a real store, the real
// receipt ingress, `engine_view(...).effects` (the exact array FightTimeline hands EffectBadges). What changed is
// the law it pins. The chain's law is now `cast::tick_turn_expiry` → `spell_board::decrement_fighter_statuses`:
// `remaining_turns` counts the bearer's turns STILL TO COME, aging fires at the BEARER's turn START, and a row is
// dropped only by the aging that finds its counter already at 0. So a turn END ages NOTHING, and an authored N
// covers the cast turn plus N further caster turns. The client mirrors that in `inputs.age_statuses`, and these
// cases pin both halves:
//   · the flip itself — the card MUST keep the row, unchanged, across the caster's own turn end. If this ever
//     goes red the fork lands on the client and #1872 is a projection defect after all.
//   · the caster's NEXT turn start — the counter ages by one there and NOWHERE else, and an authored 1 lands on
//     0 while staying on the card: that turn is the one it was authored to cover.
// Both doors that can mint the row are driven (the authoritative ActionEffect envelope AND the optimistic
// prediction that precedes it), plus the single-page drafted commit where the cast and the turn end ride one
// receipt, because a projection defect would only have to show up in one of them.
//
// Refs #1872 (fork read), #2000 (D42 — the cadence this now pins), #598/#597 (the badge-lifetime family this
// seals a second door of), #1172.

import { describe, expect, test } from 'bun:test'

import * as SE from '../../sim/src/spell_effect.js'
import { encode } from '../src/los.js'
import { engine_view } from '../src/project.js'
import { read_fighter_statuses } from '../src/fight_status_snapshot.js'
import { committed_truth, create_fight_store } from '../src/store.js'

const FIGHT = '0xf1872'
const CHAR = '0xc1872'
const CASTER = encode(5, 5)
const MOB = encode(9, 9)
const PKG = '0xpkg::fight_events::'

/** The minted chain `Effect` under report: a POINT self-cast `+10 Intelligence`, CENTERED on the wire (#983). */
const int_buff = (turns) => ({
  area_shape: SE.SHAPE_POINT,
  area_size: '0',
  chance: 100,
  element: 255,
  flags: 0,
  kind: SE.K_ALTER_STAT,
  phase: SE.PHASE_ON_ENTER,
  stat: SE.STAT_INTELLIGENCE,
  target_filter: SE.TF_ONLY_CASTER,
  turns,
  value: String(32_768 + 10),
})

/** The action envelope bracketing one self-cast, exactly as `action_envelope` emits it. */
const cast_events = (row) => [
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
]

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
  ...over,
})

const ev = ([kind, fields]) => ({ type: PKG + kind, parsedJson: { fight: FIGHT, ...fields } })
const turn_ended = ev(['TurnEnded', { is_mob: false, idx: 0 }])

/** THE ARRAY THE TURN CARD RENDERS — FightTimeline reads `f.effects` and hands it straight to EffectBadges. */
const card_rows = (store) => engine_view(store.getState()).fighters.get(CHAR).effects
const int_row = (store) => card_rows(store).find((row) => row.stat === SE.STAT_INTELLIGENCE) ?? null

const boot = (fight = fight_object()) => {
  const store = create_fight_store()
  store
    .getState()
    .input({ type: 'init', fight_id: FIGHT, my_key: 'p0', ctx: { my_entity_id: CHAR, beat_ctx: { grid_width: 20 } } })
  store.getState().input({ type: 'snapshot', fight, version: 1, journal_head: '0' }, 1_000)
  return store
}

const feed = (store, version, events, now) =>
  store.getState().input({ type: 'receipt', fight_id: FIGHT, version, receipt: { events } }, now)

/** My turn ends, the mob plays, my next turn STARTS — the one boundary that ages my rows. Returns the next
 *  free version so a caller can chain laps. */
const lap = (store, version, now) => {
  feed(store, version, [turn_ended], now)
  feed(store, version + 1, [ev(['TurnStarted', { is_mob: true, idx: 0, deadline_ms: now + 100 }])], now + 10)
  feed(store, version + 2, [ev(['TurnEnded', { is_mob: true, idx: 0 }])], now + 20)
  feed(store, version + 3, [ev(['TurnStarted', { is_mob: false, idx: 0, deadline_ms: now + 200 }])], now + 30)
  return version + 4
}

describe('#1872 a self-cast stat buff across the caster s own turn end', () => {
  test('the flip alone ages NOTHING — the card keeps the row untouched (turns 2)', () => {
    const store = boot()
    feed(store, 2, cast_events(int_buff(2)).map(ev), 1_100)
    expect(int_row(store), 'the badge is minted by the receipt door').toMatchObject({
      kind: SE.K_ALTER_STAT,
      value: 10, // decoded ONCE at the seam — never the wire's 32778
      remaining_turns: 2,
    })

    feed(store, 3, [turn_ended], 1_200)
    // THE REPORTED SYMPTOM would read null here while the chain still holds the row. Under D42 the counter does
    // not even move: the turn END is no longer a clock for a fighter's own rows.
    expect(int_row(store), 'still on the card after MY turn end, at its authored count').toMatchObject({
      value: 10,
      remaining_turns: 2,
    })
    expect(committed_truth(store.getState()).fighters.p0.statuses).toHaveLength(1)
  })

  test('the caster s NEXT turn start is the one clock — one aging per lap', () => {
    const store = boot()
    feed(store, 2, cast_events(int_buff(2)).map(ev), 1_100)
    const v = lap(store, 3, 1_200)
    expect(int_row(store), 'aged exactly once, at MY turn start').toMatchObject({ value: 10, remaining_turns: 1 })
    lap(store, v, 1_400)
    expect(int_row(store), 'its last covered turn — a landed 0 is live, not expired').toMatchObject({
      remaining_turns: 0,
    })
  })

  test('chain-ACTIVE through the OPTIMISTIC door too — the prediction hands over, it does not hand back', () => {
    const store = boot()
    // The cast-time paint: predict_cast stages the composite batch before any receipt exists.
    store.getState().input(
      {
        type: 'predicted',
        intent_id: 'buff-1',
        basis_version: 2,
        actions: [
          { kind: 'Cast', caster_is_mob: false, caster_idx: 0, target_cell: CASTER },
          {
            kind: 'StatusAdded',
            target_is_mob: false,
            target_idx: 0,
            status: {
              kind: SE.K_ALTER_STAT,
              remaining_turns: 2,
              element: null,
              value: 10,
              stat: SE.STAT_INTELLIGENCE,
              chance: 100,
              source: 0,
            },
          },
        ],
      },
      1_050
    )
    expect(int_row(store), 'painted at cast time').toMatchObject({ value: 10, remaining_turns: 2 })

    // The receipt retires the whole optimistic batch; the authoritative row must already hold the badge up.
    feed(store, 2, cast_events(int_buff(2)).map(ev), 1_100)
    expect(int_row(store), 'the receipt door owns it now').toMatchObject({ value: 10, remaining_turns: 2 })
    // …and `ended_my_turn` closes the prediction window without taking the certified row with it.
    feed(store, 3, [turn_ended], 1_200)
    expect(int_row(store), 'the turn-end blanket never reaches committed truth').toMatchObject({
      value: 10,
      remaining_turns: 2,
    })
  })

  test('chain-ACTIVE on a ONE-PAGE drafted commit — cast and turn end in the same receipt', () => {
    const store = boot()
    feed(store, 2, [...cast_events(int_buff(2)).map(ev), turn_ended], 1_100)
    expect(int_row(store)).toMatchObject({ value: 10, remaining_turns: 2 })
  })

  test('a later object read RE-ADOPTS the row rather than re-aging it', () => {
    const store = boot()
    feed(store, 2, cast_events(int_buff(3)).map(ev), 1_100)
    lap(store, 3, 1_200)
    expect(int_row(store)).toMatchObject({ remaining_turns: 2 })
    // A poll AHEAD of the folded frontier is authoritative (#1584) — it states 2, and 2 is what the card keeps:
    // the tail below the new base is not replayed on top of it, so the aging is never counted twice.
    store.getState().input(
      {
        type: 'snapshot',
        fight: fight_object({
          invisibility_statuses: read_fighter_statuses({
            fx: {
              statuses: [
                {
                  fighter: 0,
                  kind: SE.K_ALTER_STAT,
                  remaining_turns: 2,
                  source: 0,
                  effect: { stat: SE.STAT_INTELLIGENCE, value: 32_778, chance: 100, element: 255 },
                },
              ],
            },
          }),
        }),
        version: 9,
      },
      1_300
    )
    expect(int_row(store), 'the read-layer adoption restates the same row').toMatchObject({
      value: 10,
      remaining_turns: 2,
    })
  })

  test('an authored 1 covers the cast turn AND the caster s next turn, then expires (D42 overturns #1872 s corpus reading)', () => {
    const store = boot()
    feed(store, 2, cast_events(int_buff(1)).map(ev), 1_100)
    expect(int_row(store), 'visible for the turn it was cast on').toMatchObject({ remaining_turns: 1 })

    feed(store, 3, [turn_ended], 1_200)
    expect(int_row(store), 'the flip does not spend it — that was the #1872 blank-out').toMatchObject({
      remaining_turns: 1,
    })

    const v = lap(store, 4, 1_300)
    expect(int_row(store), 'the turn it was authored to cover — counter landed on 0, row still live').toMatchObject({
      remaining_turns: 0,
    })

    lap(store, v, 1_500)
    // The aging that finds a spent row is the one that drops it — chain-side and client-side alike. NOW an empty
    // card is the twin agreeing.
    expect(int_row(store)).toBeNull()
    expect(committed_truth(store.getState()).fighters.p0.statuses).toHaveLength(0)
  })
})
