// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// PUSH/DISPLACEMENT-AS-BEAT (live-QA 2026-07-17): a pushed mob could land correctly on-chain while the
// client rendering desynced — during its turn it walked back by teleporting first onto the cell where
// it should have been pushed. SPEC §7b grammar: "Push / displacement: caster's swing → VFX → the slide (per
// cell, cardinal) → collision / trap impact → floater" and "Move: ONE walk, path-true … never teleport-then-walk".
//
// MECHANISM (proven by this file's red): the receipt's wave kept ONLY non-local turns, so the victims'
// `displacement` beats living inside MY OWN (local, prediction-painted) turn were dropped outright — the
// `Displaced` entry folded instantly (insta-jump, no slide), and the victim mob's NEXT walk was pathed from
// the PRE-push draft cell (stale origin → the teleport-then-walk class the §7b evaluator flags).
//
// THE CONTRACT (mirrors despawn_pacing.test.js): the core stays truthful (the fold adopts the pushed cell the
// instant the receipt lands); the PRESENTED projection holds each victim at the pre-push cell until its
// displacement beat presents (the leg is a windowed LOCAL wave turn — is_local, so it NEVER gates input),
// and the mob's next walk beat originates from the receipt's own settled (pushed) cell.

import { describe, expect, test } from 'bun:test'
import { DISPLACEMENT_CELL_MS } from '@aresrpg/fight/fight_render_events'
import { create_fight_store, presented_state, WAVE_ACK_GRACE_MS } from '@aresrpg/fight/store'
import { presenting } from '@aresrpg/fight/project'

import { board_fight_authority } from './voxel_fight_folds.js'

const FIGHT = '0xf1'
const CHAR = '0xc1'
const MOB_CELL = 105 // (5,5)
const PUSHED_CELL = 107 // (7,5) — pushed 2 east
const WALKED_CELL = 67 // (7,3) — the mob's own walk after the push: 2 cells north of the PUSHED cell

const event = (kind, fields) => ({ type: `0x0::fight_events::${kind}`, parsedJson: { fight: FIGHT, ...fields } })

const FIGHT_OBJECT = {
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
      ap: 6,
      mp: 3,
      base_ap: 6,
      base_mp: 3,
      hp: 50,
      max_hp: 50,
      cell: 100,
    },
  ],
  mobs: [{ template: '0xabc', hp: 30, max_hp: 30, cell: MOB_CELL, ap: 4, mp: 3, level: 1 }],
  queue: [
    { is_mob: false, idx: 0 },
    { is_mob: true, idx: 0 },
  ],
  turn_ptr: 0,
  turn_deadline_ms: 90_000,
}

const boot = () => {
  const store = create_fight_store()
  store.getState().input({
    type: 'init',
    fight_id: FIGHT,
    my_key: 'p0',
    ctx: { my_entity_id: CHAR, beat_ctx: { grid_width: 20 } },
  })
  store.getState().input({ type: 'snapshot', fight: FIGHT_OBJECT, version: 5 }, 1_000)
  return store
}

/** MY commit's receipt, chain emitter order (effects BEFORE their Cast): my push slides the mob 105→107,
 *  then the mob's own turn walks it 107→67 — the walk that teleports back to the pushed cell. */
const PUSH_CASCADE = [
  event('Displaced', {
    target_is_mob: true,
    target_idx: 0,
    kind: 12,
    from_cell: MOB_CELL,
    to_cell: PUSHED_CELL,
    requested: 2,
    blocked: 0,
  }),
  event('Cast', { caster_is_mob: false, caster_idx: 0, target_cell: MOB_CELL }),
  event('TurnEnded', { is_mob: false, idx: 0 }),
  event('TurnStarted', { is_mob: true, idx: 0, deadline_ms: 95_000 }),
  event('MobMoved', { idx: 0, to_cell: WALKED_CELL }),
  event('TurnEnded', { is_mob: true, idx: 0 }),
  event('TurnStarted', { is_mob: false, idx: 0, deadline_ms: 99_000 }),
]

const receive = (store, events, now = 2_000) =>
  store.getState().input({ type: 'receipt', receipt: { events }, version: 6 }, now)

describe('push/displacement-as-beat pacing (§7b: the slide presents, never an insta-jump)', () => {
  test('MY push receipt yields a LOCAL displacement leg holding the victim at the pre-push cell until it presents', () => {
    const store = boot()
    receive(store, PUSH_CASCADE)
    // the leg: my own turn's victims' slide, as its own local wave turn at NATURAL per-cell pace.
    const leg = store.getState().wave.find((t) => t.is_local)
    expect(leg, 'my push receipt must append a LOCAL displacement-leg wave turn').toBeTruthy()
    const slide = leg.beats.find((b) => b.kind === 'displacement')
    expect(slide, 'the leg carries the victim slide beat').toBeTruthy()
    expect(slide.payload.target_id).toBe('mob-0')
    expect(slide.payload.from).toEqual({ x: 5, y: 5 })
    expect(slide.payload.to).toEqual({ x: 7, y: 5 })
    expect(slide.duration, 'the slide plays at natural per-cell pace (E7 authored constant)').toBe(
      2 * DISPLACEMENT_CELL_MS
    )
    expect(leg.from_idx, 'the leg windows its Displaced entry for the presented mask').toBe(0)
    // CORE TRUTH IS NEVER DELAYED: the fold adopted the pushed (then walked) cell at the receipt.
    expect(store.getState().fighters.m0.cell).toBe(WALKED_CELL)
    // THE HOLD: while the slide is unpresented, the projection keeps the victim at the PRE-push cell.
    expect(presented_state(store.getState()).fighters.m0.cell).toBe(MOB_CELL)
    expect(board_fight_authority({ core: store.getState(), roster: [] }).fighters.get('mob-0').cell).toEqual({
      x: 5,
      y: 5,
    })
    // THE REVEAL: the leg's ack presents the pushed cell — the mob's own (still-masked) walk not yet.
    store.getState().input({ type: 'presented', seq: leg.seq }, 3_000)
    expect(presented_state(store.getState()).fighters.m0.cell).toBe(PUSHED_CELL)
    const mob_turn = store.getState().wave.find((t) => t.source_id === 'mob-0')
    store.getState().input({ type: 'presented', seq: mob_turn.seq }, 6_000)
    expect(presented_state(store.getState()).fighters.m0.cell).toBe(WALKED_CELL)
  })

  test("the pushed mob's next walk beat originates from the receipt's own PUSHED cell — never the stale draft", () => {
    const store = boot()
    receive(store, PUSH_CASCADE)
    const mob_turn = store.getState().wave.find((t) => t.source_id === 'mob-0')
    const walk = mob_turn.beats.find((b) => b.kind === 'move')
    // §7b Move grammar: path-true from the presented (pushed) cell (7,5) → (7,3): exactly two north steps.
    // The red is today's stale-origin path from the PRE-push (5,5): 4 cells starting (6,5) — the rig then
    // teleports to reconcile, the exact "teleport-then-walk" class this test pins.
    expect(walk.payload.path).toEqual([
      { x: 7, y: 4 },
      { x: 7, y: 3 },
    ])
  })

  test('a player-victim leg (my own cast displaces ME) presents the same way and NEVER gates input', () => {
    const store = boot()
    receive(store, [
      event('Displaced', {
        target_is_mob: false,
        target_idx: 0,
        kind: 12,
        from_cell: 100,
        to_cell: 98,
        requested: 2,
        blocked: 0,
      }),
      event('Cast', { caster_is_mob: false, caster_idx: 0, target_cell: 98 }),
    ])
    const leg = store.getState().wave.find((t) => t.is_local)
    expect(leg, 'a self/player-victim push yields the same local leg').toBeTruthy()
    expect(leg.beats.find((b) => b.kind === 'displacement').payload.target_id).toBe(CHAR)
    // the input law (ONE 3s floor per turn, per-cast re-arm banned): MY OWN leg never reads as
    // `presenting` — the playable clock and the armed spell survive the slide untouched.
    expect(presenting(store.getState())).toBe(false)
    expect(store.getState().turn_started_at, 'the turn floor anchor must not re-stamp over my own leg').toBe(1_000)
    expect(presented_state(store.getState()).fighters.p0.cell).toBe(100)
    store.getState().input({ type: 'presented', seq: leg.seq }, 3_000)
    expect(presented_state(store.getState()).fighters.p0.cell).toBe(98)
  })

  test('a wedged leg is force-acked by the tick watchdog — the pre-push hold is always bounded', () => {
    const store = boot()
    receive(store, PUSH_CASCADE)
    const leg = store.getState().wave.find((t) => t.is_local)
    store.getState().input({ type: 'tick' }, 10_000) // first tick stamps the wave_head clock on the leg head
    store.getState().input({ type: 'tick' }, 10_000 + (leg.duration || 0) + WAVE_ACK_GRACE_MS + 1)
    expect(
      store.getState().wave.some((t) => t.seq === leg.seq),
      'the watchdog must cap a wedged displacement leg'
    ).toBe(false)
    expect(presented_state(store.getState()).fighters.m0.cell).toBe(PUSHED_CELL)
  })
})
