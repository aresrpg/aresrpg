// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// test_helpers/fight_core_harness.js — the TEST seeding door for the fight core singleton (S2 mirror kill). The old HUD
// tests drove `state.fight` through the mirror's projection dispatch with slice-shaped literals; the mirror is
// dead, so a test now drives the REAL core through its ONE input door (init → snapshot [→ receipt/intent]) and
// components read the projected view exactly as production does. This module is imported by TESTS ONLY — it
// carries no test-framework imports and nothing in the app bundle references it (kept out of *.test.* naming so
// bun never counts it as an empty suite; lives OUTSIDE src/fight/ so the CodeQL hermetic-core effect rule and
// gate a never scan test choreography as reducer core). Everything flows through `input()` — the one-reducer law holds even
// in the harness (no setState back door).

import { fight_store } from '@aresrpg/fight/store'

/** One chain-shaped participant row for `seats[i]` (character id + per-seat overrides). */
const participant = ({ character, owner = '0xaaa', team = 0, ap = 6, mp = 3, hp = 50, cell = 100, ...rest }) => ({
  owner,
  character,
  class: 'senshi',
  team,
  ap,
  mp,
  base_ap: rest.base_ap ?? ap,
  base_mp: rest.base_mp ?? mp,
  hp,
  max_hp: rest.max_hp ?? Math.max(hp, 50),
  cell,
  ready: rest.ready ?? false,
  ...rest,
})

/**
 * Seed the app-wide fight core to a live fight via init + snapshot. Returns the store for chained inputs.
 * `active` names the entity whose turn it is ('mob-N' or a seat's character id); `placement` seeds engine
 * status 0 (the placement window). Every field is a plain override — the defaults are one seated player vs one
 * mob on a 20×19 board, my turn, deadline far out.
 *
 * @param {{
 *   fight_id?: string, my?: string | null, seats?: Array<Record<string, any>>,
 *   mobs?: Array<Record<string, any>>, active?: string | null, placement?: boolean,
 *   turn_deadline_ms?: number, placement_deadline_ms?: number, version?: number, status?: number,
 * }} [opts]
 */
export function seed_fight_core({
  fight_id = '0xf1',
  my = '0xme',
  seats = [{ character: my }],
  mobs = [{ template: '0xabc', hp: 30, max_hp: 30, cell: 105, ap: 4, mp: 3, level: 1 }],
  active = my,
  placement = false,
  turn_deadline_ms = Date.now() + 90_000,
  placement_deadline_ms = 0,
  version = 1,
  status = placement ? 0 : 1,
} = {}) {
  const store = fight_store
  const my_seat = seats.findIndex((s) => s.character === my)
  store.getState().input({
    type: 'init',
    fight_id,
    my_key: my_seat >= 0 ? `p${my_seat}` : null,
    ctx: { my_entity_id: my, beat_ctx: { grid_width: 20 } },
  })
  // the turn queue interleaves seats then mobs; turn_ptr points at `active`.
  const queue = [...seats.map((_, idx) => ({ is_mob: false, idx })), ...mobs.map((_, idx) => ({ is_mob: true, idx }))]
  const active_ptr = Math.max(
    0,
    queue.findIndex((a) => (a.is_mob ? `mob-${a.idx}` === active : (seats[a.idx]?.character ?? null) === active))
  )
  store.getState().input({
    type: 'snapshot',
    version,
    fight: {
      id: fight_id,
      status,
      width: 20,
      height: 19,
      participants: seats.map((seat, i) => participant({ cell: 100 + i, ...seat })),
      mobs,
      queue,
      turn_ptr: active_ptr,
      turn_deadline_ms,
      placement_deadline_ms,
      start_cells_a: placement ? [100, 101, 102] : [],
      start_cells_b: [],
    },
  })
  return store
}

/** Tear the seeded fight down (null fight — the between-fights state other test files expect). */
export function reset_fight_core() {
  fight_store.getState().input({ type: 'init', fight_id: null })
}
