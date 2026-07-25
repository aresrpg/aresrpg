// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// LEG C — EFFECT CONTINUITY ACROSS ADOPTION (still due): ① invisibility FLICKERS visible→invisible
// at turn boundaries; ② a 3-turn +1 MP buff applied turn 1 goes missing turn 2, back turn 3. The shipped
// replay-deferral (a wholesale adopt waits behind a draining foreign wave) + the committed floor should hold both
// continuously. These reds lock: an effect FLAG (invisibility) and a buffed pool (MP) survive ≥2 adoption cycles,
// and a mid-wave TORN read that drops the effect is DEFERRED behind the wave rather than flickering it away.

import { describe, expect, test } from 'bun:test'

import { create_fight_store } from '../src/store.js'
import { engine_view } from '../src/project.js'

const FIGHT = '0xf1'
const P0 = '0xc0' // ME
const P1 = '0xc1' // a peer (coop) — its turn drives the foreign replay wave / deferral
const W = 20
const enc = (x, y) => y * W + x

const participant = (owner, character, cell, mp) => ({
  owner,
  character,
  class: 'senshi',
  team: 0,
  ap: 6,
  mp,
  base_ap: 6,
  base_mp: 3,
  hp: 50,
  max_hp: 50,
  cell,
})

// invisibility_statuses raw shape: { fighter: seat, kind, remaining_turns } — status_snapshot_entities maps it
// (kind 27 = invisibility; the generic status channel now carries every kind, fold derives `invisible` from it).
const fight_at = (p0_cell, p0_mp, invisible, p1_cell = enc(3, 2)) => ({
  id: FIGHT,
  status: 1,
  width: W,
  height: 19,
  participants: [participant('0xa0', P0, p0_cell, p0_mp), participant('0xa1', P1, p1_cell, 3)],
  mobs: [{ template: '0xabc', hp: 30, max_hp: 30, cell: enc(9, 9), ap: 4, mp: 3, level: 1 }],
  queue: [
    { is_mob: false, idx: 0 },
    { is_mob: false, idx: 1 },
  ],
  turn_ptr: 0,
  turn_deadline_ms: 90_000,
  invisibility_statuses: invisible ? [{ fighter: 0, kind: 27, remaining_turns: 3 }] : [],
})

const boot = () => {
  const store = create_fight_store()
  store
    .getState()
    .input({ type: 'init', fight_id: FIGHT, my_key: 'p0', ctx: { my_entity_id: P0, beat_ctx: { grid_width: W } } })
  store.getState().input({ type: 'snapshot', fight: fight_at(enc(2, 2), 4, true), version: 5 }, 1_000)
  return store
}

const me = (store) => engine_view(store.getState()).fighters.get(P0)

describe('LEG C — invisibility + MP buff hold continuously across adoption cycles', () => {
  test('① invisibility holds across two clean adoption cycles (no visible flicker)', () => {
    const store = boot()
    expect(me(store).invisible, 'invisible at cycle 0').toBe(true)
    store.getState().input({ type: 'snapshot', fight: fight_at(enc(2, 2), 4, true), version: 6 }, 2_000)
    expect(me(store).invisible, 'still invisible after cycle 1').toBe(true)
    store.getState().input({ type: 'snapshot', fight: fight_at(enc(2, 2), 4, true), version: 7 }, 3_000)
    expect(me(store).invisible, 'still invisible after cycle 2 — never flickered visible').toBe(true)
  })

  test('② the +1 MP buff (mp 4 over base 3) holds across two adoption cycles', () => {
    const store = boot()
    expect(me(store).mp, 'buffed mp at cycle 0').toBe(4)
    store.getState().input({ type: 'snapshot', fight: fight_at(enc(2, 2), 4, true), version: 6 }, 2_000)
    expect(me(store).mp, 'buff persists cycle 1').toBe(4)
    store.getState().input({ type: 'snapshot', fight: fight_at(enc(2, 2), 4, true), version: 7 }, 3_000)
    expect(me(store).mp, 'buff persists cycle 2').toBe(4)
  })

  // V2 #522 cutover gate 7 — PACING OWNER (beats; §7b conformance is the oracle): the
  // foreign-replay wave + wholesale-adopt deferral is DELETED. A peer turn now arrives as journal
  // events, and a mid-fight object read is an inert checkpoint. Re-enable as a journal/clock
  // projection test at the pacing-owner cutover.
  // #746 adjudication: un-skipped at HEAD, RED for exactly this reason (no foreign replay wave enqueues).
  // Registered on #522 as coverage gate 7 must restore.
  test.skip('the replay-deferral holds the effect while a foreign wave drains (mid-wave torn read deferred)', () => {
    const store = boot()
    // a PEER (P1) turn arrives as a fresher object read → foreign replay wave; the wholesale adopt is DEFERRED.
    // The incoming read also drops MY invisibility (a torn/mid-turn read) — the deferral must not let it flicker me.
    store.getState().input({ type: 'snapshot', fight: fight_at(enc(2, 2), 4, false, enc(7, 4)), version: 6 }, 2_000)
    expect(store.getState().wave.length, 'a foreign replay wave enqueued').toBeGreaterThan(0)
    // DURING the wave the incoming (invisibility-dropped) read is deferred — I stay invisible (committed floor)
    expect(me(store).invisible, 'no flicker while the foreign wave presents').toBe(true)
    // once it drains, the deferred read adopts — the effect reconciles ONCE against chain truth, not a flicker loop
    for (const t of [...store.getState().wave]) store.getState().input({ type: 'presented', seq: t.seq }, 2_500)
    expect(store.getState().view_version, 'the deferred read adopts after the wave').toBe(6)
  })
})
