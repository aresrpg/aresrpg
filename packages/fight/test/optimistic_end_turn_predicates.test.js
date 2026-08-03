// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #1993 WP2b item 3 — WHICH FOLD ANSWERS `deadline_starved` / `phase` / `winner`.
//
// The store root is the CLAIMED fold: `recompute` spreads `fold_claimed_budget(base, log, …)` and `log`
// carries MY OWN intents. So a `project_state` predicate reading `state.x` reads a value my optimism can move.
// One of the three is genuinely moved by an intent, two are not — and this file is the decision, driven:
//
//  · `deadline_starved` — MOVED. `end_turn` normalizes to `TurnEnded`, whose fold arm sets
//    `{ active: null, turn_deadline_fresh: false }`. On a genuinely starved read that silences the starvation
//    the instant I press END TURN and un-silences it when the commit is refused — a diagnostic about the
//    CHAIN's clock, blinked by a local prediction. MIGRATED to the committed record.
//  · `phase` / `winner` — NOT MOVED, by construction: the ONLY fold arms that write them are `Victory` and
//    `Defeat`, and no intent normalizes to either (`normalize_intent` emits TurnEnded/Cast/Moved; the
//    passthrough arm is fed Placed/Hit/Tackled by the board). The claimed fold's value for these two IS
//    committed truth. DECLINED — kept, with the why at the read site, and the invariant pinned below so the
//    verdict is sealed rather than asserted.

import { beforeEach, describe, expect, test } from 'bun:test'

import { fight_store } from '../src/store.js'
import { deadline_starved, phase, winner, is_my_turn } from '../src/project_state.js'
import { committed_truth } from '../src/store.js'

const ME = '0xme'
const FIGHT = '0xf1'

/** A live fight on MY turn. `turn_deadline_ms: 0` is the STARVED read — the chain's own clock never landed. */
const seed = ({ turn_deadline_ms = 0 } = {}, now = 1_000_000) => {
  const store = fight_store
  store.getState().input({ type: 'init', fight_id: null })
  store.getState().input({
    type: 'init',
    fight_id: FIGHT,
    my_key: 'p0',
    ctx: { my_entity_id: ME, beat_ctx: { grid_width: 20 } },
  })
  store.getState().input(
    {
      type: 'snapshot',
      version: 1,
      fight: {
        id: FIGHT,
        status: 1,
        width: 20,
        height: 19,
        participants: [
          {
            owner: '0xaaa',
            character: ME,
            class: 'senshi',
            team: 0,
            ap: 6,
            mp: 3,
            base_ap: 6,
            base_mp: 3,
            hp: 50,
            max_hp: 50,
            cell: 100,
            ready: false,
          },
        ],
        mobs: [{ template: '0xabc', hp: 30, max_hp: 30, cell: 105, ap: 4, mp: 3, level: 1 }],
        queue: [
          { is_mob: false, idx: 0 },
          { is_mob: true, idx: 0 },
        ],
        turn_ptr: 0,
        turn_ms: 0,
        turn_deadline_ms,
        turn_entropy: 0,
        turn_ordinal: 0,
        placement_deadline_ms: 0,
        start_cells_a: [],
        start_cells_b: [],
        invisibility_statuses: [],
      },
    },
    now
  )
  return store
}

// Past the min-turn floor (`submit_wait_ms`), or the door HOLDS the press as `pending_end_turn` and nothing folds.
const end_turn_optimistically = (now = 1_005_000) =>
  fight_store.getState().input({ type: 'intent', intent: { kind: 'end_turn' } }, now)

beforeEach(() => fight_store.getState().input({ type: 'init', fight_id: null }))

describe('#1993 — an optimistic end-turn cannot silence a starved chain clock', () => {
  test('the intent DOES move the claimed fold — the mechanism, pinned', () => {
    const store = seed()
    expect(store.getState().active, 'the chain seat is mine before the press').toBe('p0')
    end_turn_optimistically()
    // THE BEFORE-BEHAVIOUR, explicit: my own prediction empties the claimed seat and clears the freshness flag.
    // This is CORRECT for the claimed fold (the turn is over as far as my client is concerned) and is exactly
    // why a chain-clock diagnostic must not read it.
    expect(store.getState().active, 'the claimed fold ends my turn optimistically').toBeNull()
    expect(store.getState().turn_deadline_fresh).toBe(false)
    // …while the COMMITTED record is untouched: the chain has not seen the commit.
    expect(committed_truth(store.getState()).active, 'the chain still has me seated').toBe('p0')
    expect(is_my_turn(store.getState()), 'the committed-reading predicate agrees').toBe(true)
  })

  test('a STARVED turn stays starved across my own optimistic end-turn', () => {
    const store = seed({ turn_deadline_ms: 0 })
    expect(deadline_starved(store.getState()), 'no chain deadline was ever observed').toBe(true)
    end_turn_optimistically()
    // THE AFTER-BEHAVIOUR (the change): the sync chip keeps telling the truth about the CHAIN's clock while my
    // commit is in flight — and no longer flickers starved → clear → starved when that commit is refused.
    expect(deadline_starved(store.getState()), 'the chain clock is still missing — say so').toBe(true)
  })

  test('a healthy turn never reports starvation — the control for the assertion above', () => {
    const store = seed({ turn_deadline_ms: 1_090_000 })
    expect(deadline_starved(store.getState())).toBe(false)
    end_turn_optimistically()
    expect(deadline_starved(store.getState())).toBe(false)
  })
})

describe('#1993 — `phase` / `winner` stay on the claimed fold (declined migration), and here is why', () => {
  test('no optimistic intent can move either — the property the decline rests on', () => {
    const store = seed({ turn_deadline_ms: 1_090_000 })
    expect(phase(store.getState())).toBe('active')
    expect(winner(store.getState())).toBe(-1)
    // Every intent shape the board actually emits, including a LETHAL optimistic hit on the only mob.
    fight_store.getState().input({ type: 'intent', intent: { kind: 'move', character: ME, to_cell: 101 } })
    fight_store.getState().input({ type: 'intent', intent: { kind: 'cast', target_cell: 105, damaging: true } })
    fight_store
      .getState()
      .input({ type: 'intent', intent: { kind: 'Hit', victim_is_mob: true, victim_idx: 0, remaining_hp: 0 } })
    end_turn_optimistically()
    expect(phase(store.getState()), 'a prediction cannot declare a fight over').toBe('active')
    expect(winner(store.getState())).toBe(-1)
    expect(phase(store.getState()), 'claimed and committed agree, always').toBe(committed_truth(store.getState()).phase)
    expect(winner(store.getState())).toBe(committed_truth(store.getState()).winner)
  })

  test('a real Victory RECEIPT does move both — the positive control', () => {
    const store = seed({ turn_deadline_ms: 1_090_000 })
    fight_store.getState().input({
      type: 'receipt',
      version: 6,
      receipt: { events: [{ type: '0x0::fight_events::Victory', parsedJson: { fight: FIGHT } }] },
    })
    expect(phase(store.getState())).toBe('victory')
    expect(winner(store.getState())).toBe(0)
  })
})
