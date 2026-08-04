// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #324 — "mob turns pass with no action". This locks the DECISION side of the mob turn (the sim twin the chain
// mirrors): a mob that can reach a player it can see NEVER resolves a bare pass. The investigation verdict:
//   • the FRONTEND never drives the sim's ai_turn — live mob turns are 100% chain/journal-driven, rendered by
//     voxel_fight_folds; the sim's planner is the parity/offline twin. So a live no-op is a PRESENTATION gap
//     (the in-flight V2 journal pipeline, #291) or a CHAIN-side pass (a Move parity delta), NOT a sim decision.
//   • the sim decision side is CORRECT and this fixture proves it (adjacent → strike; a step away → close + strike),
//     so a future regression that makes the planner pass instead of act trips here first.
// The earlier "mob 2-away passed" repro was a test-harness confound (a wrong arena SHAPE — reduce.js's
// terrain_walkable reads a Uint8Array `cells`, 0 = walkable; an array-of-objects arena blocked every move). This
// fixture uses the REAL flat_arena shape (copied from fight_mechanics.test.js) so the walkability is authentic.
import { describe, expect, test } from 'bun:test'

import { reduce, create_fight_state } from '../src/reduce.js'
import {
  normalize_spell_templates,
  MOB_ATTACK_ID,
} from '../src/spell_templates.js'
import { get_current_turn_entity } from '../src/fight_state.js'

const spell_templates = normalize_spell_templates([]) // the MOB_ATTACK_TEMPLATE is registered by the normalizer

// REAL arena shape: Uint8Array cells (0 = walkable), width/height/radius/center/spawns — fight_mechanics.test.js.
const flat_arena = (width = 11) => ({
  width,
  height: width,
  radius: (width - 1) / 2,
  center: { x: (width - 1) / 2, y: (width - 1) / 2 },
  cells: new Uint8Array(width * width),
  spawns_a: [
    { x: 1, y: 5 },
    { x: 1, y: 6 },
  ],
  spawns_b: [
    { x: 9, y: 5 },
    { x: 9, y: 6 },
  ],
})

const player = (id, cell) => ({
  id,
  name: id,
  cell,
  health: 100,
  health_max: 100,
  ap: 10,
  ap_max: 10,
  mp: 5,
  mp_max: 5,
  ap_used: 0,
  mp_used: 0,
  is_player: true,
  template_id: 'senshi',
  level: 1,
  stats: { agility: 0, intelligence: 0, range: 0 },
  effects: [],
  spell_levels: {},
  ap_reserve: 0,
})
// A mob armed with the basic melee strike (range [1,1], cost 3) — the generic MOB_ATTACK every mob carries.
const mob = (id, cell) => ({
  id,
  name: id,
  cell,
  health: 100,
  health_max: 100,
  ap: 6,
  ap_max: 6,
  mp: 3,
  mp_max: 3,
  ap_used: 0,
  mp_used: 0,
  is_player: false,
  template_id: 'mob',
  level: 1,
  stats: { agility: 0, intelligence: 0, range: 0 },
  effects: [],
  spell_levels: { [MOB_ATTACK_ID]: 1 },
  ap_reserve: 0,
})

const ACTION_EVENTS = new Set([
  'fight_cast',
  'fight_moved',
  'fight_move',
  'mob_moved',
  'fight_damage',
  'fight_hit',
])

/** Resolve the mob's whole turn from a fresh fight and return its ordered events + the player's post-turn hp. */
const resolve_mob_turn = ({ p_cell, m_cell }) => {
  const arena = flat_arena()
  const ctx = { spell_templates, arena }
  let state = create_fight_state({
    fight_id: 'f',
    arena_seed: 1,
    arena_radius: arena.radius,
    arena,
    team0: [player('p0', p_cell)],
    team1: [mob('m0', m_cell)],
  })
  ;({ state } = reduce(state, { type: 'ready', entity_id: 'p0' }, ctx)) // force-start (mobs auto-ready)
  // Advance to the mob's turn: end any leading player turns (deterministic; a solo player has exactly one).
  let guard = 0
  for (
    let cur = get_current_turn_entity(state);
    cur && cur.is_player && guard < 4;
    guard += 1
  ) {
    ;({ state } = reduce(state, { type: 'end_turn', entity_id: cur.id }, ctx))
    cur = get_current_turn_entity(state)
  }
  expect(get_current_turn_entity(state)?.id).toBe('m0') // precondition: it is the mob's turn
  const { events } = reduce(state, { type: 'ai_turn', entity_id: 'm0' }, ctx)
  return { events, actions: events.filter(e => ACTION_EVENTS.has(e.type)) }
}

describe('#324 mob turn — a reachable, visible player is never met with a bare pass', () => {
  test('mob ADJACENT to a player with AP for its strike RESOLVES an attack (not a pass)', () => {
    const { actions, events } = resolve_mob_turn({
      p_cell: { x: 5, y: 5 },
      m_cell: { x: 6, y: 5 },
    })
    expect(actions.length).toBeGreaterThan(0)
    expect(events.some(e => e.type === 'fight_cast')).toBe(true)
  })

  test('mob one step OUT of range steps IN and strikes — the "can\'t path → passes" case (#324)', () => {
    const { actions, events } = resolve_mob_turn({
      p_cell: { x: 5, y: 5 },
      m_cell: { x: 7, y: 5 },
    })
    // it MOVED toward the player AND then struck from the new adjacent cell — both beats present, not a pass.
    expect(events.some(e => e.type === 'fight_moved')).toBe(true)
    expect(events.some(e => e.type === 'fight_cast')).toBe(true)
    expect(actions.length).toBeGreaterThanOrEqual(2)
  })
})
