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
// Only `dungeon_store.js` is mocked (its module graph reaches browser-bound auth in this no-jsdom harness), and
// only to pin the stale mirror. The canonical doors are the REAL ones — a mock of `game/store.js` would leak
// across the shared test process and truncate its export surface for every file loaded after this one.
import { afterAll, expect, mock, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { board_view, DUNGEON_BOARD_ORIGIN, fight_visible_view } from '@aresrpg/fight/project'
import { fight_store } from '@aresrpg/fight/store'

import { reset_fight_core, seed_fight_core } from '../../../../../src/test_helpers/fight_core_harness.js'

const FIGHT = '0xf1'
const ME = '0xme'

// ① the board BEFORE my join landed — one other seat, no row for me. This is what the mirror still holds.
seed_fight_core({ fight_id: FIGHT, my: ME, seats: [{ character: '0xother' }], placement: true })
const STALE_MIRROR = board_view(fight_store.getState())

// ② the core moves on: the placement board now seats me. The mirror is deliberately NOT re-published — the skew
//    window this test is about. (`STALE_MIRROR.id === FIGHT`, so the machine still pairs the two surfaces.)
seed_fight_core({ fight_id: FIGHT, my: ME, seats: [{ character: ME }], placement: true })

// The façade's FULL export surface (`use_dungeon` + `DUNGEON_BOARD_ORIGIN`) — a module mock is global to the
// shared bun process, so a partial one would break every file loaded after this one.
mock.module('../../../../../src/world-shell/dungeon_store.js', () => ({
  use_dungeon: (selector = (s) => s) => selector({ dungeon: STALE_MIRROR }),
  DUNGEON_BOARD_ORIGIN,
}))

const { useFightPhase } = await import('../../../../../src/game/screens/hud/world/use_fight_phase.js')

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

afterAll(() => reset_fight_core())

test('my seat answers from the identity book, not from a mirror the core has outrun', () => {
  expect(STALE_MIRROR.escrow.some((row) => (row.character ?? row.character_id) === ME)).toBe(false)
  expect(fight_visible_view(fight_store.getState()).mount.viewer.my_entity_id).toBe(ME)

  const result = phase_of()
  expect(result.unmet).not.toContain('no_my_seat')
  expect(result.phase).toBe('PLACEMENT')
})
