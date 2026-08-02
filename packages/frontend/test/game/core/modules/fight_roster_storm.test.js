// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #2027 — the live ctx{roster} re-entrancy storm. The fight store's own breaker fired during a real fight
// ("1000 re-entrant inputs folded during ONE input … still queued: ctx{roster}") and its uncaught throw took the
// post-fight settlement pipeline with it (loot locked until a refresh).
//
// THE PUMP PATH, verbatim: `fight.js` subscribes the roster adopter to the fight store, so the adopter runs on
// EVERY notification and its publish re-enters the SAME door. Re-entrant inputs are QUEUED (store.js's flat
// drain), so `ctx.roster` is always at least one publish BEHIND what the adopter last sent. A delta check keyed
// on that REFERENCE can never agree with itself once two notifications land while one publish is in flight:
// every fold republishes a content-identical roster, forever.
//
// The store is a real `create_fight_store()` instance and the three production defaults (publish / get_carried /
// get_session_key) are reproduced against it verbatim — the drain being exercised is the shipped one, while the
// app-wide singleton (which 600+ sibling test files subscribe and dispatch through) cannot mask a storm here.

import { describe, expect, test } from 'bun:test'

const { create_fight_store } = await import('@aresrpg/fight/store')
const { create_fight_roster_adoption } = await import('../../../../src/game/core/modules/fight_roster_adoption.js')

const FIGHT = '0xstormfight'
const ALICE = '0xalice'
const BOB = '0xbob'

const MINE = [{ id: ALICE, name: 'Kaelen', classe: 'senshi', sex: 'male', male: true }]
const FIGHTERS = new Map([
  [ALICE, { is_player: true, character_id: ALICE }],
  [BOB, { is_player: true, character_id: BOB }],
])

/** A live fight with the app's own adopter on it, wired exactly as `fight_roster_adoption.js` wires itself to
 *  the singleton: publish through the ONE door, carry off `ctx.roster`, key the session off core+fight id. */
const mount = () => {
  const store = create_fight_store()
  store.getState().input({ type: 'init', fight_id: FIGHT, my_key: 'p0', ctx: {} }, 1)
  const publishes = /** @type {any[][]} */ ([])
  const ensure_roster = create_fight_roster_adoption({
    get_mine: () => MINE,
    get_fighters: () => FIGHTERS,
    get_carried: () => store.getState().ctx?.roster ?? [],
    get_session_key: () => `${store.getState().core.session_generation ?? 0}:${store.getState().fight_id ?? ''}`,
    publish: (rows) => {
      publishes.push(rows)
      store.getState().input({ type: 'ctx', ctx: { roster: rows } })
    },
    resolve_characters: async () => new Map(),
  })
  return { store, ensure_roster, publishes }
}

describe('#2027 the roster adopter converges through the real fight-store pump', () => {
  test('a roster first published from inside a drained fold does not storm the door', () => {
    const { store, ensure_roster, publishes } = mount()
    // The app's second ctx publisher on the same door (seat follow / the mob-identity resolver): a mirror
    // subscriber that feeds the door ONCE from inside a notification — the projection-mirror → dungeon-store →
    // busy-mirror hop the store's own drain test already models. Its fold notifies twice (the reducer's set,
    // then the core publish), which is exactly the window where the adopter's own publish is still queued.
    let mirrored = false
    store.subscribe(() => {
      if (mirrored) return
      mirrored = true
      store.getState().input({ type: 'ctx', ctx: { my_entity_id: ALICE } })
    })
    store.subscribe(ensure_roster)

    let thrown = /** @type {any} */ (null)
    try {
      store.getState().input({ type: 'ctx', ctx: { beat_ctx: { grid_width: 15 } } }, 2)
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeNull()
    // convergence, not merely survival: one roster reaches the door, and it is the composed book
    expect(publishes).toHaveLength(1)
    expect(
      store
        .getState()
        .ctx.roster.map((row) => row.id)
        .sort()
    ).toEqual([ALICE, BOB].sort())
  })

  test('a content-equal roster re-arriving through the door is not republished', () => {
    const { store, ensure_roster, publishes } = mount()
    store.subscribe(ensure_roster)

    ensure_roster()
    expect(publishes).toHaveLength(1)

    // The same content with a FRESH array identity — what any recomposition of the roster produces. An arrival
    // is not a delta: nothing changed, so nothing may be published back.
    store.getState().input({ type: 'ctx', ctx: { roster: [...store.getState().ctx.roster] } }, 3)
    expect(publishes).toHaveLength(1)
  })
})
