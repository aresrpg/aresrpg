// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// reduce_terminal_announcement.test.js — RED-FIRST for #1169 (the terminal half): a fight that was DECIDED but
// never ANNOUNCED.
//
// `apply_damage` latches `winner` on the state the instant a kill wipes a team; `with_victory` is what turns
// that latch into the `fight_ended` event every consumer terminalizes on. `advance_if_dead` — the arm that ends
// a fighter's turn when it dies mid-move/mid-cast — asked `with_victory` for the announcement while handing it
// `advanced.state.winner` as the PREVIOUS winner. When the advance's own turn-start hazard (a DoT/glyph tick on
// the NEXT actor) wiped the last enemy, that "previous" winner was already the fresh verdict, so `with_victory`
// concluded the fight had been decided earlier and stayed silent.
//
// The state was terminal, the event stream never said so: no `fight_ended`, therefore no `Victory` row, no
// client terminal — the fight runs open-ended ("it should stop the sim"). Every other caller passes the
// PRE-command winner; this one alone read it back after the mutation.

import { describe, expect, test } from 'bun:test'

import { create_fight_state, reduce } from '../src/reduce.js'
import { normalize_spell_templates } from '../src/spell_templates.js'
import * as SE from '../src/spell_effect.js'

const GRID_W = 20
const GRID_H = 19

const arena = {
  width: GRID_W,
  height: GRID_H,
  radius: 9,
  center: { x: 10, y: 9 },
  cells: new Uint8Array(GRID_W * GRID_H),
  spawns_a: [],
  spawns_b: [],
}

/** One AoE centred on the caster's own cell — the sim's documented "died to its own blast" case. */
const TEMPLATES = normalize_spell_templates([
  {
    id: 's_blast',
    levels: [
      {
        ap_cost: 2,
        range_min: 0,
        range_max: 6,
        modifiable_range: false,
        line_launch: false,
        line_of_sight: false,
        free_cell: false,
        casts_per_turn: 255,
        casts_per_target: 255,
        cooldown_turns: 0,
        crit_rate: 0,
        crit_effects: [],
        effects: [
          {
            chance: 100,
            kind: SE.K_DAMAGE,
            element: 0,
            value: 500,
            target_filter: SE.TF_NONE,
            area_shape: SE.SHAPE_CIRCLE,
            area_size: 1,
          },
        ],
      },
    ],
  },
])

const fighter = (id, cell, is_player, { health, effects = [], deck = [] }) => ({
  id,
  name: id,
  cell,
  health,
  health_max: health,
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
  effects,
  spell_levels: Object.fromEntries(deck.map(s => [s, 1])),
  ap_reserve: 0,
})

/**
 * The exact shape the wedge needs: the acting mob kills ITSELF, and the advance its death triggers runs the
 * NEXT mob's turn-start DoT, which is lethal. Team1 is wiped inside `advance_if_dead`, not inside the cast.
 */
const state_of = () => {
  const team0 = [fighter('p0', { x: 2, y: 2 }, true, { health: 300 })]
  const team1 = [
    // m0 acts AFTER m1 and carries a DoT that will kill it the moment its turn starts.
    fighter('m0', { x: 14, y: 10 }, false, {
      health: 4,
      effects: [
        {
          id: 1,
          type: 'DAMAGE',
          timing: 'TURN_START',
          source_id: 'p0',
          value: 40,
          turns_remaining: 4,
        },
      ],
    }),
    fighter('m1', { x: 10, y: 10 }, false, { health: 20, deck: ['s_blast'] }),
  ]
  const base = create_fight_state({
    fight_id: 'terminal',
    arena_seed: 7,
    arena_radius: arena.radius,
    arena,
    team0,
    team1,
  })
  return {
    ...base,
    started: true,
    // m1 acts first; m0 is next in line, so m1's death advances the turn straight onto m0's lethal hazard.
    turn_order: ['m1', 'm0', 'p0'],
    current_turn_idx: 0,
    turn_number: 1,
    last_total_hp: [...team0, ...team1].reduce((sum, e) => sum + e.health, 0),
  }
}

describe('#1169 — a decided fight is always ANNOUNCED', () => {
  const ctx = { spell_templates: TEMPLATES, arena }
  const { state, events } = reduce(
    state_of(),
    {
      type: 'cast',
      entity_id: 'm1',
      spell_id: 's_blast',
      target: { x: 10, y: 10 },
    },
    ctx,
  )

  test('the blast really wipes team1 — the caster dies, the advance kills the last mob', () => {
    expect(state.team1.every(e => e.health <= 0)).toBe(true)
    expect(state.team0.some(e => e.health > 0)).toBe(true)
  })

  test('the state is terminal', () => {
    expect(state.winner).toBe(0)
  })

  test('and the EVENT STREAM says so — exactly one fight_ended, naming the winner', () => {
    const ended = events.filter(e => e.type === 'fight_ended')
    // RED before the fix: zero. The fight was over and nothing ever said it.
    expect(ended).toHaveLength(1)
    expect(ended[0].winner).toBe(0)
  })

  test('no turn ever starts after the terminal — a decided fight hands out no turns', () => {
    const last_end = events.map(e => e.type).lastIndexOf('fight_ended')
    expect(
      events.slice(last_end + 1).some(e => e.type === 'fight_turn_start'),
    ).toBe(false)
  })
})
