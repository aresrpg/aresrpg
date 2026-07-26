// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #606 — "mobs never close the gap and never touch me" / "moved near me, didn't attack". The DECISION side of
// the mob turn (the sim twin the chain mirrors) must be RANGE-BAND aware: a mob steps to the CLOSEST cell inside
// a spell's range band and FIRES, never overshooting a min-range spell into the point-blank dead zone (walking up
// and whiffing) and never idling when a firing cell is reachable. The on-chain policy already does this
// (aresrpg_foundation::mob_ai::{cast_cell_for,bfs_cast_cell} + mob_ai_policy_tests.move); these lock the sim twin
// to the same outcome so the two can never drift on the close-and-attack path.
//
// RED before the fix (fight_ai.js walked to the MIN-MANHATTAN reachable cell then cast if in range): a ranged mob
// whose target sits inside its min-range walked CLOSER (the wrong way, into the dead zone) and never cast.
import { describe, expect, test } from 'bun:test'

import { reduce, create_fight_state } from '../src/reduce.js'
import {
  normalize_spell_templates,
  MOB_ATTACK_ID,
} from '../src/spell_templates.js'
import { get_current_turn_entity, find_entity } from '../src/fight_state.js'
import { manhattan_distance } from '../src/cell.js'
import { TF_NOT_TEAM } from '../src/spell_effect.js'

// A ranged bolt: range band [3,5], LOS-required, cost 3. Registered RAW (like MOB_ATTACK_TEMPLATE) so the DAMAGE
// effect type survives verbatim — mobs read `ctx.spell_templates` for their kit.
const BOLT_ID = 'bolt'
const BOLT_RANGE = [3, 5]
const BOLT_TEMPLATE = {
  id: BOLT_ID,
  name: 'Bolt',
  description: 'A ranged bolt.',
  levels: [
    {
      cost: 3,
      range: BOLT_RANGE,
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

const spell_templates = normalize_spell_templates([]) // registers MOB_ATTACK_TEMPLATE
spell_templates.set(BOLT_ID, BOLT_TEMPLATE)

// REAL arena shape: Uint8Array cells (0 = walkable) — same shape fight_mechanics.test.js / mob_ai_acts.test.js use.
const flat_arena = (width = 21) => ({
  width,
  height: width,
  radius: (width - 1) / 2,
  center: { x: (width - 1) / 2, y: (width - 1) / 2 },
  cells: new Uint8Array(width * width),
  spawns_a: [
    { x: 1, y: 10 },
    { x: 1, y: 11 },
  ],
  spawns_b: [
    { x: 19, y: 10 },
    { x: 19, y: 11 },
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

const mob = (id, cell, { ap = 6, mp = 4, spell_levels } = {}) => ({
  id,
  name: id,
  cell,
  health: 100,
  health_max: 100,
  ap,
  ap_max: ap,
  mp,
  mp_max: mp,
  ap_used: 0,
  mp_used: 0,
  is_player: false,
  template_id: 'mob',
  level: 1,
  stats: { agility: 0, intelligence: 0, range: 0 },
  effects: [],
  spell_levels: spell_levels ?? { [MOB_ATTACK_ID]: 1 },
  ap_reserve: 0,
})

/** Drive the mob's whole turn from a fresh fight; return the mob's end cell + the player's hp delta + events. */
const resolve_mob_turn = ({ p_cell, m_cell, mob_opts }) => {
  const arena = flat_arena()
  const ctx = { spell_templates, arena }
  let state = create_fight_state({
    fight_id: 'f',
    arena_seed: 1,
    arena_radius: arena.radius,
    arena,
    team0: [player('p0', p_cell)],
    team1: [mob('m0', m_cell, mob_opts)],
  })
  ;({ state } = reduce(state, { type: 'ready', entity_id: 'p0' }, ctx))
  let guard = 0
  for (
    let cur = get_current_turn_entity(state);
    cur && cur.is_player && guard < 4;
    guard += 1
  ) {
    ;({ state } = reduce(state, { type: 'end_turn', entity_id: cur.id }, ctx))
    cur = get_current_turn_entity(state)
  }
  expect(get_current_turn_entity(state)?.id).toBe('m0')
  const hp_before = find_entity(state, 'p0').health
  const { state: after, events } = reduce(
    state,
    { type: 'ai_turn', entity_id: 'm0' },
    ctx,
  )
  const end_cell = find_entity(after, 'm0').cell
  return {
    end_cell,
    end_dist: manhattan_distance(end_cell, p_cell),
    hp_delta: hp_before - find_entity(after, 'p0').health,
    cast: events.some(e => e.type === 'fight_cast'),
    events,
  }
}

describe('#606 mob AI — steps to its range band and attacks', () => {
  test('a ranged mob whose target stands INSIDE its min-range steps OUT to its band and FIRES (never walks into the point-blank dead zone)', () => {
    // Mob at d2 from the player — inside the [3,5] band's min-range (3). The old planner walked to the closest
    // cell (d1, deeper into the dead zone) and could never cast. It must instead step to a band cell and fire.
    const r = resolve_mob_turn({
      p_cell: { x: 10, y: 10 },
      m_cell: { x: 12, y: 10 },
      mob_opts: { spell_levels: { [BOLT_ID]: 1 } },
    })
    expect(r.cast).toBe(true) // it FIRED (RED before: no cast)
    expect(r.hp_delta).toBeGreaterThan(0) // the player actually took damage
    expect(r.end_dist).toBeGreaterThanOrEqual(BOLT_RANGE[0]) // it stepped OUT to >= min-range, not into point-blank
    expect(r.end_dist).toBeLessThanOrEqual(BOLT_RANGE[1]) // and stayed within the band
  })

  test('a ranged mob out of range CLOSES to its band and fires the SAME turn (does not overshoot to point-blank)', () => {
    // Mob at d6 (beyond rmax 5) with mp 4: the min-manhattan walk lands at d2 (inside min-range) — the old planner
    // walked there and whiffed. The fix stops at the closest band cell (d3..5) and fires this turn.
    const r = resolve_mob_turn({
      p_cell: { x: 10, y: 10 },
      m_cell: { x: 16, y: 10 },
      mob_opts: { spell_levels: { [BOLT_ID]: 1 }, mp: 4 },
    })
    expect(r.cast).toBe(true)
    expect(r.hp_delta).toBeGreaterThan(0)
    expect(r.end_dist).toBeGreaterThanOrEqual(BOLT_RANGE[0])
    expect(r.end_dist).toBeLessThanOrEqual(BOLT_RANGE[1])
  })

  test('a MELEE mob adjacent to a player strikes from standing — AP spent on the cast, not wasted on a walk', () => {
    // Mechanism ②: reaching a firing cell with AP remaining ALWAYS fires (the twin of the on-chain
    // adjacent_never_repositions_strikes_from_standing policy proof).
    const r = resolve_mob_turn({
      p_cell: { x: 10, y: 10 },
      m_cell: { x: 11, y: 10 },
    })
    expect(r.cast).toBe(true)
    expect(r.hp_delta).toBeGreaterThan(0)
    expect(r.end_cell).toEqual({ x: 11, y: 10 }) // struck from standing — zero movement
  })

  test('a mob that cannot reach any firing cell this turn advances STRICTLY closer — never a lateral no-op', () => {
    // Mechanism ①: the kite. A melee mob far beyond its reach must END its turn strictly closer to the target
    // (the twin of out_of_reach_advances_monotonically) — never equal-distance / lateral, never idle.
    const start = { x: 18, y: 10 }
    const p_cell = { x: 10, y: 10 }
    const r = resolve_mob_turn({ p_cell, m_cell: start, mob_opts: { mp: 3 } })
    expect(r.end_dist).toBeLessThan(manhattan_distance(start, p_cell)) // strictly closer, not lateral
  })
})
