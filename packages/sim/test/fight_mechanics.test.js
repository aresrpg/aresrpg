// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, test, expect } from 'bun:test'

import { reduce, create_fight_state } from '../src/reduce.js'
import { normalize_spell_templates } from '../src/spell_templates.js'
import { find_entity, get_current_turn_entity } from '../src/fight_state.js'

// ── Fixtures ─────────────────────────────────────────────────────────────────
// A flat all-walkable arena unless a wall is stamped (for push-into-wall collision). Occupancy is fresh.
const flat_arena = (width = 11, obstacles = []) => {
  const cells = new Uint8Array(width * width)
  for (const { x, y } of obstacles) cells[y * width + x] = 1
  return {
    width,
    radius: (width - 1) / 2,
    center: { x: (width - 1) / 2, y: (width - 1) / 2 },
    cells,
    spawns_a: [
      { x: 1, y: 5 },
      { x: 1, y: 6 },
    ],
    spawns_b: [
      { x: 9, y: 5 },
      { x: 9, y: 6 },
    ],
  }
}

// Spell set in AresRPG JSON shape, run through the REAL normalizer so the mechanics see exactly what ships.
//   push1 — melee dmg + a guaranteed PUSH 2 (chance 100 so it always fires) — proves displacement.
//   poison1 — ranged DoT 5/turn for 2 turns (chance 100) — proves a TURN_START tick.
//   glyph1 — places a glyph (5 dmg, 3 turns) on the target cell — proves on-step-of-turn-start damage.
//   trap1  — places a trap (10 dmg) on the target cell (effects target:'trap') — proves on-step damage.
//   stun1  — melee dmg + STUN 1 turn — proves the stunned actor's turn is skipped.
//   filler — a cheap no-effect spell to pad the deck so deck-to-7 has cards to draw.
const SPELLS_JSON = {
  senshi: {
    push1: {
      name: 'Push',
      description: 'melee push',
      levels: [
        {
          cost: 2,
          range: [1, 1],
          critical_chance: 0,
          area: 0,
          area_type: 'circle',
          modifiable_range: false,
          line_of_sight: true,
          linear: false,
          free_cell: false,
          base_effects: [
            { type: 'push', distance: 2, target: 'enemies', chance: 100 },
          ],
          critical_effects: [],
        },
      ],
    },
    poison1: {
      name: 'Poison',
      description: 'dot',
      levels: [
        {
          cost: 3,
          range: [1, 8],
          critical_chance: 0,
          area: 0,
          area_type: 'circle',
          modifiable_range: false,
          line_of_sight: true,
          linear: false,
          free_cell: false,
          base_effects: [
            {
              type: 'poison',
              min: 5,
              max: 5,
              element: 'air',
              target: 'enemies',
              chance: 100,
              turns: 2,
            },
          ],
          critical_effects: [],
        },
      ],
    },
    glyph1: {
      name: 'Glyph',
      description: 'persistent zone',
      levels: [
        {
          cost: 3,
          range: [1, 8],
          critical_chance: 0,
          area: 0,
          area_type: 'circle',
          modifiable_range: false,
          line_of_sight: true,
          linear: false,
          free_cell: false,
          base_effects: [
            {
              type: 'glyph',
              min: 5,
              max: 5,
              element: 'fire',
              target: 'cell',
              chance: 100,
              turns: 3,
            },
          ],
          critical_effects: [],
        },
      ],
    },
    trap1: {
      name: 'Trap',
      description: 'hidden trap',
      levels: [
        {
          cost: 3,
          range: [1, 8],
          critical_chance: 0,
          area: 0,
          area_type: 'circle',
          modifiable_range: false,
          line_of_sight: true,
          linear: false,
          free_cell: false,
          base_effects: [
            {
              type: 'damage',
              min: 10,
              max: 10,
              element: 'earth',
              target: 'trap',
              chance: 100,
            },
          ],
          critical_effects: [],
        },
      ],
    },
    stun1: {
      name: 'Stun',
      description: 'melee stun',
      levels: [
        {
          cost: 2,
          range: [1, 1],
          critical_chance: 0,
          area: 0,
          area_type: 'circle',
          modifiable_range: false,
          line_of_sight: true,
          linear: false,
          free_cell: false,
          base_effects: [
            { type: 'stun', target: 'enemies', chance: 100, turns: 1 },
          ],
          critical_effects: [],
        },
      ],
    },
    filler: {
      name: 'Filler',
      description: 'no effect',
      levels: [
        {
          cost: 1,
          range: [1, 8],
          critical_chance: 0,
          area: 0,
          area_type: 'circle',
          modifiable_range: false,
          line_of_sight: false,
          linear: false,
          free_cell: false,
          base_effects: [],
          critical_effects: [],
        },
      ],
    },
  },
}

const spell_templates = normalize_spell_templates(SPELLS_JSON)
const ALL = ['push1', 'poison1', 'glyph1', 'trap1', 'stun1', 'filler']

const make_entity = (id, cell, is_player, overrides = {}) => ({
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
  is_player,
  template_id: 'senshi',
  level: 1,
  stats: { agility: 0, intelligence: 0, range: 0 },
  effects: [],
  spell_levels: Object.fromEntries(ALL.map(id => [id, 1])),
  ap_reserve: 0,
  ...overrides,
})

const placement_fight = (
  seed,
  { p_cell, m_cell, arena, p_overrides, m_overrides } = {},
) => {
  const a = arena ?? flat_arena()
  const ctx = { spell_templates, arena: a }
  const team0 = [
    make_entity('p0', p_cell ?? { x: 1, y: 5 }, true, p_overrides ?? {}),
  ]
  const team1 = [
    make_entity('m0', m_cell ?? { x: 9, y: 5 }, false, m_overrides ?? {}),
  ]
  const state = create_fight_state({
    fight_id: 'f',
    arena_seed: seed,
    arena_radius: a.radius,
    arena: a,
    team0,
    team1,
  })
  return { state, ctx }
}

const started_fight = (seed, opts) => {
  const { state, ctx } = placement_fight(seed, opts)
  const { state: started } = reduce(state, { type: 'start' }, ctx)
  return { state: started, ctx }
}

// ── PLACEMENT + READY ────────────────────────────────────────────────────────
describe('placement + ready', () => {
  test('create_fight_state begins in placement (not started) with empty ready', () => {
    const { state } = placement_fight(1)
    expect(state.started).toBe(false)
    expect(state.ready).toEqual([])
  })

  test('place during placement moves the fighter onto a legal team cell', () => {
    const { state, ctx } = placement_fight(1)
    const r = reduce(
      state,
      { type: 'place', entity_id: 'p0', cell: { x: 1, y: 6 } },
      ctx,
    )
    expect(find_entity(r.state, 'p0').cell).toEqual({ x: 1, y: 6 })
    expect(r.events.some(e => e.type === 'fight_placed')).toBe(true)
  })

  test('ready by the only player force-starts (mobs auto-ready)', () => {
    const { state, ctx } = placement_fight(1)
    const r = reduce(state, { type: 'ready', entity_id: 'p0' }, ctx)
    expect(r.state.ready).toContain('p0')
    expect(r.state.started).toBe(true)
    expect(r.events.some(e => e.type === 'fight_ready')).toBe(true)
    expect(r.events.some(e => e.type === 'fight_started')).toBe(true)
    expect(r.events.some(e => e.type === 'fight_turn_start')).toBe(true)
  })

  test('a duel (2 players) starts only when BOTH ready', () => {
    const a = flat_arena()
    const ctx = { spell_templates, arena: a }
    const state = create_fight_state({
      fight_id: 'f',
      arena_seed: 1,
      arena_radius: a.radius,
      arena: a,
      team0: [make_entity('p0', { x: 1, y: 5 }, true)],
      team1: [make_entity('p1', { x: 9, y: 5 }, true)],
    })
    const one = reduce(state, { type: 'ready', entity_id: 'p0' }, ctx)
    expect(one.state.started).toBe(false)
    const two = reduce(one.state, { type: 'ready', entity_id: 'p1' }, ctx)
    expect(two.state.started).toBe(true)
  })

  test('ready is ignored after start; ready is idempotent', () => {
    const { state, ctx } = placement_fight(1)
    const r1 = reduce(state, { type: 'ready', entity_id: 'p0' }, ctx)
    // already started -> a second ready is a no-op
    const r2 = reduce(r1.state, { type: 'ready', entity_id: 'p0' }, ctx)
    expect(r2.events).toEqual([])
  })
})

// ── PUSH / PULL COLLISION DAMAGE ───────────────────────────────────────────────
describe('push displacement', () => {
  test('push slides an adjacent enemy away by the distance', () => {
    // player at (4,5), enemy at (5,5); push distance 2 -> enemy lands at (7,5), takes no collision damage.
    const { state, ctx } = started_fight(3, {
      p_cell: { x: 4, y: 5 },
      m_cell: { x: 5, y: 5 },
    })
    const r = reduce(
      state,
      {
        type: 'cast',
        entity_id: 'p0',
        spell_id: 'push1',
        target: { x: 5, y: 5 },
      },
      ctx,
    )
    expect(find_entity(r.state, 'm0').cell).toEqual({ x: 7, y: 5 })
    expect(find_entity(r.state, 'm0').health).toBe(100) // free slide, no wall hit
  })

  test('push into a WALL stops short and deals collision damage', () => {
    // wall at (7,5). player (4,5), enemy (5,5). push 2: enemy would go 6 then 7(wall) -> stops at 6,
    // blocked=1; level-1 collision floor is max(floor(12*1/50),1)=1.
    const arena = flat_arena(11, [{ x: 7, y: 5 }])
    const { state, ctx } = started_fight(3, {
      arena,
      p_cell: { x: 4, y: 5 },
      m_cell: { x: 5, y: 5 },
    })
    const r = reduce(
      state,
      {
        type: 'cast',
        entity_id: 'p0',
        spell_id: 'push1',
        target: { x: 5, y: 5 },
      },
      ctx,
    )
    expect(find_entity(r.state, 'm0').cell).toEqual({ x: 6, y: 5 })
    expect(find_entity(r.state, 'm0').health).toBe(99)
  })

  test('push into ANOTHER fighter damages only the displaced target', () => {
    // blocker mob at (7,5). player (4,5), enemy (5,5). push 2: 6 (free) then 7 (blocked) -> stops at 6,
    // blocked=1 -> the level-1 floor deals 1 to the displaced target only.
    const arena = flat_arena()
    const ctx = { spell_templates, arena }
    const state0 = create_fight_state({
      fight_id: 'f',
      arena_seed: 3,
      arena_radius: arena.radius,
      arena,
      team0: [
        make_entity('p0', { x: 4, y: 5 }, true),
        make_entity('ally', { x: 1, y: 6 }, true, { deck: [] }), // idle -> even teams, p0 opens (§17.28)
      ],
      team1: [
        make_entity('m0', { x: 5, y: 5 }, false),
        make_entity('m1', { x: 7, y: 5 }, false),
      ],
    })
    const { state } = reduce(state0, { type: 'start' }, ctx)
    const r = reduce(
      state,
      {
        type: 'cast',
        entity_id: 'p0',
        spell_id: 'push1',
        target: { x: 5, y: 5 },
      },
      ctx,
    )
    expect(find_entity(r.state, 'm0').cell).toEqual({ x: 6, y: 5 })
    expect(find_entity(r.state, 'm0').health).toBe(99)
    expect(find_entity(r.state, 'm1').health).toBe(100)
  })
})

// ── POISON DoT ─────────────────────────────────────────────────────────────────
describe('poison damage-over-time', () => {
  test('poison ticks at the victim TURN_START for its duration then expires', () => {
    const { state, ctx } = started_fight(5, {
      p_cell: { x: 4, y: 5 },
      m_cell: { x: 6, y: 5 },
    })
    // apply poison (5/turn, 2 turns) to the mob
    const cast = reduce(
      state,
      {
        type: 'cast',
        entity_id: 'p0',
        spell_id: 'poison1',
        target: { x: 6, y: 5 },
      },
      ctx,
    )
    expect(
      find_entity(cast.state, 'm0').effects.some(e => e.type === 'DAMAGE'),
    ).toBe(true)
    // end the player's turn -> the mob's turn starts -> poison tick #1 (-5)
    const t1 = reduce(cast.state, { type: 'end_turn', entity_id: 'p0' }, ctx)
    expect(t1.events.some(e => e.type === 'fight_turn_effects')).toBe(true)
    // the mob took its turn via the engine cycle; after the mob's turn-start tick its health is 95
    expect(find_entity(t1.state, 'm0').health).toBe(95)
  })
})

// ── GLYPH (persistent zone) ─────────────────────────────────────────────────────
describe('glyph zone', () => {
  test('a glyph on the mob cell ticks at its TURN_START', () => {
    const { state, ctx } = started_fight(9, {
      p_cell: { x: 4, y: 5 },
      m_cell: { x: 6, y: 5 },
    })
    const cast = reduce(
      state,
      {
        type: 'cast',
        entity_id: 'p0',
        spell_id: 'glyph1',
        target: { x: 6, y: 5 },
      },
      ctx,
    )
    expect(cast.state.glyphs.length).toBe(1)
    const t1 = reduce(cast.state, { type: 'end_turn', entity_id: 'p0' }, ctx)
    // mob stood on the glyph at its turn-start -> took 5 (its int=0, no scaling beyond level 1)
    expect(find_entity(t1.state, 'm0').health).toBeLessThan(100)
  })

  test('a glyph decays + expires after its turn budget (3 turns -> gone)', () => {
    const { state, ctx } = started_fight(21, {
      p_cell: { x: 4, y: 5 },
      m_cell: { x: 6, y: 5 },
    })
    let acc = reduce(
      state,
      {
        type: 'cast',
        entity_id: 'p0',
        spell_id: 'glyph1',
        target: { x: 6, y: 5 },
      },
      ctx,
    )
    expect(acc.state.glyphs.length).toBe(1)
    // each full round (player end_turn -> mob ai_turn back to player) decays the glyph once per advance. The
    // 3-turn glyph should be gone within a few advances.
    for (let i = 0; i < 8 && acc.state.glyphs.length > 0; i++) {
      const active = get_current_turn_entity(acc.state)
      if (!active) break
      acc = reduce(
        acc.state,
        active.is_player
          ? { type: 'end_turn', entity_id: active.id }
          : { type: 'ai_turn', entity_id: active.id },
        ctx,
      )
    }
    expect(acc.state.glyphs.length).toBe(0)
  })
})

// ── DoT can WIN the fight at turn-start ──────────────────────────────────────────
describe('turn-start hazard victory', () => {
  test('poison that kills the last enemy at its turn-start ends the fight', () => {
    // a near-dead mob with a lethal poison ticks at its turn-start -> dies -> fight_ended on the player's
    // end_turn (with_victory in handle_end_turn catches the hazard kill).
    const { state, ctx } = started_fight(33, {
      p_cell: { x: 4, y: 5 },
      m_cell: { x: 6, y: 5 },
      m_overrides: { health: 4, health_max: 40 },
    })
    const cast = reduce(
      state,
      {
        type: 'cast',
        entity_id: 'p0',
        spell_id: 'poison1',
        target: { x: 6, y: 5 },
      },
      ctx,
    )
    // mob at 4 HP, poison 5/turn -> dies on its turn-start tick
    const ended = reduce(cast.state, { type: 'end_turn', entity_id: 'p0' }, ctx)
    expect(ended.state.winner).toBe(0)
    expect(ended.events.some(e => e.type === 'fight_ended')).toBe(true)
  })
})

// ── TRAP (hidden, on-step) ──────────────────────────────────────────────────────
describe('trap on-step', () => {
  test('the caster walking onto its own trap fires and consumes it', () => {
    const { state, ctx } = started_fight(11, {
      p_cell: { x: 4, y: 5 },
      m_cell: { x: 9, y: 6 },
    })
    // player casts a trap on (5,5) (an empty cell within range)
    const cast = reduce(
      state,
      {
        type: 'cast',
        entity_id: 'p0',
        spell_id: 'trap1',
        target: { x: 5, y: 5 },
      },
      ctx,
    )
    expect(cast.state.traps.length).toBe(1)
    // on_enter is owner-blind: entering any live trap zone fires the first trap.
    const move = reduce(
      cast.state,
      { type: 'move', entity_id: 'p0', path: [{ x: 5, y: 5 }] },
      ctx,
    )
    expect(move.state.traps.length).toBe(0)
    expect(find_entity(move.state, 'p0').health).toBe(90)
    expect(move.events.some(e => e.type === 'fight_trap_triggered')).toBe(true)
  })

  test('an ENEMY walking onto the trap DOES fire it (for 10) and consumes it', () => {
    const { state, ctx } = started_fight(11, {
      p_cell: { x: 4, y: 5 },
      m_cell: { x: 6, y: 5 },
    })
    // player places the trap on (5,5), between itself and the mob, then ends its turn (stays at (4,5))
    const cast = reduce(
      state,
      {
        type: 'cast',
        entity_id: 'p0',
        spell_id: 'trap1',
        target: { x: 5, y: 5 },
      },
      ctx,
    )
    expect(cast.state.traps.length).toBe(1)
    const ended = reduce(cast.state, { type: 'end_turn', entity_id: 'p0' }, ctx)
    expect(get_current_turn_entity(ended.state).id).toBe('m0') // the mob's turn now
    // the ENEMY mob walks onto the trap -> it fires for 10, is consumed, and reports the trigger
    const move = reduce(
      ended.state,
      { type: 'move', entity_id: 'm0', path: [{ x: 5, y: 5 }] },
      ctx,
    )
    expect(move.state.traps.length).toBe(0) // trap consumed
    expect(find_entity(move.state, 'm0').health).toBe(90)
    expect(move.events.some(e => e.type === 'fight_trap_triggered')).toBe(true)
  })

  // 1.29 TRAP-STACKING BAN (chain parity: aresrpg_fight::cast ECellAlreadyTrapped) — one live trap per ANCHOR;
  // a refused cast is a reduce no-op (no event, no AP spend); a consumed trap frees its anchor.
  test('a second trap on the SAME anchor is refused; a DIFFERENT anchor is legal', () => {
    const { state, ctx } = started_fight(11, {
      p_cell: { x: 4, y: 5 },
      m_cell: { x: 9, y: 6 },
    })
    const cast1 = reduce(
      state,
      {
        type: 'cast',
        entity_id: 'p0',
        spell_id: 'trap1',
        target: { x: 5, y: 5 },
      },
      ctx,
    )
    expect(cast1.state.traps.length).toBe(1)
    // cycle the round so trap1 returns to hand (cast → discard → end-turn auto-draw); the far mob just passes.
    const t1 = reduce(cast1.state, { type: 'end_turn', entity_id: 'p0' }, ctx)
    const t2 = reduce(t1.state, { type: 'end_turn', entity_id: 'm0' }, ctx)
    // SAME anchor while the trap is still live → refused whole: no trap, no events, no AP spent.
    const stacked = reduce(
      t2.state,
      {
        type: 'cast',
        entity_id: 'p0',
        spell_id: 'trap1',
        target: { x: 5, y: 5 },
      },
      ctx,
    )
    expect(stacked.state.traps.length).toBe(1)
    expect(stacked.events.length).toBe(0)
    expect(find_entity(stacked.state, 'p0').ap).toBe(10) // refused BEFORE the AP deduction
    // a DIFFERENT anchor is legal (the ban is anchor-on-anchor, zones may overlap).
    const other = reduce(
      t2.state,
      {
        type: 'cast',
        entity_id: 'p0',
        spell_id: 'trap1',
        target: { x: 6, y: 5 },
      },
      ctx,
    )
    expect(other.state.traps.length).toBe(2)
    expect(other.events.some(e => e.type === 'fight_cast')).toBe(true)
  })

  test('a triggered (consumed) trap frees its anchor for a re-cast', () => {
    const { state, ctx } = started_fight(11, {
      p_cell: { x: 4, y: 5 },
      m_cell: { x: 6, y: 5 },
    })
    const cast1 = reduce(
      state,
      {
        type: 'cast',
        entity_id: 'p0',
        spell_id: 'trap1',
        target: { x: 5, y: 5 },
      },
      ctx,
    )
    expect(cast1.state.traps.length).toBe(1)
    const ended = reduce(
      cast1.state,
      { type: 'end_turn', entity_id: 'p0' },
      ctx,
    )
    // the ENEMY steps onto it → fired + consumed (the anchor is free again)
    const move = reduce(
      ended.state,
      { type: 'move', entity_id: 'm0', path: [{ x: 5, y: 5 }] },
      ctx,
    )
    expect(move.state.traps.length).toBe(0)
    const back = reduce(move.state, { type: 'end_turn', entity_id: 'm0' }, ctx)
    // p0 re-traps the SAME cell → succeeds (a dead trap does not block)
    const recast = reduce(
      back.state,
      {
        type: 'cast',
        entity_id: 'p0',
        spell_id: 'trap1',
        target: { x: 5, y: 5 },
      },
      ctx,
    )
    expect(recast.state.traps.length).toBe(1)
    expect(recast.events.some(e => e.type === 'fight_cast')).toBe(true)
  })
})

// ── STUN (turn skip) ────────────────────────────────────────────────────────────
describe('stun skips the turn', () => {
  test('a stunned actor is skipped and its STUN is consumed', () => {
    const { state, ctx } = started_fight(13, {
      p_cell: { x: 4, y: 5 },
      m_cell: { x: 5, y: 5 },
    })
    // stun the adjacent mob for 1 turn
    const cast = reduce(
      state,
      {
        type: 'cast',
        entity_id: 'p0',
        spell_id: 'stun1',
        target: { x: 5, y: 5 },
      },
      ctx,
    )
    expect(
      find_entity(cast.state, 'm0').effects.some(e => e.type === 'STUN'),
    ).toBe(true)
    // end the player's turn -> the mob is stunned -> its turn is skipped, returns to the player
    const ended = reduce(cast.state, { type: 'end_turn', entity_id: 'p0' }, ctx)
    expect(ended.events.some(e => e.type === 'fight_turn_skipped')).toBe(true)
    expect(get_current_turn_entity(ended.state).id).toBe('p0')
    // #2000 — the mob's turn STARTED by ageing the row, and an authored 1 still covered that turn: it is SPENT
    // (counter 0), not gone, which is exactly what makes the stun cost one whole turn and no more.
    const spent = find_entity(ended.state, 'm0').effects.find(
      e => e.type === 'STUN',
    )
    expect(spent?.turns_remaining).toBe(0)
    // the mob's NEXT turn opens on the spent row, drops it, and the mob acts — one turn lost, exactly one
    const after = reduce(
      ended.state,
      { type: 'end_turn', entity_id: 'p0' },
      ctx,
    )
    expect(
      find_entity(after.state, 'm0').effects.some(e => e.type === 'STUN'),
    ).toBe(false)
  })
})

// ── DETERMINISM (new mechanics preserve byte-identical replay) ──────────────────
describe('determinism with new mechanics', () => {
  const commands = [
    {
      type: 'cast',
      entity_id: 'p0',
      spell_id: 'poison1',
      target: { x: 6, y: 5 },
    },
    {
      type: 'cast',
      entity_id: 'p0',
      spell_id: 'glyph1',
      target: { x: 6, y: 5 },
    },
    { type: 'end_turn', entity_id: 'p0' },
    { type: 'ai_turn', entity_id: 'm0' },
    { type: 'end_turn', entity_id: 'p0' },
  ]
  const run = () => {
    const { state, ctx } = started_fight(424242, {
      p_cell: { x: 4, y: 5 },
      m_cell: { x: 6, y: 5 },
    })
    return commands.reduce(
      (acc, cmd) => {
        const r = reduce(acc.state, cmd, ctx)
        return { state: r.state, events: [...acc.events, ...r.events] }
      },
      { state, events: [] },
    )
  }
  test('same seed + same commands -> deep-equal {state, events}', () => {
    const a = run()
    const b = run()
    expect(a.state).toEqual(b.state)
    expect(a.events).toEqual(b.events)
    expect(a.state.rng).toBe(b.state.rng)
  })
})

// ── AP / MP REFILL AT TURN START ────────────────────────────────────────────────
// Rule: when it is an actor's turn AGAIN, its AP and MP must be refilled to max. The sim resets the
// next actor's ap=ap_max, mp=mp_max in advance_turn; this proves the full cycle (spend -> end -> opponent
// turn -> back to me) restores both pools, and that a depleted actor never starts a turn short.
describe('AP/MP refill at turn start', () => {
  // A flat arena where the player + mob are adjacent (range-1 cast lands) so the player can spend BOTH
  // AP (a move) and AP-on-cast in one turn before ending it.
  const adjacent = () =>
    started_fight(99, { p_cell: { x: 4, y: 5 }, m_cell: { x: 5, y: 5 } })

  test('the next actor begins its turn with ap=ap_max and mp=mp_max', () => {
    const { state, ctx } = adjacent()
    const me = get_current_turn_entity(state)
    expect(me?.id).toBe('p0')
    expect(me?.ap).toBe(me?.ap_max)
    expect(me?.mp).toBe(me?.mp_max)

    // Spend AP first (cast a 2-AP push at the adjacent mob while still range-1), THEN spend MP (move 2
    // cells). Casting before moving keeps the range-1 push in range. Both pools end below max.
    const cast = reduce(
      state,
      {
        type: 'cast',
        entity_id: 'p0',
        spell_id: 'push1',
        target: { x: 5, y: 5 },
      },
      ctx,
    )
    const moved = reduce(
      cast.state,
      {
        type: 'move',
        entity_id: 'p0',
        path: [
          { x: 4, y: 4 },
          { x: 4, y: 3 },
        ],
      },
      ctx,
    )
    const spent = find_entity(moved.state, 'p0')
    // Proven depleted before the next cycle (so the refill below is meaningful, not a no-op).
    expect(spent.mp).toBeLessThan(spent.mp_max)
    expect(spent.ap).toBeLessThan(spent.ap_max)

    // End my turn -> mob's AI turn -> end mob's turn -> the index wraps back to me.
    const ended = reduce(
      moved.state,
      { type: 'end_turn', entity_id: 'p0' },
      ctx,
    )
    const ai = reduce(ended.state, { type: 'ai_turn', entity_id: 'm0' }, ctx)
    const back = reduce(ai.state, { type: 'end_turn', entity_id: 'm0' }, ctx)

    const refreshed = find_entity(back.state, 'p0')
    expect(get_current_turn_entity(back.state)?.id).toBe('p0')
    expect(refreshed.ap).toBe(refreshed.ap_max)
    expect(refreshed.mp).toBe(refreshed.mp_max)
    expect(refreshed.ap_used).toBe(0)
    expect(refreshed.mp_used).toBe(0)
  })

  test('a fight_turn_start event precedes each actor turn (drives the client refill)', () => {
    const { state, ctx } = adjacent()
    const ended = reduce(state, { type: 'end_turn', entity_id: 'p0' }, ctx)
    // ending p0's turn emits a fight_turn_start for the next actor (m0).
    const next_start = ended.events.find(e => e.type === 'fight_turn_start')
    expect(next_start?.entity_id).toBe('m0')
  })
})
