// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//
// #1993 WP5 — ONE CAST, ONE LANDING (the #1859 class), red-first.
//
// #1859's symptom is one sentence: a cast's landing is decided TWICE. The log asks a beat-KIND classifier
// (`cast_whiffed` — "is there any resolution-shaped beat behind this cast?"), while the render authorizes its
// impact off the caster cell plus the packet's AIM cell. Neither reads the cast's own resolution, so they can
// disagree with each other and with chain placement — a live session watched a mob cast visibly AT the player
// and read back that nothing was hit.
//
// Both arms below are driven through the REAL producer (`produce_receipt_render_turns`), so the beat ORDER the
// classifier scans is the chain's own, not a hand-arranged list:
//
//   ARM A — a FULLY DODGED drain. The chain's `Drain` row is the authoritative dodge outcome: `removed` is what
//           landed and `requested` is what was attempted. A fully dodged drain lands NOTHING, yet it still emits
//           a `status` beat — and a kind-only classifier cannot see a payload, so the cast reads as resolved: no
//           whiff line, and the full impact package (thwack + shake + flash) fires on a cast that touched no one.
//
//   ARM B — the MOVE's trap damage, attributed to the cast in front of it. A whiffed cast followed by a walk
//           onto a trap puts `move` → `trap_trigger` → `damage` behind the cast beat, in the SAME source turn.
//           The classifier scans forward until the next `cast`, so it claims the walk's detonation as this
//           cast's resolution — the cast that hit nothing reads as a hit.
//
// The law both arms state: a cast's landing is decided by the cast's OWN resolution, once, in one home — and
// that home is the only thing the log line and the impact package are allowed to ask.

import { describe, expect, test } from 'bun:test'
import { produce_receipt_render_turns } from '@aresrpg/fight/fight_render_events'
import { cast_resolution } from '@aresrpg/fight/cast_record'

const GRID_W = 20
const encoded = (x, y) => y * GRID_W + x
const resolve_fighter_id = ({ is_mob, idx, character }) => character ?? `${is_mob ? 'm' : 'p'}${idx}`

/** THE VERDICT UNDER TEST — "did this cast land?", asked of the ONE home that owns the answer. This helper is
 *  all that moved when the beat-kind classifier died: every assertion below is the RED's, verbatim. */
const cast_landed = (specs, index, cell_of) => cast_resolution(specs[index], specs.slice(index + 1), cell_of).landed

/** The one cast beat of a produced source turn, with its index in that turn's ordered spec list. */
const cast_beat_of = (turn) => {
  const specs = turn.events
  const index = specs.findIndex((spec) => spec.kind === 'cast')
  return { specs, index, spec: specs[index] }
}

describe('#1859 — a cast that landed nothing must never read as a hit', () => {
  test('ARM A: a FULLY DODGED drain resolves nothing — the kind-only classifier calls it a landing', () => {
    // p0 casts at (7,8) and drains m1: requested 2, removed 0 — the contest ate the whole thing.
    const raw_events = [
      {
        type: '0xENGINE::fight_events::Drain',
        parsedJson: {
          fight: 'fight-1',
          target_is_mob: true,
          target_idx: '1',
          point_kind: '1',
          requested: '2',
          removed: '0',
        },
      },
      {
        type: '0xENGINE::fight_events::Cast',
        parsedJson: {
          fight: 'fight-1',
          caster_is_mob: false,
          caster_idx: '0',
          character: 'p0',
          target_cell: String(encoded(7, 8)),
        },
      },
    ]

    const receipt = produce_receipt_render_turns(raw_events, { fight_id: 'fight-1', resolve_fighter_id })
    const { specs, index } = cast_beat_of(receipt.turns[0])

    // The drain's own row proves nothing landed — this is the fact the verdict must read.
    const drain = specs.find((spec) => spec.payload?.status === 'DRAIN')
    expect(drain.payload).toMatchObject({ landed: 0, dodged: 2 })

    expect(cast_landed(specs, index)).toBe(false)
  })

  test('ARM B: the WALK that follows a whiffed cast springs a trap — its damage is not the cast’s landing', () => {
    // p0 casts at (7,8) — empty ground, nothing resolves — then walks from (4,8) onto the trap at (6,8).
    const raw_events = [
      {
        type: '0xENGINE::fight_events::Cast',
        parsedJson: {
          fight: 'fight-1',
          caster_is_mob: false,
          caster_idx: '0',
          character: 'p0',
          target_cell: String(encoded(7, 8)),
        },
      },
      {
        type: '0xENGINE::fight_events::Hit',
        parsedJson: {
          fight: 'fight-1',
          victim_is_mob: false,
          victim_idx: '0',
          character: 'p0',
          amount: '7',
          remaining_hp: '93',
        },
      },
      {
        type: '0xENGINE::fight_events::Moved',
        parsedJson: { fight: 'fight-1', character: 'p0', idx: '0', to_cell: String(encoded(6, 8)) },
      },
    ]

    const receipt = produce_receipt_render_turns(raw_events, {
      fight_id: 'fight-1',
      resolve_fighter_id,
      trap_cells: new Set([encoded(6, 8)]),
      fighter_cells: new Map([['p0', { x: 4, y: 8 }]]),
    })
    const { specs, index } = cast_beat_of(receipt.turns[0])

    // The order the classifier scans is the producer's own: the detonation rides BEHIND the walk, not the cast.
    expect(specs.map((spec) => spec.kind)).toEqual(['cast', 'move', 'arrival', 'trap_trigger', 'damage'])

    expect(cast_landed(specs, index)).toBe(false)
  })

  test('CONTROL: an ordinary hit still lands — the split-render victim rides its own damage beat', () => {
    const raw_events = [
      {
        type: '0xENGINE::fight_events::Hit',
        parsedJson: {
          fight: 'fight-1',
          victim_is_mob: true,
          victim_idx: '1',
          amount: '12',
          remaining_hp: '88',
        },
      },
      {
        type: '0xENGINE::fight_events::Cast',
        parsedJson: {
          fight: 'fight-1',
          caster_is_mob: false,
          caster_idx: '0',
          character: 'p0',
          target_cell: String(encoded(10, 8)),
        },
      },
    ]

    const receipt = produce_receipt_render_turns(raw_events, { fight_id: 'fight-1', resolve_fighter_id })
    const { specs, index } = cast_beat_of(receipt.turns[0])

    expect(specs.map((spec) => spec.kind)).toEqual(['cast', 'damage'])
    expect(cast_landed(specs, index)).toBe(true)
  })

  test('THE CELLS: a landing is where the bodies were, never the aim — and never an invented position', () => {
    // p0 aims at (10,8) — empty ground — and the chain resolves the cast on m1, who is standing at (12,8).
    const raw_events = [
      {
        type: '0xENGINE::fight_events::Hit',
        parsedJson: { fight: 'fight-1', victim_is_mob: true, victim_idx: '1', amount: '9', remaining_hp: '41' },
      },
      {
        type: '0xENGINE::fight_events::Cast',
        parsedJson: {
          fight: 'fight-1',
          caster_is_mob: false,
          caster_idx: '0',
          character: 'p0',
          target_cell: String(encoded(10, 8)),
        },
      },
    ]

    const receipt = produce_receipt_render_turns(raw_events, { fight_id: 'fight-1', resolve_fighter_id })
    const { specs, index } = cast_beat_of(receipt.turns[0])
    const projected = new Map([['m1', { x: 12, y: 8 }]])
    const record = cast_resolution(specs[index], specs.slice(index + 1), (id) => projected.get(id) ?? null)

    expect(record).toMatchObject({
      landed: true,
      aim_cell: { x: 10, y: 8 },
      target_ids: ['m1'],
      target_cells: [{ x: 12, y: 8 }],
    })

    // The projection cannot resolve the victim: the record carries the landing and NO cell. A fabricated
    // position — the aim standing in for a body — is the bug this record exists to end.
    const blind = cast_resolution(specs[index], specs.slice(index + 1), () => null)
    expect(blind).toMatchObject({ landed: true, target_ids: ['m1'], target_cells: [] })
  })
})
