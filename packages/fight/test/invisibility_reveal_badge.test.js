// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Issue #13 — INVISIBILITY MUST CLEAR ON DIRECT ATTACK, COMPLETELY (flag AND badge), the SAME frame I cast.
//
// The sim already mirrors the chain: `statuses::reveal` strips every invisibility ROW when a cast deals direct
// damage (fight_spells.process_spell_cast), and the client fold mirrors it on a damaging Cast. BUT the fold cleared
// only the derived `invisible` BOOLEAN — it left the kind-27 status ROW on the fighter, so engine_view.effects (the
// nametag/turn-card effect badge) still rendered "invisibility, N turns" on a fighter who is no longer hidden. The
// flag and the badge read the SAME truth (base_from_view derives `invisible` FROM the kind-27 row — one home), so a
// reveal must strip the ROW, not fork a second boolean channel. This locks: an optimistic damaging cast clears BOTH.

import { describe, expect, test } from 'bun:test'

import { create_fight_store } from '../src/store.js'
import { engine_view } from '../src/project.js'
import { read_fighter_statuses, INVISIBILITY_STATUS_KIND } from '../src/fight_status_snapshot.js'

const FIGHT = '0xf1'
const CHAR = '0xc1'
const W = 20
const enc = (x, y) => y * W + x

const invisible_status = read_fighter_statuses({
  fx: { statuses: [{ fighter: 0, kind: INVISIBILITY_STATUS_KIND, remaining_turns: 2, effect: {} }] },
})
const fight = {
  id: FIGHT,
  status: 1,
  width: W,
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
      cell: enc(5, 5),
    },
  ],
  mobs: [{ template: '0xabc', hp: 30, max_hp: 30, cell: enc(8, 8), ap: 4, mp: 3, level: 1 }],
  queue: [
    { is_mob: false, idx: 0 },
    { is_mob: true, idx: 0 },
  ],
  turn_ptr: 0,
  turn_deadline_ms: 90_000,
  turn_entropy: 90_000,
  turn_ordinal: 1,
  invisibility_statuses: invisible_status,
}

const boot = () => {
  const store = create_fight_store()
  store
    .getState()
    .input({ type: 'init', fight_id: FIGHT, my_key: 'p0', ctx: { my_entity_id: CHAR, beat_ctx: { grid_width: W } } })
  store.getState().input({ type: 'snapshot', fight, version: 5 }, 1_000)
  return store
}
const me = (store) => engine_view(store.getState()).fighters.get(CHAR)
const has_invis_badge = (fighter) => fighter.effects.some((e) => e.kind === INVISIBILITY_STATUS_KIND)

describe('#13 — a damaging cast reveals me THIS frame, clearing the flag AND the effect badge', () => {
  test('optimistic damaging cast strips invisibility from engine_view.invisible AND engine_view.effects', () => {
    const store = boot()
    const before = me(store)
    expect(before.invisible, 'I start hidden').toBe(true)
    expect(has_invis_badge(before), 'the invisibility badge shows while hidden').toBe(true)

    // My own damaging cast — optimistic, this frame, no receipt round-trip.
    store
      .getState()
      .input(
        { type: 'intent', intent: { kind: 'cast', target_cell: enc(8, 8), damaging: true }, version: 6, event_idx: 0 },
        1_100
      )

    const after = me(store)
    expect(after.invisible, 'the reveal clears the flag').toBe(false)
    expect(has_invis_badge(after), 'the reveal ALSO strips the kind-27 badge — no lingering "invisible" tag').toBe(
      false
    )
  })

  test('a NON-damaging cast keeps me hidden — flag and badge both stay', () => {
    const store = boot()
    store
      .getState()
      .input(
        { type: 'intent', intent: { kind: 'cast', target_cell: enc(8, 8), damaging: false }, version: 6, event_idx: 0 },
        1_100
      )
    const after = me(store)
    expect(after.invisible, 'a non-damaging cast does not reveal').toBe(true)
    expect(has_invis_badge(after), 'and the badge persists').toBe(true)
  })
})
