// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Issue #983 RED-FIRST — THE RECEIPT INGRESS SPOKE THE OTHER DIALECT.
//
// A world fight rendered `-32767 Range` on the fighter chip for a buff the corpus authors as `+1 Range`, and the
// buffed seat gained no cast range at all. One home (`fighters[key].statuses`), two doors, two dialects:
//   · the SNAPSHOT door (`fight_status_snapshot.read_fighter_statuses`) strips the chain's 32768 centering (#886),
//   · the RECEIPT door (`inputs.self_status_from_effect`) wrote `ActionEffect.effect.value` RAW.
// So an authored `+1` arrived as the wire's `32769`, and any reader that treated the home as signed was 32768 off.
// The fix is the decode-once law applied to the second door — never a per-consumer translation.
//
// CAPTURED WIRE, two provenances, neither one a model twin of the encoder under test:
//  1. THE ENVELOPE SHAPE — `packages/fight/test/fixtures/capsules/0xd8307732a24d031d7ab1b50552c42dea2ad4edc6b7b491
//     887ad10a33e7cb5f62-1784655007603.capsule.json`, a real fight-store capture. Its ActionStarted/ActionEffect
//     rows carry exactly these field names and types (u64s as decimal STRINGS, bools as bools), reproduced below.
//  2. THE SIGNED VALUES — testnet MobTemplate mints read with `sui client object <id> --json` on 2026-07-26 and
//     already pinned by `status_signed_delta.test.js`: Kraken Leviathan `0x89072bd3…af56` authors -7 range →
//     chain `kind 9 · stat 6 · value "32761" · flags 8`. `32768 + delta` is the chain's ONE signed encoding
//     (`participant::alter_delta`, #904), so `+1 range` mints as `32769`.

import { describe, expect, test } from 'bun:test'

import { can_target } from '../../sim/src/spell_targeting.js'
import * as SE from '../../sim/src/spell_effect.js'
import { engine_view } from '../src/project.js'
import { range_bonus_of } from '../src/statuses.js'
import { committed_state, create_fight_store } from '../src/store.js'

const FIGHT = '0xf983'
const CHAR = '0xc983'
const START = 105 // the caster's cell, and the point-cast's own target cell
const PKG = '0xpkg::fight_events::'
const BASE_RANGE = 6

/** One minted chain `Effect`, in the capsule's captured field shape (u64s as strings). */
const effect = (over = {}) => ({
  area_shape: SE.SHAPE_POINT,
  area_size: '0',
  chance: 100,
  element: 255,
  flags: 0,
  kind: SE.K_ALTER_STAT,
  phase: SE.PHASE_ON_ENTER,
  stat: SE.STAT_RANGE,
  target_filter: SE.TF_ONLY_CASTER,
  turns: 3,
  value: '32769', // authored +1, CENTERED — what the chain actually puts on the wire
  ...over,
})

/** The captured action envelope bracketing one self-cast, with the effect row under test inside it. */
const rows = (row) => [
  {
    kind: 'ActionStarted',
    data: {
      action_kind: 0,
      action_ordinal: '0',
      ap_cost: '2',
      caster_idx: '0',
      caster_is_mob: false,
      effect_count: '1',
      fight: FIGHT,
      target_cell: String(START),
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
  { kind: 'Cast', data: { fight: FIGHT, caster_is_mob: false, caster_idx: 0, target_cell: START } },
  {
    kind: 'ActionResolved',
    data: {
      action_kind: 0,
      action_ordinal: '0',
      ap_cost: '2',
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
      class: 'yajin',
      team: 0,
      hp: 50,
      max_hp: 50,
      ap: 6,
      mp: 3,
      base_ap: 6,
      base_mp: 3,
      cell: START,
      base_stats: { range: BASE_RANGE },
    },
  ],
  mobs: [],
  queue: [{ is_mob: false, idx: 0 }],
  turn_ptr: 0,
  turn_deadline_ms: 90_000,
  invisibility_statuses: [],
}

/** The production ingress: a real store, the real receipt door. */
const drive = (row) => {
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
      receipt: { events: rows(row).map((e) => ({ type: PKG + e.kind, parsedJson: e.data })) },
    },
    1_100
  )
  return store
}

const folded_row = (store) => committed_state(store.getState()).fighters.p0.statuses[0]
const projected = (store) => engine_view(store.getState()).fighters.get(CHAR)

/** The exact legality gate the cast wash runs (`overlay_intents` adds `range_bonus_of` to the authored rmax and
 *  hands it to this sim function). Probed per DISTANCE rather than enumerated — a wrong bonus must red the
 *  assertion, never blow the grid up. */
const AUTHORED_RMAX = 4
const CAST_LEVEL = { range: [0, AUTHORED_RMAX], modifiable_range: true, linear: false, line_of_sight: false }
const NO_OBSTACLES = { blocks_los: () => false, is_occupied: () => false }
const castable_at = (fighter, distance) =>
  can_target(CAST_LEVEL, { x: 0, y: 0 }, { x: distance, y: 0 }, NO_OBSTACLES, range_bonus_of(fighter))

describe('#983 the receipt door decodes the signed chain value exactly once', () => {
  test('RED (display): an authored +1 Range self-buff folds as +1, never the raw 32769 or a re-centered -32767', () => {
    const store = drive(effect())
    const row = folded_row(store)

    expect(row.value).toBe(1)
    expect(row.value).not.toBe(32_769)
    expect(row.value).not.toBe(-32_767)
    // The chip reads the projection, not the committed row — both must speak the same signed number.
    expect(projected(store).effects[0]).toMatchObject({ kind: SE.K_ALTER_STAT, stat: SE.STAT_RANGE, value: 1 })
  })

  test('RED (function): the buffed seat casts exactly one cell further', () => {
    const unbuffed = { base_range: BASE_RANGE, effects: [] }
    const buffed = projected(drive(effect()))
    const reach = AUTHORED_RMAX + BASE_RANGE

    expect(range_bonus_of(buffed)).toBe(BASE_RANGE + 1)
    // The ring the buff unlocks is castable — and the NEXT one still is not, so the gain is exactly 1.
    expect([castable_at(unbuffed, reach), castable_at(unbuffed, reach + 1)]).toEqual([true, false])
    expect([castable_at(buffed, reach + 1), castable_at(buffed, reach + 2)]).toEqual([true, false])
  })

  test('CAPTURED WIRE: the minted -7 range debuff folds negative, and the fold still ignores FLAG_NEGATIVE', () => {
    // Kraken Leviathan's real mint (value "32761", flags 8) — the sign lives in the value, never in the flag.
    const signed = folded_row(drive(effect({ value: '32761', flags: SE.FLAG_NEGATIVE, turns: 5 })))
    expect(signed.value).toBe(-7)
    // The SAME magnitude minted WITHOUT the flag decodes identically: the flag is not the sign source (#904).
    expect(folded_row(drive(effect({ value: '32761', flags: 0, turns: 5 }))).value).toBe(-7)
    // …and it reaches the legality read as a real debuff: base 6 - 7 floors at 0, Move's own u64 stat floor.
    expect(range_bonus_of(projected(drive(effect({ value: '32761', flags: SE.FLAG_NEGATIVE }))))).toBe(0)
  })

  test('non-signed kinds keep their plain magnitude — a +1 MP grant is still 1, not -32767', () => {
    const grant = folded_row(drive(effect({ kind: SE.K_GIVE_POINTS, stat: SE.POINT_MP, value: '1' })))
    expect(grant).toMatchObject({ kind: SE.K_GIVE_POINTS, value: 1 })
  })
})
