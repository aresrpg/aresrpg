// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Issue #1172 RED-FIRST — AN AoE SELF-BUFF NEVER LANDED A BADGE.
//
// `inputs.self_status_from_effect` proved a receipt row's recipient with a POINT test: `area_shape == 0 &&
// area_size == 0 && target_cell == caster.cell`. The chain proves it with a ZONE test —
// `combat_grid::zone_cells(shape, size, target_cell, caster_cell)` then `zone.contains(caster_cell)`
// (cast.move:987/1002). A POINT zone is the ONE-CELL CASE of that enumeration, so the old test was the
// general rule written as a special case, and every AoE self-buff fell outside it: `senshi_oathblade`'s
// `+1 Raw Damage · 3 turns · CROSS` painted optimistically at cast time and VANISHED the moment the receipt
// retired the prediction — the seat's `statuses` folded EMPTY.
//
// The wire shape below is the same captured envelope `receipt_signed_ingress.test.js` pins (u64s as decimal
// strings, bools as bools — capsule `0xd8307732…5f62-1784655007603.capsule.json`), with the effect row's
// `area_shape`/`area_size` set to the AoE the corpus actually authors. `+1 Raw Damage` rides CENTERED
// (`32768 + 1` — K_ALTER_STAT is a signed kind), so the decode-once law (#983) is exercised on this door too.

import { describe, expect, test } from 'bun:test'

import * as SE from '../../sim/src/spell_effect.js'
import { encode } from '../src/los.js'
import { engine_view } from '../src/project.js'
import { committed_truth, create_fight_store } from '../src/store.js'

const FIGHT = '0xf1172'
const CHAR = '0xc1172'
const CASTER = encode(5, 5)
const PKG = '0xpkg::fight_events::'

/** One minted chain `Effect` — the AoE self-buff under test: `+1 Raw Damage · 3 turns`, CROSS radius 1. */
const effect = (over = {}) => ({
  area_shape: SE.SHAPE_CROSS,
  area_size: '1',
  chance: 100,
  element: 255,
  flags: 0,
  kind: SE.K_ALTER_STAT,
  phase: SE.PHASE_ON_ENTER,
  stat: SE.STAT_RAW_DAMAGE,
  target_filter: SE.TF_NONE, // hits everyone in the zone, the caster included
  turns: 3,
  value: '32769', // authored +1, CENTERED — what the chain actually puts on the wire
  ...over,
})

/** The captured action envelope bracketing one cast, aimed at `target_cell`. */
const rows = (row, target_cell) => [
  {
    kind: 'ActionStarted',
    data: {
      action_kind: 0,
      action_ordinal: '0',
      ap_cost: '3',
      caster_idx: '0',
      caster_is_mob: false,
      effect_count: '1',
      fight: FIGHT,
      target_cell: String(target_cell),
      turn_ordinal: '1',
    },
  },
  {
    kind: 'ActionEffect',
    data: {
      action_ordinal: '0',
      caster_idx: '0',
      caster_is_mob: false,
      effect: row,
      effect_ordinal: '0',
      fight: FIGHT,
      turn_ordinal: '1',
    },
  },
  { kind: 'Cast', data: { fight: FIGHT, caster_is_mob: false, caster_idx: 0, target_cell } },
  {
    kind: 'ActionResolved',
    data: {
      action_kind: 0,
      action_ordinal: '0',
      ap_cost: '3',
      caster_idx: '0',
      caster_is_mob: false,
      effects: [row],
      fight: FIGHT,
      fumbled: false,
      returned: false,
      turn_ordinal: '1',
    },
  },
]

const fight_object = {
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
      hp: 50,
      max_hp: 50,
      ap: 6,
      mp: 3,
      base_ap: 6,
      base_mp: 3,
      cell: CASTER,
      base_stats: { raw_damage: 0 },
    },
  ],
  mobs: [],
  queue: [{ is_mob: false, idx: 0 }],
  turn_ptr: 0,
  turn_deadline_ms: 90_000,
  invisibility_statuses: [],
}

/** The production ingress: a real store, the real receipt door. */
const drive = (row, target_cell = CASTER) => {
  const store = create_fight_store()
  store.getState().input({
    type: 'init',
    fight_id: FIGHT,
    my_key: 'p0',
    ctx: { my_entity_id: CHAR, beat_ctx: { grid_width: 20 } },
  })
  store.getState().input({ type: 'snapshot', fight: fight_object, version: 1, journal_head: '0' }, 1_000)
  store.getState().input(
    {
      type: 'receipt',
      fight_id: FIGHT,
      version: 2,
      receipt: { events: rows(row, target_cell).map((e) => ({ type: PKG + e.kind, parsedJson: e.data })) },
    },
    1_100
  )
  return store
}

const folded = (store) => committed_truth(store.getState()).fighters.p0.statuses ?? []
const badges = (store) => engine_view(store.getState()).fighters.get(CHAR).effects

describe('#1172 the receipt door proves the recipient by ZONE, not by point', () => {
  test('RED: a self-cast AoE buff survives its own receipt — the badge is fold truth', () => {
    const store = drive(effect())

    // THE REGRESSION: this array was EMPTY. The cast-time paint was pure prediction and the receipt retired it.
    expect(folded(store)).toHaveLength(1)
    expect(folded(store)[0]).toMatchObject({
      kind: SE.K_ALTER_STAT,
      stat: SE.STAT_RAW_DAMAGE,
      remaining_turns: 3,
      value: 1, // decoded ONCE at the seam — never the wire's 32769
    })
    // …and the badge the HUD renders reads the same row.
    expect(badges(store)[0]).toMatchObject({ kind: SE.K_ALTER_STAT, stat: SE.STAT_RAW_DAMAGE, value: 1 })
  })

  test('RED: an AoE aimed at a NEIGHBOUR still lands on the caster when the zone covers his cell', () => {
    // CIRCLE radius 2 anchored one cell away: manhattan(caster, anchor) = 1 <= 2, so `zone_cells` contains the
    // caster exactly as `combat_grid::in_zone` says it does — the chain applied the row; the client must fold it.
    const store = drive(effect({ area_shape: SE.SHAPE_CIRCLE, area_size: '2' }), encode(6, 5))
    expect(folded(store)).toHaveLength(1)
    expect(folded(store)[0]).toMatchObject({ kind: SE.K_ALTER_STAT, value: 1, remaining_turns: 3 })
  })

  test('a zone that does NOT cover the caster folds nothing — the proof still refuses to guess', () => {
    // CIRCLE radius 1 anchored five cells away: the caster is outside it, so the receipt proves nothing about
    // him and the snapshot stays the truth for that row.
    expect(folded(drive(effect({ area_shape: SE.SHAPE_CIRCLE, area_size: '1' }), encode(10, 5)))).toHaveLength(0)
  })

  test('an AoE that EXCLUDES the caster folds nothing — the target filter still gates the proof', () => {
    // TF_NOT_SELF: the chain's `effect_hits(tf, is_caster = true, …)` refuses, so there is no row to restate.
    expect(folded(drive(effect({ target_filter: SE.TF_NOT_SELF })))).toHaveLength(0)
  })

  test('a chance-gated AoE folds nothing — the envelope cannot prove a contested application', () => {
    expect(folded(drive(effect({ chance: 50 })))).toHaveLength(0)
  })
})
