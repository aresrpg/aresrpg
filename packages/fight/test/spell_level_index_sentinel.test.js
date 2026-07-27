// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//
// THE RANK-INDEX SENTINEL — a spell level is a required input, never a defaultable one (#1089).
//
// `sim_chain_events.js`'s `level_of` resolves the authored level a cast priced and resolved at:
//
//     return template.levels?.[level - 1] ?? template.levels?.[0] ?? null
//
// The second `??` is the subject of this file. On a level-index MISS — the seat's learned level naming a rank
// the authored template does not carry — the encoder silently prices rank 1 and emits a full action envelope
// for it. The row is then internally contradictory: `ActionResolved.learned_level` states the rank the seat
// holds while `ap_cost` and the effect descriptors state the rank the encoder fell back to. A miss on an
// authored template is corpus/seed corruption, and corruption that names itself is the #1032 loud-refusal law.
//
// The green test below is the durable half: it proves the encoder prices the SEAT'S rank whenever the index
// resolves, so a regression back to "always levels[0]" is caught. The skipped test is #1089's definition of
// done — it cannot go green without the production change that replaces the fallback with a refusal.

import { describe, expect, test } from 'bun:test'
import { normalize_spell_templates } from '@aresrpg/sim/spell_templates'

import * as SE from '../../sim/src/spell_effect.js'
import { encode_sim_step } from '../src/sim_chain.js'

const FIGHT_ID = 'sim:rank:1'
const SPELL = 's_ladder'
const CASTER = 'p0'

/** One authored rank of the ladder — a distinct AP cost and damage per rank, so the row names which one it
 *  priced. Authored in the RAW shape `normalize_spell_templates` consumes (never its own output: the
 *  normalizer is not idempotent and degrades a second pass to UNSUPPORTED). */
const rank = (ap_cost, damage) => ({
  ap_cost,
  range_min: 0,
  range_max: 12,
  modifiable_range: false,
  line_launch: false,
  line_of_sight: false,
  free_cell: false,
  casts_per_turn: 255,
  casts_per_target: 255,
  cooldown_turns: 0,
  crit_rate: 0,
  effects: [{ kind: SE.K_DAMAGE, element: 0, value: damage, target_filter: SE.TF_NOT_TEAM, chance: 100 }],
  crit_effects: [],
})

/** A three-rank ladder: rank 1 costs 2, rank 2 costs 4, rank 3 costs 6. */
const LADDER = [rank(2, 10), rank(4, 20), rank(6, 30)]

const fighter = (id, cell, is_player, learned_level) => ({
  id,
  name: id,
  cell,
  health: 100,
  health_max: 100,
  ap: 8,
  ap_max: 8,
  mp: 4,
  mp_max: 4,
  ap_used: 0,
  mp_used: 0,
  is_player,
  template_id: is_player ? 'senshi' : '0xmob_template',
  level: 20,
  stats: {},
  effects: [],
  spell_levels: learned_level == null ? {} : { [SPELL]: learned_level },
  ap_reserve: 0,
})

/** The whole encode step for one cast, at a seat that learned `learned_level` of a template carrying `levels`
 *  ranks. Returns the ActionStarted / ActionResolved pair the envelope minted. */
const envelope_of = ({ learned_level, levels = LADDER }) => {
  const caster = fighter(CASTER, { x: 2, y: 2 }, true, learned_level)
  const enemy = fighter('m0', { x: 4, y: 2 }, false, null)
  const state = { team0: [caster], team1: [enemy], turn_number: 3 }
  const { rows } = encode_sim_step({
    pre_state: state,
    post_state: state,
    fight_id: FIGHT_ID,
    spell_templates: normalize_spell_templates([{ id: SPELL, name: 'Ladder', levels }]),
    events: [
      {
        type: 'fight_cast',
        entity_id: CASTER,
        spell_id: SPELL,
        target: enemy.cell,
        effects: [],
      },
    ],
  })
  const of_type = (name) => rows.find((r) => r.type.endsWith(`::${name}`))?.parsedJson ?? null
  return { started: of_type('ActionStarted'), resolved: of_type('ActionResolved') }
}

describe('the action envelope prices the rank the seat actually holds', () => {
  test('a resolving level index prices ITS rank — never rank 1 by default', () => {
    const priced = [1, 2, 3].map((learned_level) => {
      const { started, resolved } = envelope_of({ learned_level })
      return {
        learned_level,
        ap_cost: Number(started.ap_cost),
        // the row's own claim about which rank it resolved at, read back from the same envelope
        stated_level: Number(resolved.learned_level),
        damage: Number(resolved.effects[0].value),
      }
    })
    expect(priced).toEqual([
      { learned_level: 1, ap_cost: 2, stated_level: 1, damage: 10 },
      { learned_level: 2, ap_cost: 4, stated_level: 2, damage: 20 },
      { learned_level: 3, ap_cost: 6, stated_level: 3, damage: 30 },
    ])
  })

  test("an UNLEARNED spell resolves at rank 1 — the sim's documented `spell_levels[id] ?? 1` default", () => {
    const { started, resolved } = envelope_of({ learned_level: null })
    expect({ ap_cost: Number(started.ap_cost), stated_level: Number(resolved.learned_level) }).toEqual({
      ap_cost: 2,
      stated_level: 1,
    })
  })

  // #1089 — THE DEFINITION OF DONE. Skipped: it cannot go green without the production change that replaces
  // `level_of`'s `?? template.levels?.[0]` fallback (sim_chain_events.js:343-349) with a loud refusal. Today a
  // seat holding rank 5 of a 3-rank template mints an envelope priced at rank 1 while `learned_level` states 5
  // — a row that contradicts itself, on the resolution path, from corpus corruption that never named itself.
  test.skip('a level-index MISS refuses loudly instead of pricing rank 1 (#1089)', () => {
    expect(() => envelope_of({ learned_level: 5 })).toThrow(/level/i)
  })
})
