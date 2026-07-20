// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, test, expect } from 'bun:test'

import { reduce, create_fight_state } from '../src/reduce.js'
import { normalize_spell_templates } from '../src/spell_templates.js'
import { find_entity, generate_turn_order } from '../src/fight_state.js'
import { apply_move } from '../src/fight_actions.js'
import { is_critical } from '../src/spell_calculator.js'
import { rng_seed } from '../src/prng.js'

// Tactical-RPG stat mechanics:
//   - TURN ORDER  -> §17.28 stat-free GLOBAL INTERLEAVE (generate_turn_order; mirrors interleave.move)
//   - AGILITY     -> CRIT (the crit-bonus stat lowers the 1-in-X rate) + TACKLE/lock (apply_move escape roll)
//   - NO-TRAP     -> tackle restricts MOVEMENT only; abandon is ALWAYS available (#62 invariant)

// ── Fixtures ─────────────────────────────────────────────────────────────────
const SPELLS_JSON = {
  senshi: {
    bolt: {
      name: 'Bolt',
      description: 'A ranged fire bolt.',
      levels: [
        {
          cost: 3,
          range: [1, 8],
          critical_chance: 0,
          area: 0,
          area_type: 'circle',
          casts_per_turn: 255,
          casts_per_target: 255,
          cooldown_turns: 0,
          modifiable_range: false,
          line_of_sight: true,
          linear: false,
          free_cell: false,
          base_effects: [
            {
              type: 'damage',
              min: 10,
              max: 10,
              element: 'fire',
              target: 'enemies',
              chance: 100,
            },
          ],
          critical_effects: [],
        },
      ],
    },
  },
}
const spell_templates = normalize_spell_templates(SPELLS_JSON)

const flat_arena = (width = 11) => ({
  width,
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

// A combatant carrying just the fields the turn-order + movement paths read.
const make_entity = (id, cell, stats, overrides = {}) => ({
  id,
  name: id,
  cell,
  health: 30,
  health_max: 30,
  ap: 6,
  ap_max: 6,
  mp: 3,
  mp_max: 3,
  ap_used: 0,
  mp_used: 0,
  is_player: true,
  template_id: 'senshi',
  level: 1,
  stats: { strength: 0, intelligence: 0, chance: 0, agility: 0, ...stats },
  effects: [],
  deck: [],
  hand: [],
  discard: [],
  spell_levels: {},
  ap_reserve: 0,
  ...overrides,
})

// A minimal STARTED state for direct apply_move unit tests (apply_move reads started/teams/rng/entity fields).
const lock_state = (
  seed,
  mover_agi,
  enemy_cells_agi,
  mover_cell = { x: 5, y: 5 },
) => ({
  fight_id: 'lock',
  started: true,
  rng: rng_seed(seed),
  next_id: 1,
  team0: [make_entity('mover', mover_cell, { agility: mover_agi })],
  team1: enemy_cells_agi.map(([cell, agi], i) =>
    make_entity(`e${i}`, cell, { agility: agi }, { is_player: false }),
  ),
  turn_order: [],
  current_turn_idx: 0,
  turn_number: 1,
  traps: [],
  glyphs: [],
  winner: -1,
})

// ── §17.28 GLOBAL INTERLEAVE -> turn order ────────────────────────────────────
// A stat-free deterministic weave of side A (team0 = players, join/seat order) and side B (team1 = mobs,
// spawn order), mirroring the on-chain aresrpg_fight::interleave::order EXACTLY (the sim's reduce()-parity
// contract). No initiative stat; stats NEVER reorder anyone.
describe('§17.28 global interleave turn order', () => {
  const p = (id, stats = {}) => make_entity(id, { x: 1, y: 0 }, stats)
  const m = (id, stats = {}) =>
    make_entity(id, { x: 9, y: 0 }, stats, { is_player: false })

  test('even teams weave strictly A,B,A,B — side A (team0) opens', () => {
    const team0 = [p('p0'), p('p1')]
    const team1 = [m('m0'), m('m1')]
    expect(generate_turn_order(team0, team1)).toEqual(['p0', 'm0', 'p1', 'm1'])
  })

  test('a minority side is centered, never acts twice in a row (2 vs 3)', () => {
    // players 2, mobs 3: the even-distribution rule spreads the players -> M P M P M (players in slots 1,3).
    const team0 = [p('p0'), p('p1')]
    const team1 = [m('m0'), m('m1'), m('m2')]
    expect(generate_turn_order(team0, team1)).toEqual([
      'm0',
      'p0',
      'm1',
      'p1',
      'm2',
    ])
  })

  test('a lone minority lands mid-sequence, not first, not last (1 vs 3)', () => {
    const team0 = [p('hero')]
    const team1 = [m('m0'), m('m1'), m('m2')]
    expect(generate_turn_order(team0, team1)).toEqual([
      'm0',
      'hero',
      'm1',
      'm2',
    ])
  })

  test('stats never reorder — join/seat order is the only within-side tiebreak', () => {
    // PARITY REGRESSION (the dead-initiative divergence): p0/p1 differ wildly in the old "offensive
    // primaries" and the mobs out-stat both players. The retired formula would have (a) let team1 lead on
    // higher AVERAGE initiative and (b) sorted p1 ahead of p0 by initiative DESC -> ['m0','p1','m1','p0'].
    // The chain interleave ignores stats: side A (players) opens in JOIN order -> ['p0','m0','p1','m1'].
    const team0 = [p('p0', { agility: 10 }), p('p1', { agility: 20 })]
    const team1 = [m('m0', { agility: 90 }), m('m1', { agility: 80 })]
    expect(generate_turn_order(team0, team1)).toEqual(['p0', 'm0', 'p1', 'm1'])
  })

  test('an empty opposing side drains the other in order', () => {
    expect(generate_turn_order([p('p0'), p('p1')], [])).toEqual(['p0', 'p1'])
    expect(generate_turn_order([], [m('m0'), m('m1')])).toEqual(['m0', 'm1'])
  })

  test('deterministic — identical inputs yield the identical queue', () => {
    const t0 = [p('p0'), p('p1'), p('p2')]
    const t1 = [m('m0'), m('m1')]
    expect(generate_turn_order(t0, t1)).toEqual(generate_turn_order(t0, t1))
  })
})

// ── AGILITY -> TACKLE / lock ───────────────────────────────────────────────────
describe('tackle / lock (agility escape roll)', () => {
  const run_many = (mover_agi, enemies, seeds = 200) => {
    let escaped = 0
    let tackled = 0
    let sample_tackle = null
    for (let seed = 1; seed <= seeds; seed++) {
      const state = lock_state(seed, mover_agi, enemies)
      const res = apply_move(state, 'mover', [
        { x: 5, y: 5 },
        { x: 6, y: 5 },
      ])
      if (res.success) escaped++
      if (res.tackled) {
        tackled++
        if (!sample_tackle) sample_tackle = res
      }
    }
    return { escaped, tackled, sample_tackle }
  }

  test('no adjacent enemy -> never tackled (free movement)', () => {
    const state = lock_state(1, 0, [[{ x: 0, y: 0 }, 100]]) // enemy far away
    const res = apply_move(state, 'mover', [
      { x: 5, y: 5 },
      { x: 6, y: 5 },
    ])
    expect(res.success).toBe(true)
    expect(find_entity(res.state, 'mover')?.cell).toEqual({ x: 6, y: 5 })
  })

  test('overwhelming agility escapes a weak lock every time (P >= 1)', () => {
    // mover dodge = floor(1000/10)+2 = 102; enemy lock = 2, den = 4 -> escape_num capped at den -> P = 1.
    const { escaped, tackled } = run_many(1000, [[{ x: 4, y: 5 }, 0]])
    expect(escaped).toBe(200)
    expect(tackled).toBe(0)
  })

  test('a strong lock restricts movement: mostly tackled, AP/MP lost, position held', () => {
    // mover dodge 2 vs enemy lock 102 -> P = 2/204, almost always caught.
    const { escaped, tackled, sample_tackle } = run_many(0, [
      [{ x: 4, y: 5 }, 1000],
    ])
    expect(tackled).toBeGreaterThan(180)
    expect(escaped).toBeLessThan(20)
    // a caught move is DENIED and burns resources (movement restricted, never a move + a free escape)
    const caught = find_entity(sample_tackle.state, 'mover')
    expect(sample_tackle.success).toBe(false)
    expect(caught?.cell).toEqual({ x: 5, y: 5 }) // did not move
    expect(caught?.mp).toBeLessThan(3) // lost MP
  })

  test('MORE lockers = harder escape (the product-of-chances rule)', () => {
    // mover agi 10 (dodge 3); each enemy agi 10 (lock 3, den 6). single P = 3/6; two-lock P = 9/36.
    const single = run_many(10, [[{ x: 4, y: 5 }, 10]])
    const double = run_many(10, [
      [{ x: 4, y: 5 }, 10],
      [{ x: 5, y: 4 }, 10],
    ])
    expect(double.escaped).toBeLessThan(single.escaped)
    expect(single.escaped).toBeGreaterThan(0)
    expect(double.escaped).toBeGreaterThan(0)
  })
})

// ── NO-TRAP invariant: abandon is ALWAYS available, even while locked (#62) ─────
describe('no-trap: tackle never gates abandon', () => {
  test('a fully-locked fighter whose move is denied can STILL abandon', () => {
    const arena = flat_arena()
    const ctx = { spell_templates, arena }
    // mover hemmed in by a max-agility enemy on every cardinal side -> escape is near-impossible.
    const mover = make_entity('hero', { x: 5, y: 5 }, { agility: 0 })
    const enemies = [
      [4, 5],
      [6, 5],
      [5, 4],
      [5, 6],
    ].map(([x, y], i) =>
      make_entity(`g${i}`, { x, y }, { agility: 1000 }, { is_player: false }),
    )
    const base = create_fight_state({
      fight_id: 'trap',
      arena_seed: 42,
      arena_radius: arena.radius,
      arena,
      team0: [mover],
      team1: enemies,
    })
    const started = reduce(base, { type: 'start' }, ctx).state
    // confirm the mover is the current actor, then prove abandon works no matter the lock.
    const r = reduce(started, { type: 'abandon', entity_id: 'hero' }, ctx)
    expect(find_entity(r.state, 'hero')?.health).toBe(0)
    expect(r.state.winner).toBe(1) // team0 wiped -> team1 wins; the player always escaped the fight
  })
})

// ── AGILITY -> CRIT (the crit-bonus stat lowers the 1-in-X rate) ────────────────
describe('crit (agility-derived crit-bonus raises the crit rate)', () => {
  const crit_count = crit_bonus => {
    let crits = 0
    for (let seed = 1; seed <= 600; seed++) {
      const { value } = is_critical(rng_seed(seed), 30, crit_bonus)
      if (value) crits++
    }
    return crits
  }

  test('a higher crit-bonus yields strictly more crits (1/30 -> ~1/10)', () => {
    const base = crit_count(0) // effective 1/30
    const boosted = crit_count(20) // effective 1/10
    expect(boosted).toBeGreaterThan(base)
  })

  test('zero base crit chance never crits regardless of bonus', () => {
    expect(is_critical(rng_seed(1), 0, 50).value).toBe(false)
  })
})
