// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #1993 WP2b round 2 — THE FORECAST ARMS ON THE SAME BOUNDARY THE BOARD DOES.
//
// `compute_target_prediction`'s CASTABLE-NOW gate spelled the pre-#1808 boundary
// (`active_entity_id === caster ⋀ winner === -1 ⋀ !presenting`) — the fourth home of it, and the one its own
// doc promised was "the identical two facts turn_input_armed + wash_armed_spell already gate the board's OWN
// targeting-range wash on". The wash reads `input_armed(s, { busy })`; this read the boundary that predates it.
//
// SEMANTICS — the forecast must NOT arm during the handover window. This card is an affordance, not a readout:
// "this cast kills it" is the thing a player acts on, and the board's own targeting wash is DARK in that window
// (`playable` false). A live forecast over a dark board is the granted-then-retracted turn wearing a number.
// So the gate is `input_armed` — `turn_playable ⋀ !is_over`, one read, the same fact the board now consumes.
//
// The edge `busy` and `cast_presenting` halves of `wash_armed_spell` stay out: this module has never received
// the run store's flight flag, and both belong to families that migrate on their own trains.

import { describe, expect, test, beforeEach } from 'bun:test'
import { fight_store } from '@aresrpg/fight/store'
import { engine_view, board_view } from '@aresrpg/fight/project'
import { WEAPON_ATTACK_ID } from '@aresrpg/fight/weapon'

import { compute_target_prediction, EMPTY_PREDICTION } from '../../../../src/game/screens/hud/target_prediction_core.js'
import { seed_fight_core, reset_fight_core } from '../../../../src/test_helpers/fight_core_harness.js'

const ME = '0xme'
const FIGHT = '0xf1'
const TURN_MS = 45_000
const MOB_RESOLVE_MS = 3_000 // actions.move: `deadline = start + turn_ms + 3s × resolved mobs`
const CASTER_CELL = 100
const MOB_CELL = 101
const WEAPON = { ap_cost: 2, damage: 5, crit_rate: 10, reach: 2 }

/** The mob cascade the chain hands back in ONE receipt — a NON-LOCAL wave, i.e. `presenting`. */
const CASCADE = [
  { type: '0x0::fight_events::TurnEnded', parsedJson: { fight: FIGHT, is_mob: false, idx: 0 } },
  { type: '0x0::fight_events::TurnStarted', parsedJson: { fight: FIGHT, is_mob: true, idx: 0, deadline_ms: 0 } },
  { type: '0x0::fight_events::MobMoved', parsedJson: { fight: FIGHT, idx: 0, to_cell: 107 } },
  { type: '0x0::fight_events::TurnEnded', parsedJson: { fight: FIGHT, is_mob: true, idx: 0 } },
]

/** Seat me with an affordable weapon, ARM it while the turn is still ordinary, then apply `after` (the window
 *  under test) and read the forecast. Arming first is the real sequence: `armed_spell_id` survives by design. */
const forecast = ({ turn_ms = 0, mobs_replayed = 0, after = null, now = Date.now() } = {}) => {
  seed_fight_core({
    fight_id: FIGHT,
    my: ME,
    active: ME,
    seats: [{ character: ME, cell: CASTER_CELL, ap: 6, mp: 3, weapon: WEAPON }],
    mobs: [{ template: '0xabc', hp: 30, max_hp: 30, cell: MOB_CELL, ap: 4, mp: 3, level: 1 }],
    turn_ms,
    turn_deadline_ms: now + TURN_MS + mobs_replayed * MOB_RESOLVE_MS,
  })
  fight_store.getState().input({ type: 'arm', spell_id: WEAPON_ATTACK_ID })
  after?.(now)
  const state = fight_store.getState()
  return compute_target_prediction({
    fight: engine_view(state),
    hover: { entity_id: 'mob-0' },
    dungeon: board_view(state),
    slot: 0,
  })
}

beforeEach(reset_fight_core)

describe('#1993 — the target forecast arms on `input_armed`', () => {
  test('A · an ordinary turn forecasts', () => {
    const out = forecast()
    expect(fight_store.getState().turn_playable).toBe(true)
    expect(out).not.toBe(EMPTY_PREDICTION)
    expect(out.prediction).not.toBeNull()
  })

  test('B · a STARVED read (no chain deadline) still forecasts — the gate fails OPEN', () => {
    const out = forecast({ turn_ms: TURN_MS, now: -TURN_MS }) // deadline 0 ⇒ no locatable handover instant
    expect(fight_store.getState().turn_deadline_ms).toBeNull()
    expect(fight_store.getState().turn_playable).toBe(true)
    expect(out).not.toBe(EMPTY_PREDICTION)
  })

  test('C · MID-PRESENTATION (a mob wave draining) forecasts nothing', () => {
    const out = forecast({
      after: (now) => fight_store.getState().input({ type: 'receipt', receipt: { events: CASCADE }, version: 6 }, now),
    })
    expect(fight_store.getState().wave.some((t) => !t.is_local)).toBe(true)
    expect(out).toBe(EMPTY_PREDICTION)
  })

  test('D · the POST-HANDOVER WINDOW: what MASKED the stale gate, named', () => {
    // Nothing is replaying, the chain seat is mine, the weapon is affordable — the ONLY thing outstanding is the
    // chain's own mob-resolution budget, and the old gate called that my turn. No player ever saw a forecast
    // there for ONE reason, which is not the gate: `recompute` clears `armed_spell_id` on every non-playable
    // fold, so the `!armed` guard upstream refused first. Exactly the shape `emit_click`'s single playable-gated
    // caller masked on the board. Pinning it here is what makes the migration a deletion and not a guess.
    const now = Date.now()
    forecast({ now }) // arm on an ordinary turn — armed_spell_id survives turns by design
    expect(fight_store.getState().armed_spell_id).toBe(WEAPON_ATTACK_ID)
    seed_fight_core({
      fight_id: FIGHT,
      my: ME,
      active: ME,
      seats: [{ character: ME, cell: CASTER_CELL, ap: 6, mp: 3, weapon: WEAPON }],
      mobs: [{ template: '0xabc', hp: 30, max_hp: 30, cell: MOB_CELL, ap: 4, mp: 3, level: 1 }],
      turn_ms: TURN_MS,
      turn_deadline_ms: now + TURN_MS + 4 * MOB_RESOLVE_MS,
    })
    const state = fight_store.getState()
    expect(state.wave.length, 'nothing is replaying').toBe(0)
    expect(state.active, 'the chain seat is still mine — only the handover is pending').toBe('p0')
    expect(state.turn_playable, 'the chain budget is unspent').toBe(false)
    expect(state.armed_spell_id, 'THE MASK: the fold disarms whenever the turn is not playable').toBeNull()
    const view = engine_view(state)
    // THE PURE CONTRACT — this module is a function of the view it is HANDED, not of an invariant its one
    // current caller happens to maintain. Restore the armed id (what a second caller, or a fold that stops
    // disarming, would hand it) and the two gates part company: the old expression sees `!presenting` ⋀ my seat
    // and forecasts a kill over a board whose targeting wash is dark; `input_armed` refuses.
    const unmasked = compute_target_prediction({
      fight: { ...view, armed_spell_id: WEAPON_ATTACK_ID },
      hover: { entity_id: 'mob-0' },
      dungeon: board_view(state),
      slot: 0,
    })
    expect(unmasked, 'no forecast before the chain hands the turn over').toBe(EMPTY_PREDICTION)

    // …and the same view, one tick past the handover instant, forecasts again.
    fight_store.getState().input({ type: 'tick' }, now + 4 * MOB_RESOLVE_MS + 1)
    fight_store.getState().input({ type: 'arm', spell_id: WEAPON_ATTACK_ID })
    const handed_over = fight_store.getState()
    expect(handed_over.turn_playable).toBe(true)
    expect(
      compute_target_prediction({
        fight: engine_view(handed_over),
        hover: { entity_id: 'mob-0' },
        dungeon: board_view(handed_over),
        slot: 0,
      }),
      'the handover arms the forecast with it'
    ).not.toBe(EMPTY_PREDICTION)
  })

  test('E · a DECIDED fight forecasts nothing — `is_over` rides inside the one read', () => {
    // The conjunct the old expression spelled by hand (`winner === -1`). `input_armed` folds it in, so this pins
    // that consolidating the read did not silently drop it.
    const out = forecast({
      after: () =>
        fight_store.getState().input({
          type: 'receipt',
          version: 6,
          receipt: { events: [{ type: '0x0::fight_events::Victory', parsedJson: { fight: FIGHT } }] },
        }),
    })
    expect(fight_store.getState().winner).toBe(0)
    expect(out).toBe(EMPTY_PREDICTION)
  })

  test('the gate is the one read — no fourth spelling of the boundary survives', async () => {
    const source = await Bun.file(
      new URL('../../../../src/game/screens/hud/target_prediction_core.js', import.meta.url)
    ).text()
    expect(source).not.toContain('!fight.presenting')
    expect(source).toContain('fight.input_armed !== true')
  })
})
