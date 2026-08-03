// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #1993 WP2b item 5 — THE FOLD'S CLOCK BELONGS TO THE FIGHT, NOT TO A CARD IN THE HUD.
//
// `turn_is_playable` is the ONE core transition driven by time alone (#1808): with no input arriving, the chain
// finishes spending the turn's mob-resolution budget and the turn becomes mine. `store_tick.reduce_tick_state`
// already owns that transition — but its only CLOCK was a `setInterval` inside `FightTimeline.jsx`, a
// presentational turn-order card. A core time-driven transition whose liveness depends on a component staying
// mounted is a lockout waiting for a layout change; the same clock also drives auto-commit and the wave watchdog.
//
// The clock now lives at the fight's own edge — armed while a fight is BOUND to the store, disarmed when it
// unbinds — and re-enters through the one input door, so no callback writes a store. Everything is injected, so
// this drives the real thing with a fake clock and NO component in the tree at all.

import { beforeEach, describe, expect, test } from 'bun:test'

import { create_fight_store } from '@aresrpg/fight/store'
import { install_fight_clock, FIGHT_CLOCK_MS } from '../../src/world-shell/fight_core_clock.js'

const ME = '0xme'
const FIGHT = '0xf1'
const TURN_MS = 45_000
const MOB_RESOLVE_MS = 3_000 // actions.move: `deadline = start + turn_ms + 3s × resolved mobs`
const T0 = 1_000_000

/** A hand-cranked interval table — one entry per armed timer, so an un-disarmed clock is visible, not implied. */
const fake_timers = () => {
  const armed = new Map()
  let next = 1
  return {
    armed,
    set_interval: (fn, ms) => {
      const id = next++
      armed.set(id, { fn, ms })
      return id
    },
    clear_interval: (id) => void armed.delete(id),
    /** Fire every armed interval once — the wall clock reaching the next period. */
    fire: () => [...armed.values()].forEach((entry) => entry.fn()),
  }
}

/** A live fight of mine whose chain window the mobs' resolution budget widened by `mobs_replayed`. */
const seed_turn = (store, { mobs_replayed }) => {
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
        turn_ms: TURN_MS,
        turn_deadline_ms: T0 + TURN_MS + mobs_replayed * MOB_RESOLVE_MS,
        turn_entropy: 0,
        turn_ordinal: 0,
        placement_deadline_ms: 0,
        start_cells_a: [],
        start_cells_b: [],
        invisibility_statuses: [],
      },
    },
    T0
  )
}

let clock_now = T0
beforeEach(() => {
  clock_now = T0
})

describe('#1993 — the handover has a core owner, not a component', () => {
  test('WITHOUT a clock the transition never fires — the mechanism the owner exists for', () => {
    const store = create_fight_store()
    seed_turn(store, { mobs_replayed: 4 })
    expect(store.getState().turn_playable, 'the chain budget is unspent at T0').toBe(false)
    // Wall-clock time passing is not an input. With nobody feeding the door, the turn stays un-handed-over
    // forever — which is exactly what an unmounted timeline used to mean.
    expect(store.getState().turn_playable).toBe(false)
  })

  test('the edge clock hands the turn over with NOTHING rendered', () => {
    const timers = fake_timers()
    const store = create_fight_store()
    install_fight_clock(store, {
      set_interval: timers.set_interval,
      clear_interval: timers.clear_interval,
      now: () => clock_now,
    })
    expect(timers.armed.size, 'no fight bound ⇒ no clock running').toBe(0)

    seed_turn(store, { mobs_replayed: 4 })
    expect(timers.armed.size, 'a bound fight arms exactly one clock').toBe(1)
    expect([...timers.armed.values()][0].ms).toBe(FIGHT_CLOCK_MS)

    clock_now = T0 + 4 * MOB_RESOLVE_MS - 1
    timers.fire()
    expect(store.getState().turn_playable, 'one ms early is still not my turn').toBe(false)

    clock_now = T0 + 4 * MOB_RESOLVE_MS
    timers.fire()
    expect(store.getState().turn_playable, 'the chain’s budget is spent — hand it over').toBe(true)
    expect(store.getState().turn_started_at, 'the anchor stamps at the honest instant').toBe(clock_now)
  })

  test('the clock is bound to the FIGHT: one while it lives, none once it unbinds', () => {
    const timers = fake_timers()
    const store = create_fight_store()
    const uninstall = install_fight_clock(store, {
      set_interval: timers.set_interval,
      clear_interval: timers.clear_interval,
      now: () => clock_now,
    })
    seed_turn(store, { mobs_replayed: 0 })
    expect(timers.armed.size).toBe(1)
    // A folded tick must never arm a SECOND clock (the subscriber runs on every notification).
    timers.fire()
    timers.fire()
    expect(timers.armed.size, 'still exactly one').toBe(1)

    store.getState().input({ type: 'init', fight_id: null })
    expect(timers.armed.size, 'the fight is gone — so is its clock').toBe(0)

    seed_turn(store, { mobs_replayed: 0 })
    expect(timers.armed.size, 'a fresh fight re-arms').toBe(1)
    uninstall()
    expect(timers.armed.size, 'uninstall leaves nothing running').toBe(0)
  })

  test('the timeline no longer owns the core clock', async () => {
    const source = await Bun.file(
      new URL('../../src/game/screens/hud/FightTimeline.jsx', import.meta.url)
    ).text()
    expect(source, 'a presentational card must not drive the fight reducer’s clock').not.toContain('setInterval')
    expect(source, "…nor feed the door at all — it is a reader").not.toContain("type: 'tick'")
  })
})
