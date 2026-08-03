// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #1993 (projection-boundary carve-out) — MY SEAT HAS ONE HOME.
//
// `useFightPhase` used to re-resolve identity itself: it scanned `use_dungeon`'s `dungeon.escrow` for the row
// whose character matched my entity id — the roster identity book's own rule (#1993 WP3), spelled a second time
// at a consumer. That `dungeon` is not an independent transport: it has exactly ONE non-null writer,
// `fight_store.subscribe((s) => use_dungeon.setState({ dungeon: board_view(s) }))` (dungeon_run_store.js), so the
// scan reached the fight store's own `view.escrow` through a store-to-store MIRROR — while the very next line of
// the hook took the fight slice synchronously "so the phase machine never lags a dispatch".
//
// THE DEFECT THAT BUYS: whenever the mirror holds a state the core has already moved past, the second home
// answers "no seat" for a seat the core can see. The machine then reports `no_my_seat` and HOLDS at ROAM — the
// half-init hold with no board, for a placement window that is fully seeded. Same shape at TERMINAL, where the
// unmet name is `not_escrowed` and the cost is the result card (the W2 "+XP shows, card doesn't" class).
//
// RED-FOR-THE-RIGHT-REASON: this drives exactly that skew — the core seated in PLACEMENT, the mirror one board
// behind (an escrow that does not contain me yet, as it is between a join landing and the mirror's write) — and
// asserts the machine still sees my seat. Against the escrow scan it fails with phase ROAM / unmet no_my_seat.
//
// THE REAL STORES, reached through the harness's two standing seams. The browser-shaped host surface is what the
// world-shell graph needs at module load. The `use_dungeon` mock is the sibling suites' `static_hook` idiom and
// exists for one reason: under `renderToStaticMarkup` zustand v5's own hook serves `getInitialState`, so a
// component would read an EMPTY dungeon whatever the store holds. It keeps the store object itself — every other
// export, `setState`/`getState`/`subscribe` included — and only makes the hook call read LIVE state, because
// `mock.module` is global to the shared bun process and a narrower stub follows every file loaded after this one
// (measured: a partial stub stripped `setState` from under the mirror subscriber and reddened four suites).
import { afterAll, expect, mock, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { board_view, fight_visible_view } from '@aresrpg/fight/project'
import { fight_store } from '@aresrpg/fight/store'

import { install_browser_globals } from '../../../../../src/test_helpers/browser_globals.js'

const restore_globals = install_browser_globals()

const { seed_fight_core, reset_fight_core } = await import('../../../../../src/test_helpers/fight_core_harness.js')
const real_dungeon_store = await import('../../../../../src/world-shell/dungeon_store.js')
const { use_dungeon } = real_dungeon_store

mock.module('../../../../../src/world-shell/dungeon_store.js', () => ({
  ...real_dungeon_store,
  use_dungeon: Object.assign((selector = (s) => s) => selector(use_dungeon.getState()), use_dungeon),
}))

const { useFightPhase } = await import('../../../../../src/game/screens/hud/world/use_fight_phase.js')

const FIGHT = '0xf1'
const ME = '0xme'

/** Render the hook and hand back its verdict — the phase machine reached exactly as a mounted surface reaches it. */
function phase_of() {
  let seen = null
  function Probe() {
    seen = useFightPhase()
    return null
  }
  renderToStaticMarkup(<Probe />)
  return seen
}

afterAll(() => {
  reset_fight_core()
  restore_globals()
})

test('my seat answers from the identity book, not from a mirror the core has outrun', () => {
  // the board BEFORE my join landed — one other seat, no row for me. This is what the mirror still holds.
  seed_fight_core({ fight_id: FIGHT, my: ME, seats: [{ character: '0xother' }], placement: true })
  const stale_mirror = board_view(fight_store.getState())
  expect(stale_mirror.escrow.some((row) => (row.character ?? row.character_id) === ME)).toBe(false)

  // the core moves on: the placement board now seats me. The mirror is then pinned BACK to the pre-join board —
  // the skew window this test is about, and the last write, so no later publish overwrites it.
  // (`stale_mirror.id === FIGHT`, so the phase machine still pairs the two surfaces.)
  seed_fight_core({ fight_id: FIGHT, my: ME, seats: [{ character: ME }], placement: true })
  use_dungeon.setState({ dungeon: stale_mirror })
  expect(fight_visible_view(fight_store.getState()).mount.viewer.my_entity_id).toBe(ME)

  const result = phase_of()
  expect(result.unmet).not.toContain('no_my_seat')
  expect(result.phase).toBe('PLACEMENT')
})
