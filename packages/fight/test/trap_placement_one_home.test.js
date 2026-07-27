// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// trap_placement_one_home.test.js — #1248: ONE answer to "was a trap armed on this anchor when that row ran?"
//
// #1219's sequencing rule shipped TWICE, forty minutes apart, and the copies disagreed on the exact case the
// rule exists for. The fold took the LAST `Cast` on an anchor as the placement and compared inclusively; the
// renderer took the FIRST and compared strictly. Two casts on one anchor with a walk between them therefore
// split the twins: the renderer called the walk "after the trap" and flashed a detonation, the fold called it
// "before" and kept the trap armed — the #1219 phantom, reachable again through a tie-break only one of them
// had.
//
// THE RULE, derived from the chain rather than from either copy. `cast.move:1534` (`ECellAlreadyTrapped`, the
// 1.29 no-stack ban) guarantees at most ONE live trap per anchor at any instant, so along an ordered row stream
// an anchor strictly alternates: Cast (arm) → entry (detonate + consume) → Cast (re-arm) → … Both consumers ask
// the SAME question of that stream — "was a trap armed here when this row ran?" — and its answer is "some Cast
// on this anchor precedes this row", never "the first one" nor "the last one overall". Taking the last overall
// is what let a placement made AFTER a crossing retroactively protect the trap that crossing had consumed.
//
// Positions are ordinals in the consumer's own ordered stream (the receipt's decoded rows for the renderer, the
// `(version, event_idx)`-sorted authoritative tail for the fold), so the boundary is one shared `<` instead of a
// `<` on one side and a `>=` on the other.

import { describe, expect, test } from 'bun:test'

import { create_fight_store } from '../src/store.js'
import { engine_view } from '../src/project.js'
import { produce_receipt_render_turns } from '../src/fight_render_events.js'
import { armed_at, placements_by_anchor } from '../src/fight_render_prims.js'

const FIGHT = '0xf1'
const CHAR = '0xc1'
const W = 20
const enc = (x, y) => y * W + x
const START = enc(5, 5)
const X = enc(8, 5) // the contested anchor: cast, crossed, cast again — all in ONE receipt
const PAST_X = enc(10, 5)
const MOB = enc(14, 9)

const ev = (kind, fields) => ({ type: `0x0::fight_events::${kind}`, parsedJson: { fight: FIGHT, ...fields } })
const cast_x = () => ev('Cast', { caster_is_mob: false, caster_idx: 0, target_cell: X })
const walk_past_x = () => ev('Moved', { character: CHAR, to_cell: PAST_X })

const FIGHT_OBJECT = {
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
      ap: 9,
      mp: 6,
      base_ap: 9,
      base_mp: 6,
      hp: 50,
      max_hp: 50,
      cell: START,
    },
  ],
  mobs: [{ template: '0xabc', hp: 200, max_hp: 200, cell: MOB, ap: 4, mp: 4, level: 1 }],
  queue: [{ is_mob: false, idx: 0 }],
  turn_ptr: 0,
  turn_deadline_ms: 90_000,
  turn_entropy: 90_000,
  turn_ordinal: 1,
}

/** THE FOLD's answer: did the trap on X retire? (retired ⇒ it was armed when the walk crossed) */
const fold_says_armed = (rows) => {
  const store = create_fight_store()
  store
    .getState()
    .input({ type: 'init', fight_id: FIGHT, my_key: 'p0', ctx: { my_entity_id: CHAR, beat_ctx: { grid_width: W } } })
  store.getState().input({ type: 'snapshot', fight: FIGHT_OBJECT, version: 5 }, 1_000)
  store.getState().input(
    {
      type: 'predicted',
      basis_version: 6,
      intent_id: 'trap1',
      actions: [{ kind: 'Cast', caster_is_mob: false, caster_idx: 0, target_cell: X, ap_cost: 2 }],
      beats: [{ kind: 'cast', at: 0, duration: 100, payload: {} }],
      place_traps: [X],
    },
    1_100
  )
  store.getState().input({ type: 'receipt', version: 7, receipt: { events: rows } }, 1_200)
  for (const beat of store.getState().wave) store.getState().input({ type: 'presented', seq: beat.seq }, 1_300)
  return !engine_view(store.getState()).my_traps.includes(X)
}

/** THE RENDERER's answer: did the walk split and flash a detonation at X? */
const renderer_says_armed = (rows) =>
  produce_receipt_render_turns(rows, {
    fight_id: FIGHT,
    trap_cells: new Set([X]),
    resolve_fighter_id: ({ character, is_mob, idx }) => character ?? (is_mob ? `m${idx}` : CHAR),
    fighter_cells: new Map([[CHAR, { x: 5, y: 5 }]]),
  }).turns.some((turn) => turn.events.some((beat) => beat.kind === 'trap_trigger'))

describe('#1248 — the fold and the renderer answer "was it armed?" the same way', () => {
  // THE DIVERGENCE, exactly as filed: cast on X, walk over X, cast on X again — all in one receipt (legal only
  // because the walk detonated the first trap, which is precisely why the walk must count as a detonation).
  test('double cast on one anchor with a walk between: both twins agree', () => {
    const rows = [cast_x(), walk_past_x(), cast_x()]
    expect(fold_says_armed(rows)).toBe(renderer_says_armed(rows))
  })

  test('…and they agree it WAS armed — the walk consumed the first trap', () => {
    const rows = [cast_x(), walk_past_x(), cast_x()]
    expect(renderer_says_armed(rows)).toBe(true)
    expect(fold_says_armed(rows)).toBe(true)
  })

  // The #1219 shape must keep answering NO on both sides: nothing was armed when that walk ran.
  test('walk THEN cast: both twins agree nothing was armed', () => {
    const rows = [walk_past_x(), cast_x()]
    expect(fold_says_armed(rows)).toBe(renderer_says_armed(rows))
    expect(renderer_says_armed(rows)).toBe(false)
  })

  test('cast THEN walk: both twins agree it was armed', () => {
    const rows = [cast_x(), walk_past_x()]
    expect(fold_says_armed(rows)).toBe(renderer_says_armed(rows))
    expect(renderer_says_armed(rows)).toBe(true)
  })
})

// The shared home itself, at its two boundaries. Callers differ only in how they ordinal their own stream.
describe('#1248 — the placement selector', () => {
  const stream = [{ anchor: 7 }, { anchor: null }, { anchor: 7 }, { anchor: 9 }]
  const placements = placements_by_anchor(stream, (row) => row.anchor)

  test('a row is armed by ANY placement strictly before it, never only the first or only the last', () => {
    expect(armed_at(placements, 7, 0)).toBe(false) // nothing precedes position 0
    expect(armed_at(placements, 7, 1)).toBe(true) // the cast at 0 precedes it
    expect(armed_at(placements, 7, 3)).toBe(true) // casts at 0 AND 2 precede it — the last-overall trap of #1248
  })

  test('the boundary is strict: a row is never armed by a placement at its own position', () => {
    expect(armed_at(placements, 9, 3)).toBe(false)
    expect(armed_at(placements, 9, 4)).toBe(true)
  })

  test('an anchor with no placement in the window predates it — armed, the permissive default both homes had', () => {
    expect(armed_at(placements, 42, 0)).toBe(true)
  })
})

// AN AoE TRAP carries its whole zone in `cells`, but only its ANCHOR was ever a cast target. If every zone cell
// got a vote, the cells with no placement would each return the permissive default and the sequencing rule would
// be defeated for every AoE trap — #1219, back again, for exactly the shape #1047 reports.
describe('#1248 — an AoE trap is sequenced by its ANCHOR, not by its zone', () => {
  const ZONE = [X, enc(8, 4), enc(8, 6), enc(7, 5), enc(9, 5)]

  const fold_zone_armed = (rows) => {
    const store = create_fight_store()
    store
      .getState()
      .input({ type: 'init', fight_id: FIGHT, my_key: 'p0', ctx: { my_entity_id: CHAR, beat_ctx: { grid_width: W } } })
    store.getState().input({ type: 'snapshot', fight: FIGHT_OBJECT, version: 5 }, 1_000)
    store.getState().input(
      {
        type: 'predicted',
        basis_version: 6,
        intent_id: 'aoe1',
        actions: [{ kind: 'Cast', caster_is_mob: false, caster_idx: 0, target_cell: X, ap_cost: 2 }],
        beats: [{ kind: 'cast', at: 0, duration: 100, payload: {} }],
        place_traps: ZONE,
      },
      1_100
    )
    store.getState().input({ type: 'receipt', version: 7, receipt: { events: rows } }, 1_200)
    for (const beat of store.getState().wave) store.getState().input({ type: 'presented', seq: beat.seq }, 1_300)
    return !engine_view(store.getState()).my_traps.includes(X)
  }

  test('a walk BEFORE the anchor cast leaves the whole zone armed', () => {
    expect(fold_zone_armed([walk_past_x(), cast_x()])).toBe(false)
  })

  test('a walk AFTER the anchor cast still retires it', () => {
    expect(fold_zone_armed([cast_x(), walk_past_x()])).toBe(true)
  })
})
