// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #1874 — A MOB'S PASS MUST SAY WHY. Reported: an adjacent mob spent its whole turn without acting. The planner
// answers that question with `[{ type: 'end_turn' }]` and nothing else, so "the kit genuinely had no legal
// action" and "something rejected every action" are the SAME observation — there is no way to tell an honest
// pass from a defect, which is exactly the no-silent-refusals law the player-side bot already obeys.
//
// `ai_explain_turn` is the instrument: the SAME decision path (`ai_choose_turn` with a trace sink — one home,
// never a parallel re-derivation) plus the refusal rows it walked over. These tests pin BOTH poles, so a trace
// that reports a plausible-looking nothing can never pass for evidence:
//   · NEGATIVE — an adjacent mob that cannot afford its only spell passes, and the trace NAMES the AP refusal.
//   · POSITIVE (the control) — the same mob with the AP acts, and nothing is refused.

import { describe, expect, test } from 'bun:test'

import { ai_explain_turn } from '../src/fight_ai.js'
import { create_fight_state } from '../src/reduce.js'
import { normalize_spell_templates } from '../src/spell_templates.js'
import { TF_NOT_TEAM } from '../src/spell_effect.js'

// A melee bite: band [1,1], cost 4. Registered RAW so the DAMAGE effect type survives verbatim (mobs read
// `ctx.spell_templates` for their kit — same idiom as mob_ai_close_attack.test.js's BOLT_TEMPLATE).
const BITE_ID = 'bite'
const BITE_TEMPLATE = {
  id: BITE_ID,
  name: 'Bite',
  description: 'A melee bite.',
  levels: [
    {
      cost: 4,
      range: [1, 1],
      critical_chance: 0,
      area: 0,
      area_type: 'CIRCLE',
      casts_per_turn: 255,
      casts_per_target: 255,
      cooldown_turns: 0,
      modifiable_range: false,
      line_of_sight: true,
      linear: false,
      free_cell: false,
      base_effects: [
        {
          type: 'DAMAGE',
          min: 5,
          max: 9,
          element: 'EARTH',
          target: 'enemy',
          target_filter: TF_NOT_TEAM,
          chance: 100,
        },
      ],
      crit_effects: [],
    },
  ],
}

const spell_templates = normalize_spell_templates([])
spell_templates.set(BITE_ID, BITE_TEMPLATE)

const flat_arena = (width = 21) => ({
  width,
  height: width,
  radius: (width - 1) / 2,
  center: { x: (width - 1) / 2, y: (width - 1) / 2 },
  cells: new Uint8Array(width * width),
  spawns_a: [{ x: 1, y: 10 }],
  spawns_b: [{ x: 19, y: 10 }],
})

const fighter = (id, cell, is_player, over = {}) => ({
  id,
  name: id,
  cell,
  health: 100,
  health_max: 100,
  ap: 10,
  ap_max: 10,
  mp: 0,
  mp_max: 0,
  ap_used: 0,
  mp_used: 0,
  is_player,
  template_id: is_player ? 'senshi' : 'mob',
  level: 1,
  stats: { agility: 0, intelligence: 0, range: 0 },
  effects: [],
  spell_levels: is_player ? {} : { [BITE_ID]: 1 },
  ap_reserve: 0,
  ...over,
})

/** Explain the mob's turn with the player standing right next to it (chebyshev 1, manhattan 1). */
const explain_adjacent_mob = ({ ap }) => {
  const arena = flat_arena()
  const state = create_fight_state({
    fight_id: 'f',
    arena_seed: 1,
    arena_radius: arena.radius,
    arena,
    team0: [fighter('p0', { x: 10, y: 10 }, true)],
    // mp 0 pins the question on the CAST decision: there is nowhere to walk, so a pass can only mean
    // "no castable spell" and the trace is the only thing that can say which spell refused, and why.
    team1: [fighter('m0', { x: 10, y: 11 }, false, { ap, ap_max: ap })],
  })
  return ai_explain_turn(
    state,
    'm0',
    spell_templates,
    () => true,
    () => false,
    {
      blocks_los: () => false,
      is_occupied: () => false,
    },
  )
}

describe('#1874 — an adjacent mob that passes has to say why', () => {
  test('NEGATIVE: it cannot afford its only spell — the pass names the AP refusal', () => {
    const { actions, trace } = explain_adjacent_mob({ ap: 3 }) // bite costs 4
    expect(actions).toEqual([{ type: 'end_turn' }])

    // The target was found — this is NOT a visibility pass.
    expect(trace.find(row => row.phase === 'target')?.chose).toBe('p0')
    // …and the cast phase names the spell and the reason it was refused everywhere it was tried.
    const refusal = trace.find(
      row => row.phase === 'cast' && row.spell_id === BITE_ID,
    )
    expect(refusal?.refused).toContain('ap')
    expect(refusal?.cells_tried).toBeGreaterThan(0)
    expect(trace.find(row => row.phase === 'plan')?.chose).toBe('pass')
  })

  test('THE REPORTED SHAPE: diagonally adjacent with no MP — a LEGAL pass, and the trace proves it', () => {
    // The row's symptom, reproduced: to the eye the mob is touching the player (chebyshev 1), so a turn spent
    // doing nothing looks broken. It is not. Range bands are MANHATTAN on this board (4-dir, the same metric
    // `mob_ai.move` uses), so a diagonal neighbour sits at distance 2 — outside a [1,1] melee band — and with
    // 0 MP there is no cell to step to. The trace is what turns that from "the mob froze" into a legal pass:
    // the spell is named, the reason is named, and the movement half says how many cells it had to choose from.
    const arena = flat_arena()
    const state = create_fight_state({
      fight_id: 'f',
      arena_seed: 1,
      arena_radius: arena.radius,
      arena,
      team0: [fighter('p0', { x: 10, y: 10 }, true)],
      team1: [fighter('m0', { x: 11, y: 11 }, false, { ap: 10, ap_max: 10 })],
    })
    const { actions, trace } = ai_explain_turn(
      state,
      'm0',
      spell_templates,
      () => true,
      cell => cell.x === 10 && cell.y === 10,
      { blocks_los: () => false, is_occupied: () => false },
    )
    expect(actions).toEqual([{ type: 'end_turn' }])
    expect(trace.find(row => row.phase === 'target')?.chose).toBe('p0')
    expect(trace.find(row => row.phase === 'cast')).toEqual({
      phase: 'cast',
      spell_id: BITE_ID,
      refused: ['cannot_target_from_here'],
      cells_tried: 1, // 0 MP ⇒ the mob's own cell is the whole search space
    })
    expect(trace.find(row => row.phase === 'plan')?.why).toContain(
      'none closer',
    )
  })

  test('POSITIVE CONTROL: with the AP it acts, and nothing is refused', () => {
    const { actions, trace } = explain_adjacent_mob({ ap: 4 })
    expect(actions).toEqual([
      { type: 'cast', spell_id: BITE_ID, target: { x: 10, y: 10 }, level: 1 },
    ])
    expect(trace.filter(row => row.phase === 'cast')).toEqual([])
    expect(trace.find(row => row.phase === 'plan')?.chose).toBe('cast')
  })
})
