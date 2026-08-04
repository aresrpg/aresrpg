// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// summon_never_resolves.test.js — the behavioural half of the summoning deletion (#2186).
//
// The sim used to RESOLVE a summon: fight_summon.js appended an AI minion to a team and to the turn order.
// `spell_effect.move` enumerates 41 effect kinds and excludes summoning by name, and `sim_chain_events.js`
// has no event that can encode a roster that grew mid-fight — so every summon the sim folded was a predicted
// outcome the chain could never produce. The resolution is gone; the legacy SDK corpus still authors `summon`
// rows for that killed mechanic, so the sim's decode door refuses them LOUDLY and folds nothing.
//
// The structural half of the seal lives in spell_effect.test.js (the sim kind table == the Move kind table).

import { describe, expect, test } from 'bun:test'

import { normalize_spell_templates } from '../src/spell_templates.js'

import { cast, fighter, state_of } from './missing_effect_helpers.js'

/** Run `fn`, capturing everything it writes to console.error. */
const captured = fn => {
  const lines = []
  const original = console.error
  console.error = (...args) => lines.push(args.join(' '))
  try {
    return { value: fn(), lines }
  } finally {
    console.error = original
  }
}

const summon_spell = () =>
  captured(() =>
    normalize_spell_templates([
      {
        id: 'arise',
        levels: [
          {
            ap_cost: 0,
            range_min: 0,
            range_max: 8,
            casts_per_turn: 255,
            casts_per_target: 255,
            cooldown_turns: 0,
            effects: [{ type: 'summon', summon: 'igris', target: 'cell' }],
            crit_effects: [],
          },
        ],
      },
    ]).get('arise'),
  )

describe('summoning never resolves in the sim (#2186)', () => {
  test('the decode door refuses an authored summon LOUDLY and folds it to nothing', () => {
    const { value: spell, lines } = summon_spell()
    expect(spell.levels[0].base_effects.map(e => e.type)).toEqual([
      'UNSUPPORTED',
    ])
    expect(lines.length).toBe(1)
    expect(lines[0]).toContain('arise')
    expect(lines[0]).toContain('summon')
  })

  test('casting it leaves the roster and the turn order untouched', () => {
    const { value: spell } = summon_spell()
    const caster = fighter('p0', { x: 4, y: 4 }, true)
    const state = state_of([caster], [fighter('m0', { x: 6, y: 4 }, false)])

    const result = cast(state, 'p0', spell, { x: 5, y: 4 })

    expect(result.success).toBe(true)
    expect(result.state.team0.map(e => e.id)).toEqual(['p0'])
    expect(result.state.team1.map(e => e.id)).toEqual(['m0'])
    expect(result.state.turn_order).toEqual(state.turn_order)
    expect(result.effects ?? []).toEqual([])
  })
})
