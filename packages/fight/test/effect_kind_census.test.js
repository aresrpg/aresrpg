// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//
// THE EFFECT-KIND CENSUS — the standing answer to "did the mob dodge, or is that mechanic not implemented?"
//
// A player reported a `-2 MP` spell removing no MP and had no way to tell which of those two it was; the same
// session reported a "Steals 1 MP" doing nothing. Both turned out to FOLD correctly and be DODGED — but the
// suspicion the silence created ("many spell effects are probably not implemented at all") is only answerable
// with a measurement, and there wasn't one. Two gates already walk this vocabulary and neither could have
// answered it: `effect_kind_matrix.test.js` asserts a cast EXECUTES and is deterministic (a silent no-op passes
// both), and `inert_effect_kinds.test.js` pins which kinds the NORMALIZER refuses (a kind can normalize
// perfectly and still fold nothing).
//
// This walks the whole vocabulary through the two seams where a mechanic goes quiet, and demands each kind be
// LOUD or NAMED at both:
//
//   COLUMN 1 · FOLDS — the sim's cast resolution states an outcome for the kind (≥1 receipt row). A kind that
//     folds nothing must be a NAMED member of `INERT_KINDS` below, citing the issue that will wire it.
//   COLUMN 2 · WIRE — every status the fold can state survives `sim_chain_events`'s encoder: it becomes a chain
//     row, or it is a NAMED member of that encoder's own INERT_STATUSES set (the statuses the chain also
//     records inside the action envelope rather than emitting). The encoder THROWS on anything unmapped, which
//     is what makes this column mechanical rather than declarative.
//
// The third column — "does the outcome surface visually" — is `presented_beat_kinds.test.js` in the frontend,
// where the presenter lives. Together they are the instrument: a new kind cannot ship silent at any seam.
//
// The dodge itself is the proof this was needed: `POINT_DODGED` folded, and was then dropped by the encoder as
// though the chain never stated it — while `cast.move:1832` emits `Drain{ removed: 0 }` on exactly that path.

import { describe, expect, test } from 'bun:test'

import { find_entity } from '../../sim/src/fight_state.js'
import { process_spell_cast } from '../../sim/src/fight_spells.js'
import { create_fight_state } from '../../sim/src/reduce.js'
import * as SE from '../../sim/src/spell_effect.js'
import { normalize_spell_templates } from '../../sim/src/spell_templates.js'
import { encode_sim_step } from '../src/sim_chain_events.js'

/** Every `K_*` discriminant the vocabulary declares — the census population, derived, never restated. */
const KIND_NAME = Object.fromEntries(
  Object.entries(SE)
    .filter(([name, value]) => name.startsWith('K_') && typeof value === 'number')
    .map(([name, value]) => [value, name])
)
const ALL_KINDS = [...new Set(Object.keys(KIND_NAME).map(Number))].toSorted((a, b) => a - b)

/**
 * THE NAMED SILENCES. A kind here folds nothing ON PURPOSE and says which issue wires it. Anything that goes
 * quiet WITHOUT a row here fails the census — that is the whole point: silence must be a decision, never a
 * default. Shrinking this list is the work; growing it needs an issue number.
 */
const INERT_KINDS = {
  [SE.K_RESET_POSITIONS]: 'no arm on either side of the twin — #1039 wires it',
  [SE.K_REMOVE_STATE]: 'no arm on either side of the twin — #1039 wires it',
}

const arena = {
  width: 9,
  height: 9,
  radius: 4,
  center: { x: 4, y: 4 },
  cells: new Uint8Array(81),
  spawns_a: [],
  spawns_b: [],
}

const fighter = (id, cell, is_player, health = 100) => ({
  id,
  name: id,
  cell,
  health,
  health_max: 100,
  ap: 10,
  ap_max: 10,
  mp: 6,
  mp_max: 6,
  ap_used: 0,
  mp_used: 0,
  is_player,
  template_id: 'census',
  level: 1,
  stats: {},
  effects: [],
  hand: [],
  spell_levels: {},
  ap_reserve: 0,
})

/** A caster, a wounded ally and an adjacent enemy — enough board for every kind to have something to act on. */
const board = () => {
  const team0 = [fighter('p0', { x: 2, y: 2 }, true, 200), fighter('p1', { x: 1, y: 2 }, true, 30)]
  const team1 = [fighter('m0', { x: 3, y: 2 }, false)]
  return {
    ...create_fight_state({ fight_id: 'census', arena_seed: 1, arena_radius: 4, arena, team0, team1 }),
    started: true,
    turn_order: [...team0, ...team1].map((e) => e.id),
    turn_number: 1,
    last_total_hp: 330,
  }
}

/** Fold ONE effect of `kind` at the adjacent enemy and report what the resolution STATED. */
const fold_kind = (kind) => {
  const spell = normalize_spell_templates([
    {
      id: `census_${kind}`,
      levels: [
        {
          ap_cost: 0,
          range_min: 0,
          range_max: 8,
          modifiable_range: false,
          line_launch: false,
          line_of_sight: false,
          free_cell: false,
          casts_per_turn: 255,
          casts_per_target: 255,
          cooldown_turns: 0,
          crit_rate: 0,
          effects: [
            {
              kind,
              value: 3,
              element: 2,
              target_filter: SE.TF_NOT_TEAM,
              chance: 100,
              turns: 2,
              stat: 0,
              flags: 0,
              area_shape: SE.SHAPE_POINT,
              area_size: 0,
            },
          ],
          crit_effects: [],
        },
      ],
    },
  ]).get(`census_${kind}`)
  const state = board()
  const before = find_entity(state, 'm0')
  const result = process_spell_cast(
    state,
    'p0',
    spell,
    1,
    { x: 3, y: 2 },
    { blocks_los: () => false, is_occupied: () => false }
  )
  const after = find_entity(result.state, 'm0')
  const rows = result.effects ?? []
  return {
    rows,
    // "the fold stated an outcome": a receipt row, or a visible move on the target if a kind ever lands one silently
    stated: rows.length > 0 || after.health !== before.health || after.ap !== before.ap || after.mp !== before.mp,
    statuses: [...new Set(rows.map((row) => row.status).filter(Boolean))],
  }
}

const CENSUS = Object.fromEntries(ALL_KINDS.map((kind) => [kind, fold_kind(kind)]))

describe('COLUMN 1 · every effect kind folds an outcome, or is a NAMED silence', () => {
  for (const kind of ALL_KINDS)
    test(`${kind} ${KIND_NAME[kind]} — ${INERT_KINDS[kind] ? 'named inert' : 'folds'}`, () => {
      const { stated } = CENSUS[kind]
      if (INERT_KINDS[kind]) {
        expect(stated).toBe(false) // a named silence that started folding must be REMOVED from the list
        expect(INERT_KINDS[kind]).toMatch(/#\d+/) // …and every named silence cites the issue that ends it
        return
      }
      expect(stated).toBe(true)
    })

  test('the census population IS the vocabulary — a new discriminant cannot ship uncounted', () => {
    expect(ALL_KINDS).toHaveLength(40)
    expect(ALL_KINDS.at(-1)).toBe(SE.K_DAMAGE_REDIRECT)
    // the named silences are a subset of the population, never a stale id
    for (const kind of Object.keys(INERT_KINDS).map(Number)) expect(ALL_KINDS).toContain(kind)
  })
})

describe('COLUMN 2 · every status a fold can state survives the wire encoder', () => {
  // The encoder THROWS on an unmapped status (`sim_chain: unmapped effect status`), so driving every status the
  // census observed through it is the assertion: mapped kinds encode, deliberately-inert ones encode to nothing,
  // and a status nobody classified takes the whole run down instead of vanishing.
  // `fight_turn_effects` is the encoder's bare effect-list door — the same `encode_effect` every cast, trap and
  // DoT tick routes through, with none of a cast's envelope noise around it.
  const encode_status = (row) => {
    const state = board()
    return encode_sim_step({
      pre_state: state,
      post_state: state,
      events: [{ type: 'fight_turn_effects', effects: [row] }],
      fight_id: 'census',
    }).rows
  }

  for (const kind of ALL_KINDS)
    if (CENSUS[kind].statuses.length > 0)
      test(`${kind} ${KIND_NAME[kind]} — its statuses (${CENSUS[kind].statuses.join(', ')}) are classified`, () => {
        for (const row of CENSUS[kind].rows) expect(() => encode_status(row)).not.toThrow()
      })

  test('POINT_DODGED is no longer silent — the dodge the census was built for', () => {
    const rows = encode_status({ target_id: 'm0', status: 'POINT_DODGED', stat: 'mp', value: 0, requested: 2 })
    const drain = rows.find((row) => row.type.endsWith('::Drain'))
    expect(drain).toBeDefined()
    expect(Number(drain.parsedJson.removed)).toBe(0)
    expect(Number(drain.parsedJson.requested)).toBe(2)
  })
})
