// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// sim_chain_corpus.js — THE SCRIPTED CORPUS the drift gate (`sim_chain.test.js`) drives.
//
// Split from the gate so each half stays readable on its own: this module is the FIGHT — the synthesized kit,
// the roster, and the turn script — and the gate is the ASSERTION. Nothing here knows what is measured; a
// change to the script changes what the fight exercises, never what counts as drift.

import { normalize_spell_templates } from '@aresrpg/sim/spell_templates'

import * as SE from '../../sim/src/spell_effect.js'
import { encode } from '../src/los.js'
import { arena_from_board, create_sim_chain, derive_board } from '../src/sim_chain.js'

/** The determinism root of the whole gate: one seed, one fight id, for every driver that replays this corpus. */
export const SEED = 0xc81f3a92
export const FIGHT_ID = 'sim:c81f3a92:1'

// ╔════════════════ [ The scripted fight — synthesized kits, the real reducer ] ════════════════════════════ ]
// The kit is SYNTHESIZED (the combinatorial/entities.js idiom: one authored template per effect kind, built
// through the real `normalize_spell_templates`) so the corpus deterministically exercises every arm the spec
// names — AoE, displacement, DoT, trap, heal, death, victory — instead of hoping a shipped spell does.

export const level = (effects, { ap_cost = 3, range_max = 14, free_cell = false } = {}) => ({
  ap_cost,
  range_min: 0,
  range_max,
  modifiable_range: false,
  line_launch: false,
  line_of_sight: false,
  free_cell,
  casts_per_turn: 255,
  casts_per_target: 255,
  cooldown_turns: 0,
  crit_rate: 0,
  effects: effects.map((e) => ({ chance: 100, ...e })),
  crit_effects: [],
})

export const PLAYER_KIT = [
  { id: 's_nuke', levels: [level([{ kind: SE.K_DAMAGE, element: 0, value: 26, target_filter: SE.TF_NOT_TEAM }])] },
  {
    id: 's_aoe',
    levels: [
      level([
        {
          kind: SE.K_DAMAGE,
          element: 0,
          value: 11,
          target_filter: SE.TF_NOT_TEAM,
          area_shape: SE.SHAPE_CIRCLE,
          area_size: 2,
        },
      ]),
    ],
  },
  { id: 's_push', levels: [level([{ kind: SE.K_PUSH, value: 2, target_filter: SE.TF_NOT_TEAM }], { ap_cost: 2 })] },
  {
    id: 's_dot',
    levels: [level([{ kind: SE.K_APPLY_DOT, element: 0, value: 6, turns: 4, target_filter: SE.TF_NOT_TEAM }])],
  },
  {
    id: 's_trap',
    levels: [
      level(
        [
          { kind: SE.K_PLACE_TRAP, area_shape: SE.SHAPE_CIRCLE, area_size: 3 },
          { kind: SE.K_DAMAGE, element: 0, value: 9, target_filter: SE.TF_NOT_TEAM },
        ],
        { ap_cost: 2, free_cell: true }
      ),
    ],
  },
  {
    id: 's_heal',
    levels: [level([{ kind: SE.K_HEAL, element: 0, value: 8, target_filter: SE.TF_NOT_ENEMY }], { ap_cost: 2 })],
  },
  {
    id: 's_jab',
    levels: [level([{ kind: SE.K_DAMAGE, element: 0, value: 7, target_filter: SE.TF_NOT_TEAM }], { ap_cost: 1 })],
  },
]

export const MOB_KIT = [
  {
    id: 'm_hit',
    levels: [level([{ kind: SE.K_DAMAGE, element: 0, value: 15, target_filter: SE.TF_NOT_TEAM }], { range_max: 7 })],
  },
]

/** The whole castable corpus, RAW — what the chain stores and hands the sim's normalizer (and the recorder). */
export const TEMPLATES_RAW = [...PLAYER_KIT, ...MOB_KIT]

export const fighter = (id, cell, is_player, { health, ap, mp, deck = [], level: lvl = 20, stats = {} }) => ({
  id,
  name: id,
  cell,
  health,
  health_max: health,
  ap,
  ap_max: ap,
  mp,
  mp_max: mp,
  ap_used: 0,
  mp_used: 0,
  is_player,
  template_id: is_player ? 'senshi' : '0xmob_template',
  level: lvl,
  stats,
  effects: [],
  // A deck of EXACTLY the opening hand size: `handle_start` deals min(7, deck.length), so the hand holds the
  // whole kit every turn (a cast discards, `end_turn` reshuffles the discard back). Deterministic control.
  spell_levels: Object.fromEntries(deck.map((s) => [s, 1])),
  ap_reserve: 0,
})

export const PLAYER_DECK = PLAYER_KIT.map((s) => s.id)
export const MOB_DECK = MOB_KIT.map((s) => s.id)

/** Two roster seats on the board's own team-A start cells, three mobs on team B. */
export const build_chain = ({ seed = SEED, fight_id = FIGHT_ID } = {}) => {
  const { board } = derive_board(seed)
  const arena = arena_from_board(board)
  const team0 = arena.spawns_a
    .slice(0, 2)
    .map((cell, i) => fighter(`sim_c${i + 1}`, cell, true, { health: 120, ap: 8, mp: 4, deck: PLAYER_DECK }))
  const team1 = arena.spawns_b
    .slice(0, 3)
    .map((cell, i) => fighter(`mob_${i}`, cell, false, { health: 46, ap: 6, mp: 3, deck: MOB_DECK, level: 12 }))
  return create_sim_chain({ seed, fight_id, team0, team1, templates_raw: TEMPLATES_RAW, group_template: '0xgroup' })
}

export const living = (state, team) => state[team].filter((e) => e.health > 0)

/** The rotation the scripted seat cycles — every arm of the kit, one per round. */
export const ROTATION = ['s_nuke', 's_aoe', 's_dot', 's_push', 's_trap', 's_heal', 's_jab']

/** The kit's own authored reach and free-cell demand, read from PLAYER_KIT rather than restated — a copy would
 *  be a second home for the same fact and would drift the moment a kit entry changed (#1033). */
export const LEVEL_OF = Object.fromEntries(PLAYER_KIT.map((spell) => [spell.id, spell.levels[0]]))

/** The first free walkable 4-neighbour of `cell`, or undefined. A `free_cell` spell (the trap) aborts on an
 *  OCCUPIED anchor, so a trap staged at the caster's own feet is a command the reducer refuses outright. */
export const free_neighbour = (state, arena, cell) => {
  const taken = new Set(
    [...state.team0, ...state.team1].filter((e) => e.health > 0).map((e) => `${e.cell.x},${e.cell.y}`)
  )
  return [
    { x: cell.x + 1, y: cell.y },
    { x: cell.x - 1, y: cell.y },
    { x: cell.x, y: cell.y + 1 },
    { x: cell.x, y: cell.y - 1 },
  ].find(
    (c) =>
      c.x >= 0 &&
      c.y >= 0 &&
      c.x < arena.width &&
      c.y < arena.height &&
      arena.cells[c.y * arena.width + c.x] === 0 &&
      !taken.has(`${c.x},${c.y}`)
  )
}

/** The scripted turn for a player seat: cast a rotating spell at the nearest living mob (at its own cell for the
 *  self-heal, at a free neighbouring cell for the trap), then step toward it. Pure over the state and the arena
 *  — no clock, no rng, no board assumptions.
 *
 *  #1033 — THE CAST IS STAGED ONLY WHEN THE REDUCER CAN RESOLVE IT. The teams spawn ~25 cells apart on this
 *  seed against a kit that reaches 14, and the trap demands a `free_cell` anchor it never got while aimed at
 *  the caster's own feet, so the ungated script fed `reduce` commands it refused outright — silently, for the
 *  whole approach phase and for every trap in the run. A refused cast spends no AP and emits no event, so the
 *  gate simply measured less than it claimed. Staging only resolvable casts is what lets the fold-count
 *  sentinel below assert the corpus is fully live. */
export const player_staged = (state, entity_id, round, arena) => {
  const me = state.team0.find((e) => e.id === entity_id)
  const mobs = living(state, 'team1')
  if (!me || mobs.length === 0) return []
  const nearest = mobs.reduce((best, m) =>
    Math.abs(m.cell.x - me.cell.x) + Math.abs(m.cell.y - me.cell.y) <
    Math.abs(best.cell.x - me.cell.x) + Math.abs(best.cell.y - me.cell.y)
      ? m
      : best
  )
  const spell_id = ROTATION[round % ROTATION.length]
  const level_of_spell = LEVEL_OF[spell_id]
  const target = level_of_spell.free_cell
    ? free_neighbour(state, arena, me.cell)
    : spell_id === 's_heal'
      ? me.cell
      : nearest.cell
  // One step toward the nearest mob, on the 4-connected axis with the larger gap (the sim rebuilds the
  // canonical route from the destination alone — handle_move's destination-only door).
  const dx = nearest.cell.x - me.cell.x
  const dy = nearest.cell.y - me.cell.y
  const step =
    Math.abs(dx) >= Math.abs(dy)
      ? { x: me.cell.x + Math.sign(dx), y: me.cell.y }
      : { x: me.cell.x, y: me.cell.y + Math.sign(dy) }
  const in_reach =
    target != null && Math.abs(target.x - me.cell.x) + Math.abs(target.y - me.cell.y) <= level_of_spell.range_max
  return [
    ...(in_reach ? [{ kind: 1, target: encode(target.x, target.y), spell_template_id: spell_id }] : []),
    ...(dx === 0 && dy === 0 ? [] : [{ kind: 0, target: encode(step.x, step.y) }]),
  ]
}
