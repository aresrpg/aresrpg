// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, test, expect } from 'bun:test'

import { reduce, create_fight_state } from '../src/reduce.js'
import { normalize_spell_templates } from '../src/spell_templates.js'
import { find_entity, get_current_turn_entity } from '../src/fight_state.js'

// ── Fixtures ─────────────────────────────────────────────────────────────────
// Flat all-walkable arena; the reducer reads terrain + fresh occupancy, never arena.spawns for movement.
const flat_arena = (width = 9) => ({
  width,
  radius: (width - 1) / 2,
  center: { x: (width - 1) / 2, y: (width - 1) / 2 },
  cells: new Uint8Array(width * width),
  spawns_a: [
    { x: 1, y: 4 },
    { x: 1, y: 5 },
  ],
  spawns_b: [
    { x: 7, y: 4 },
    { x: 7, y: 5 },
  ],
})

// Spell set in AresRPG JSON shape, fed through the real normalizer:
//   bolt   — ranged single-target, FIXED 10 dmg (no range, no crit) — used for deterministic asserts.
//   rngbolt— ranged single-target, damage RANGE 1..40 — different seeds roll different damage.
//   critbolt— ranged, critical_chance 1 (always crits) vs critical_chance huge — used for crit divergence.
//   blast  — ranged AoE circle radius 1 (5-cell diamond), fixed 10 dmg — proves every in-AoE cell is hit.
//   close  — melee range [1,1] fixed 10 dmg — proves out-of-range rejection.
const SPELLS_JSON = {
  senshi: {
    bolt: {
      name: 'Bolt',
      description: 'fixed ranged',
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
    rngbolt: {
      name: 'RngBolt',
      description: 'variable ranged',
      levels: [
        {
          cost: 2,
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
              min: 1,
              max: 40,
              element: 'fire',
              target: 'enemies',
              chance: 100,
            },
          ],
          critical_effects: [],
        },
      ],
    },
    blast: {
      name: 'Blast',
      description: 'aoe circle r1',
      levels: [
        {
          cost: 4,
          range: [1, 8],
          critical_chance: 0,
          area: 1,
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
    close: {
      name: 'Close',
      description: 'melee only',
      levels: [
        {
          cost: 2,
          range: [1, 1],
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

const ALL_SPELLS = ['bolt', 'rngbolt', 'blast', 'close']

const make_entity = (id, cell, is_player, overrides = {}) => ({
  id,
  name: id,
  cell,
  health: 100,
  health_max: 100,
  ap: 10,
  ap_max: 10,
  mp: 3,
  mp_max: 3,
  ap_used: 0,
  mp_used: 0,
  is_player,
  template_id: 'senshi',
  level: 1,
  stats: { agility: 0, intelligence: 0, range: 0 },
  effects: [],
  // Players draw from a deck; mobs come pre-handed. Give the full spell list either way.
  deck: is_player ? [...ALL_SPELLS] : [],
  hand: is_player ? [] : [...ALL_SPELLS],
  discard: [],
  spell_levels: { bolt: 1, rngbolt: 1, blast: 1, close: 1 },
  ap_reserve: 0,
  ...overrides,
})

// A started 1v1 fight (player at p_cell, mob at m_cell). Player hand is the full deck (4 spells <= hand cap).
const started_fight = (seed, { p_cell, m_cell, arena, mob_overrides } = {}) => {
  const a = arena ?? flat_arena()
  const ctx = { spell_templates, arena: a }
  const team0 = [make_entity('p0', p_cell ?? { x: 1, y: 4 }, true)]
  const team1 = [
    make_entity('m0', m_cell ?? { x: 7, y: 4 }, false, mob_overrides ?? {}),
  ]
  const base = create_fight_state({
    fight_id: 'f',
    arena_seed: seed,
    arena_radius: a.radius,
    arena: a,
    team0,
    team1,
  })
  const { state } = reduce(base, { type: 'start' }, ctx)
  return { state, ctx }
}

const run_sequence = (state, ctx, commands) =>
  commands.reduce(
    (acc, cmd) => {
      const r = reduce(acc.state, cmd, ctx)
      return { state: r.state, events: [...acc.events, ...r.events] }
    },
    { state, events: [] },
  )

// Structural invariants every valid post-command state must satisfy.
const assert_state_valid = state => {
  for (const e of [...state.team0, ...state.team1]) {
    expect(e.health).toBeGreaterThanOrEqual(0)
    expect(e.health).toBeLessThanOrEqual(e.health_max)
    expect(e.ap).toBeGreaterThanOrEqual(0)
    expect(e.ap).toBeLessThanOrEqual(e.ap_max)
    expect(e.mp).toBeGreaterThanOrEqual(0)
    expect(e.mp).toBeLessThanOrEqual(e.mp_max)
    expect(Number.isInteger(e.health)).toBe(true)
    expect(Number.isInteger(e.ap)).toBe(true)
    expect(Number.isInteger(e.mp)).toBe(true)
    // never two living actors on one cell
    const here = [...state.team0, ...state.team1].filter(
      o => o.health > 0 && o.cell.x === e.cell.x && o.cell.y === e.cell.y,
    )
    if (e.health > 0) expect(here.length).toBe(1)
  }
  // turn index in bounds
  expect(state.current_turn_idx).toBeGreaterThanOrEqual(0)
  if (state.turn_order.length > 0)
    expect(state.current_turn_idx).toBeLessThan(state.turn_order.length)
}

// ── DETERMINISM ────────────────────────────────────────────────────────────
describe('determinism', () => {
  const commands = [
    { type: 'move', entity_id: 'p0', path: [{ x: 2, y: 4 }] },
    {
      type: 'cast',
      entity_id: 'p0',
      spell_id: 'rngbolt',
      target: { x: 7, y: 4 },
    },
    { type: 'cast', entity_id: 'p0', spell_id: 'bolt', target: { x: 7, y: 4 } },
    { type: 'end_turn', entity_id: 'p0' },
    { type: 'ai_turn', entity_id: 'm0' },
  ]

  test('same seed + same commands -> deep-equal {state, events} (run twice)', () => {
    const a = (() => {
      const { state, ctx } = started_fight(424242)
      return run_sequence(state, ctx, commands)
    })()
    const b = (() => {
      const { state, ctx } = started_fight(424242)
      return run_sequence(state, ctx, commands)
    })()
    // deep equality (not just stringify) on the full result
    expect(a.state).toEqual(b.state)
    expect(a.events).toEqual(b.events)
    // and the rng thread itself ended identically
    expect(a.state.rng).toBe(b.state.rng)
  })

  test('different seed -> different rngbolt damage roll', () => {
    // find two seeds that diverge — across many seeds the variable roll MUST differ at least once.
    const dmg_for = seed => {
      const { state, ctx } = started_fight(seed)
      const r = reduce(
        state,
        {
          type: 'cast',
          entity_id: 'p0',
          spell_id: 'rngbolt',
          target: { x: 7, y: 4 },
        },
        ctx,
      )
      return find_entity(r.state, 'm0').health
    }
    const samples = [1, 2, 3, 4, 5, 6, 7, 8].map(dmg_for)
    const distinct = new Set(samples)
    // a 1..40 roll across 8 seeds cannot collapse to a single value if the seed actually drives the rng
    expect(distinct.size).toBeGreaterThan(1)
  })

  test('different seed -> different draw (opening hand order can diverge)', () => {
    // a player with a 6-card deck draws a 5-card opening hand; the draw is seed-shuffled.
    const big_deck = ['bolt', 'rngbolt', 'blast', 'close', 'bolt', 'rngbolt']
    const hand_for = seed => {
      const arena = flat_arena()
      const ctx = { spell_templates, arena }
      const team0 = [
        make_entity('p0', { x: 1, y: 4 }, true, {
          deck: [...big_deck],
          hand: [],
        }),
      ]
      const team1 = [make_entity('m0', { x: 7, y: 4 }, false)]
      const base = create_fight_state({
        fight_id: 'f',
        arena_seed: seed,
        arena_radius: arena.radius,
        arena,
        team0,
        team1,
      })
      const { state } = reduce(base, { type: 'start' }, ctx)
      return find_entity(state, 'p0').hand.join(',')
    }
    const hands = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(hand_for))
    expect(hands.size).toBeGreaterThan(1)
  })
})

// ── MOVEMENT + PATHFINDING ───────────────────────────────────────────────────
describe('movement', () => {
  test('valid path updates position and spends MP', () => {
    const { state, ctx } = started_fight(1)
    const r = reduce(
      state,
      {
        type: 'move',
        entity_id: 'p0',
        path: [
          { x: 2, y: 4 },
          { x: 3, y: 4 },
        ],
      },
      ctx,
    )
    expect(find_entity(r.state, 'p0').cell).toEqual({ x: 3, y: 4 })
    expect(find_entity(r.state, 'p0').mp).toBe(1) // 3 - 2
    expect(r.events[0].type).toBe('fight_moved')
    expect(r.events[0].mp_remaining).toBe(1)
  })

  test('a path through a terrain obstacle is rejected (state unchanged)', () => {
    const arena = flat_arena()
    arena.cells[4 * arena.width + 3] = 1 // wall at (3,4)
    const { state, ctx } = started_fight(1, { arena })
    const r = reduce(
      state,
      {
        type: 'move',
        entity_id: 'p0',
        path: [
          { x: 2, y: 4 },
          { x: 3, y: 4 }, // steps onto the wall
        ],
      },
      ctx,
    )
    expect(find_entity(r.state, 'p0').cell).toEqual({ x: 1, y: 4 })
    expect(find_entity(r.state, 'p0').mp).toBe(3)
    expect(r.events.length).toBe(0)
  })

  test('an out-of-budget destination is rejected even when caller intermediates are omitted', () => {
    const { state, ctx } = started_fight(1)
    const r = reduce(
      state,
      { type: 'move', entity_id: 'p0', path: [{ x: 5, y: 4 }] },
      ctx,
    )
    expect(find_entity(r.state, 'p0').cell).toEqual({ x: 1, y: 4 })
    expect(r.events.length).toBe(0)
  })

  test('a path onto another living actor is rejected (occupancy fresh, not baked)', () => {
    // mob sits at (3,4); player tries to walk onto it.
    const { state, ctx } = started_fight(1, { m_cell: { x: 3, y: 4 } })
    const r = reduce(
      state,
      {
        type: 'move',
        entity_id: 'p0',
        path: [
          { x: 2, y: 4 },
          { x: 3, y: 4 },
        ],
      },
      ctx,
    )
    expect(find_entity(r.state, 'p0').cell).toEqual({ x: 1, y: 4 })
    expect(r.events.length).toBe(0)
  })

  test('AI routes around an obstacle wall to close on the player', () => {
    // Vertical wall x=4 for y in 3..5 between mob(7,4) and player(1,4). The AI must detour (y=2 or y=6)
    // around it — a straight 4-dir route is blocked, so the mob ends up off the y=4 lane.
    const arena = flat_arena()
    for (const y of [3, 4, 5]) arena.cells[y * arena.width + 4] = 1
    const { state, ctx } = started_fight(1, {
      arena,
      m_cell: { x: 6, y: 4 },
      mob_overrides: { mp: 4 },
    })
    const { state: mob_turn } = reduce(
      state,
      { type: 'end_turn', entity_id: 'p0' },
      ctx,
    )
    const r = reduce(mob_turn, { type: 'ai_turn', entity_id: 'm0' }, ctx)
    const mob = find_entity(r.state, 'm0')
    // it moved, never stepped on the wall column at the blocked rows, and got closer
    expect(r.events.map(e => e.type)).toContain('fight_moved')
    const on_wall =
      mob.cell.x === 4 &&
      (mob.cell.y === 3 || mob.cell.y === 4 || mob.cell.y === 5)
    expect(on_wall).toBe(false)
    assert_state_valid(r.state)
  })
})

// ── LINE OF SIGHT ────────────────────────────────────────────────────────────
describe('line of sight', () => {
  test('target in LoS is castable; behind an obstacle is not', () => {
    // open: cast lands
    {
      const { state, ctx } = started_fight(1)
      const r = reduce(
        state,
        {
          type: 'cast',
          entity_id: 'p0',
          spell_id: 'bolt',
          target: { x: 7, y: 4 },
        },
        ctx,
      )
      expect(find_entity(r.state, 'm0').health).toBe(90)
      expect(r.events.map(e => e.type)).toContain('fight_cast')
    }
    // wall interposed: cast rejected, no damage, no events
    {
      const arena = flat_arena()
      arena.cells[4 * arena.width + 4] = 1 // wall between (1,4) and (7,4)
      const { state, ctx } = started_fight(1, { arena })
      const r = reduce(
        state,
        {
          type: 'cast',
          entity_id: 'p0',
          spell_id: 'bolt',
          target: { x: 7, y: 4 },
        },
        ctx,
      )
      expect(find_entity(r.state, 'm0').health).toBe(100)
      expect(r.events.length).toBe(0)
    }
  })

  test('an interposing living actor blocks LoS', () => {
    // 3-team-ish: put a second mob between caster and target. We model it as moving the only mob in the
    // way and adding a blocker via a 2v on team1.
    const arena = flat_arena()
    const ctx = { spell_templates, arena }
    const team0 = [make_entity('p0', { x: 1, y: 4 }, true)]
    const team1 = [
      make_entity('blk', { x: 4, y: 4 }, false), // interposed blocker
      make_entity('m0', { x: 7, y: 4 }, false),
    ]
    const base = create_fight_state({
      fight_id: 'f',
      arena_seed: 1,
      arena_radius: arena.radius,
      arena,
      team0,
      team1,
    })
    const { state } = reduce(base, { type: 'start' }, ctx)
    const r = reduce(
      state,
      {
        type: 'cast',
        entity_id: 'p0',
        spell_id: 'bolt',
        target: { x: 7, y: 4 },
      },
      ctx,
    )
    expect(find_entity(r.state, 'm0').health).toBe(100) // blocked by 'blk'
    expect(r.events.length).toBe(0)
  })
})

// ── SPELL CAST ────────────────────────────────────────────────────────────────
describe('spell cast', () => {
  test('spends the spell AP, deals damage in [min,max], discards', () => {
    const { state, ctx } = started_fight(99)
    const before_ap = find_entity(state, 'p0').ap
    const r = reduce(
      state,
      {
        type: 'cast',
        entity_id: 'p0',
        spell_id: 'rngbolt',
        target: { x: 7, y: 4 },
      },
      ctx,
    )
    const caster = find_entity(r.state, 'p0')
    const mob = find_entity(r.state, 'm0')
    expect(caster.ap).toBe(before_ap - 2) // rngbolt costs 2
    const dealt = 100 - mob.health
    expect(dealt).toBeGreaterThanOrEqual(1) // min
    expect(dealt).toBeLessThanOrEqual(40) // max
    expect(caster.hand).not.toContain('rngbolt')
    expect(caster.discard).toContain('rngbolt')
  })

  test('AoE hits every enemy standing in the blast diamond', () => {
    // blast = circle r1 around target (5-cell diamond). Put two mobs inside it: (7,4) and (7,5).
    const arena = flat_arena()
    const ctx = { spell_templates, arena }
    // §17.28 interleave: a LONE player vs 2 mobs lets a MOB open (parity with interleave.move). An idle
    // empty-deck ally makes team0 == team1 size so side A's p0 opens — the cast under test lands turn 1.
    const team0 = [
      make_entity('p0', { x: 1, y: 4 }, true),
      make_entity('ally', { x: 1, y: 1 }, true, { deck: [] }),
    ]
    const team1 = [
      make_entity('m0', { x: 7, y: 4 }, false), // target cell
      make_entity('m1', { x: 7, y: 5 }, false), // adjacent -> inside r1 diamond
    ]
    const base = create_fight_state({
      fight_id: 'f',
      arena_seed: 1,
      arena_radius: arena.radius,
      arena,
      team0,
      team1,
    })
    const { state } = reduce(base, { type: 'start' }, ctx)
    const r = reduce(
      state,
      {
        type: 'cast',
        entity_id: 'p0',
        spell_id: 'blast',
        target: { x: 7, y: 4 },
      },
      ctx,
    )
    expect(find_entity(r.state, 'm0').health).toBe(90) // both took 10
    expect(find_entity(r.state, 'm1').health).toBe(90)
    const cast_evt = r.events.find(e => e.type === 'fight_cast')
    expect(cast_evt.effects.length).toBe(2) // two targets hit
  })

  test('an enemy OUTSIDE the AoE diamond is untouched', () => {
    const arena = flat_arena()
    const ctx = { spell_templates, arena }
    const team0 = [
      make_entity('p0', { x: 1, y: 4 }, true),
      make_entity('ally', { x: 1, y: 1 }, true, { deck: [] }), // idle -> even teams, p0 opens (§17.28)
    ]
    const team1 = [
      make_entity('m0', { x: 7, y: 4 }, false),
      make_entity('m1', { x: 7, y: 6 }, false), // 2 cells from target -> outside r1
    ]
    const base = create_fight_state({
      fight_id: 'f',
      arena_seed: 1,
      arena_radius: arena.radius,
      arena,
      team0,
      team1,
    })
    const { state } = reduce(base, { type: 'start' }, ctx)
    const r = reduce(
      state,
      {
        type: 'cast',
        entity_id: 'p0',
        spell_id: 'blast',
        target: { x: 7, y: 4 },
      },
      ctx,
    )
    expect(find_entity(r.state, 'm0').health).toBe(90)
    expect(find_entity(r.state, 'm1').health).toBe(100) // outside the diamond
  })

  test('cast out of range is rejected', () => {
    // close = melee range [1,1]; mob is 6 cells away.
    const { state, ctx } = started_fight(1)
    const r = reduce(
      state,
      {
        type: 'cast',
        entity_id: 'p0',
        spell_id: 'close',
        target: { x: 7, y: 4 },
      },
      ctx,
    )
    expect(find_entity(r.state, 'm0').health).toBe(100)
    expect(find_entity(r.state, 'p0').ap).toBe(10) // no AP spent
    expect(r.events.length).toBe(0)
  })

  test('cast with insufficient AP is rejected', () => {
    // give the player only 3 AP; blast costs 4.
    const { state, ctx } = started_fight(1, {})
    const low = {
      ...state,
      team0: state.team0.map(e => ({ ...e, ap: 3 })),
    }
    const r = reduce(
      low,
      {
        type: 'cast',
        entity_id: 'p0',
        spell_id: 'blast',
        target: { x: 7, y: 4 },
      },
      ctx,
    )
    expect(find_entity(r.state, 'm0').health).toBe(100)
    expect(find_entity(r.state, 'p0').ap).toBe(3) // untouched
    expect(r.events.length).toBe(0)
  })

  test('cast by a non-active entity is rejected', () => {
    const { state, ctx } = started_fight(1)
    // it's p0's turn; m0 tries to act
    const r = reduce(
      state,
      {
        type: 'cast',
        entity_id: 'm0',
        spell_id: 'bolt',
        target: { x: 1, y: 4 },
      },
      ctx,
    )
    expect(find_entity(r.state, 'p0').health).toBe(100)
    expect(r.events.length).toBe(0)
  })
})

// ── TURN CYCLE + AI ────────────────────────────────────────────────────────────
describe('turn cycle + AI', () => {
  test('end_turn advances to the next fighter and emits start/end', () => {
    const { state, ctx } = started_fight(1)
    expect(get_current_turn_entity(state).id).toBe('p0')
    const r = reduce(state, { type: 'end_turn', entity_id: 'p0' }, ctx)
    expect(get_current_turn_entity(r.state).id).toBe('m0')
    expect(r.events.map(e => e.type)).toContain('fight_turn_end')
    expect(r.events.map(e => e.type)).toContain('fight_turn_start')
  })

  test('end_turn from the non-active fighter is a no-op', () => {
    const { state, ctx } = started_fight(1)
    const r = reduce(state, { type: 'end_turn', entity_id: 'm0' }, ctx)
    expect(get_current_turn_entity(r.state).id).toBe('p0') // unchanged
    expect(r.events.length).toBe(0)
  })

  test('AI takes a sensible turn (acts), leaves valid state, returns the turn', () => {
    const { state, ctx } = started_fight(7)
    const { state: mob_turn } = reduce(
      state,
      { type: 'end_turn', entity_id: 'p0' },
      ctx,
    )
    const r = reduce(mob_turn, { type: 'ai_turn', entity_id: 'm0' }, ctx)
    // in-range mob with a ranged bolt should cast and damage the player
    expect(find_entity(r.state, 'p0').health).toBeLessThan(100)
    expect(r.events.map(e => e.type)).toContain('fight_cast')
    // turn returns to the player and the state is structurally valid
    expect(get_current_turn_entity(r.state).id).toBe('p0')
    assert_state_valid(r.state)
  })

  test('full round (player acts -> AI acts) keeps state valid', () => {
    const { state, ctx } = started_fight(31337)
    const r = run_sequence(state, ctx, [
      { type: 'move', entity_id: 'p0', path: [{ x: 2, y: 4 }] },
      {
        type: 'cast',
        entity_id: 'p0',
        spell_id: 'bolt',
        target: { x: 7, y: 4 },
      },
      { type: 'end_turn', entity_id: 'p0' },
      { type: 'ai_turn', entity_id: 'm0' },
    ])
    assert_state_valid(r.state)
    // a turn boundary closed and reopened
    expect(r.events.map(e => e.type)).toContain('fight_turn_start')
  })
})

// ── WIN / LOSE ───────────────────────────────────────────────────────────────
describe('win / lose', () => {
  test('reducing team1 to 0 hp ends the fight with winner 0', () => {
    const { state, ctx } = started_fight(1, {
      mob_overrides: { health: 10, health_max: 10 },
    })
    const r = reduce(
      state,
      {
        type: 'cast',
        entity_id: 'p0',
        spell_id: 'bolt',
        target: { x: 7, y: 4 },
      },
      ctx,
    )
    expect(find_entity(r.state, 'm0').health).toBe(0)
    expect(r.state.winner).toBe(0)
    const ended = r.events.find(e => e.type === 'fight_ended')
    expect(ended).toBeDefined()
    expect(ended.winner).toBe(0)
  })

  test('a wiped player team yields winner 1 (mob AI finishes the player)', () => {
    // player at 1 hp; hand the mob a turn and let the AI kill them.
    const arena = flat_arena()
    const ctx = { spell_templates, arena }
    const team0 = [
      make_entity('p0', { x: 6, y: 4 }, true, { health: 1, health_max: 1 }),
    ]
    const team1 = [make_entity('m0', { x: 7, y: 4 }, false)]
    const base = create_fight_state({
      fight_id: 'f',
      arena_seed: 1,
      arena_radius: arena.radius,
      arena,
      team0,
      team1,
    })
    const { state } = reduce(base, { type: 'start' }, ctx)
    const { state: mob_turn } = reduce(
      state,
      { type: 'end_turn', entity_id: 'p0' },
      ctx,
    )
    const r = reduce(mob_turn, { type: 'ai_turn', entity_id: 'm0' }, ctx)
    expect(find_entity(r.state, 'p0').health).toBe(0)
    expect(r.state.winner).toBe(1)
    expect(r.events.map(e => e.type)).toContain('fight_ended')
  })

  test('fight_ended is emitted exactly once (no double-fire on a later command)', () => {
    const { state, ctx } = started_fight(1, {
      mob_overrides: { health: 10, health_max: 10 },
    })
    const first = reduce(
      state,
      {
        type: 'cast',
        entity_id: 'p0',
        spell_id: 'bolt',
        target: { x: 7, y: 4 },
      },
      ctx,
    )
    expect(first.events.filter(e => e.type === 'fight_ended').length).toBe(1)
    // any further command on a won fight must not re-emit fight_ended
    const second = reduce(
      first.state,
      { type: 'end_turn', entity_id: 'p0' },
      ctx,
    )
    expect(second.events.filter(e => e.type === 'fight_ended').length).toBe(0)
  })
})
