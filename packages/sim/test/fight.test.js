// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, test, expect } from 'bun:test'

import {
  reduce,
  create_fight_state,
  STALEMATE_ROUNDS,
  DRAW,
} from '../src/reduce.js'
import { normalize_spell_templates } from '../src/spell_templates.js'
import { find_entity, get_current_turn_entity } from '../src/fight_state.js'
import { check_victory } from '../src/fight_actions.js'
import { has_line_of_sight } from '../src/visibility.js'
import { get_aoe_cells } from '../src/spell_targeting.js'
import { calculate_final_damage } from '../src/spell_calculator.js'

// ── Fixtures ─────────────────────────────────────────────────────────────────
// A synthetic flat arena (all walkable) so tests exercise the reducer, not the carve. Spawns are fixed
// cells on opposite sides. The reducer never reads arena.spawns for movement — only terrain + occupancy.
const flat_arena = (width = 9) => ({
  width,
  radius: (width - 1) / 2,
  center: { x: (width - 1) / 2, y: (width - 1) / 2 },
  cells: new Uint8Array(width * width), // all 0 = walkable
  spawns_a: [
    { x: 1, y: 4 },
    { x: 1, y: 5 },
  ],
  spawns_b: [
    { x: 7, y: 4 },
    { x: 7, y: 5 },
  ],
})

// A spells fixture in the AresRPG JSON shape (lowercase), fed through the real normalizer.
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
    mend: {
      name: 'Mend',
      description: 'A self heal.',
      levels: [
        {
          cost: 2,
          range: [0, 0],
          critical_chance: 0,
          area: 0,
          area_type: 'circle',
          casts_per_turn: 255,
          casts_per_target: 255,
          cooldown_turns: 0,
          modifiable_range: false,
          line_of_sight: false,
          linear: false,
          free_cell: false,
          base_effects: [
            { type: 'heal', min: 8, max: 8, target: 'self', chance: 100 },
          ],
          critical_effects: [],
        },
      ],
    },
  },
}

const spell_templates = normalize_spell_templates(SPELLS_JSON)

const make_entity = (id, team, cell, is_player, overrides = {}) => ({
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
  is_player,
  template_id: 'senshi',
  level: 1,
  stats: { agility: 0, intelligence: 0, range: 0 },
  effects: [],
  spell_levels: { bolt: 1, mend: 1 },
  ap_reserve: 0,
  ...overrides,
})

// Build a started 1v1 fight: player at (1,4), mob at (7,4). Returns { state, ctx }.
const started_fight = (seed = 12345) => {
  const arena = flat_arena()
  const ctx = { spell_templates, arena }
  const team0 = [make_entity('p0', 0, { x: 1, y: 4 }, true)]
  const team1 = [make_entity('m0', 1, { x: 7, y: 4 }, false)]
  const base = create_fight_state({
    fight_id: 'f1',
    arena_seed: seed,
    arena_radius: arena.radius,
    arena,
    team0,
    team1,
  })
  const { state } = reduce(base, { type: 'start' }, ctx)
  return { state, ctx }
}

// ── Pure spatial reuse ─────────────────────────────────────────────────────────
describe('reused spatial layer', () => {
  test('line of sight is blocked by an interposing wall', () => {
    const open = () => false
    const wall_at_5 = c => c.x === 5
    expect(has_line_of_sight({ x: 1, y: 4 }, { x: 7, y: 4 }, open)).toBe(true)
    expect(has_line_of_sight({ x: 1, y: 4 }, { x: 7, y: 4 }, wall_at_5)).toBe(
      false,
    )
  })

  test('aoe circle of radius 1 is a 5-cell diamond', () => {
    const level = { area: 1, area_type: 'CIRCLE', range: [0, 0] }
    expect(
      get_aoe_cells(/** @type {any} */ (level), { x: 4, y: 4 }).length,
    ).toBe(5)
  })
})

// ── Normalizer ───────────────────────────────────────────────────────────────
describe('spell template normalizer', () => {
  test('lowercase AresRPG JSON -> uppercase sim shape', () => {
    const bolt = spell_templates.get('bolt')
    expect(bolt?.levels[0].base_effects[0].type).toBe('DAMAGE')
    expect(bolt?.levels[0].base_effects[0].element).toBe('FIRE')
    expect(bolt?.levels[0].area_type).toBe('CIRCLE')
  })
})

// ── Core loop ────────────────────────────────────────────────────────────────
describe('reduce: core loop', () => {
  test('start fixes turn order and hands the first turn to the player', () => {
    const { state } = started_fight()
    expect(state.started).toBe(true)
    expect(state.turn_order).toEqual(['p0', 'm0'])
    expect(get_current_turn_entity(state)?.id).toBe('p0')
  })

  test('move spends MP and relocates; rejects an over-budget path', () => {
    const { state, ctx } = started_fight()
    const ok = reduce(
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
    expect(find_entity(ok.state, 'p0')?.cell).toEqual({ x: 3, y: 4 })
    expect(find_entity(ok.state, 'p0')?.mp).toBe(1)
    expect(ok.events[0]?.type).toBe('fight_moved')

    // 4-step path exceeds 3 MP -> rejected (state unchanged)
    const bad = reduce(
      state,
      {
        type: 'move',
        entity_id: 'p0',
        path: [
          { x: 2, y: 4 },
          { x: 3, y: 4 },
          { x: 4, y: 4 },
          { x: 5, y: 4 },
        ],
      },
      ctx,
    )
    expect(find_entity(bad.state, 'p0')?.cell).toEqual({ x: 1, y: 4 })
  })

  test('cast damage spends AP and deals damage — one event, no bookkeeping', () => {
    const { state, ctx } = started_fight()
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
    const mob = find_entity(r.state, 'm0')
    const caster = find_entity(r.state, 'p0')
    expect(mob?.health).toBe(20) // 30 - 10 (flat min=max=10, no stats, level 1)
    expect(caster?.ap).toBe(3) // 6 - 3
    expect(r.events.map(e => e.type)).toEqual(['fight_cast'])
  })

  test('cast out of line-of-sight is rejected', () => {
    const arena = flat_arena()
    arena.cells[4 * arena.width + 4] = 1 // wall between p0(1,4) and m0(7,4)
    const ctx = { spell_templates, arena }
    const base = create_fight_state({
      fight_id: 'f2',
      arena_seed: 1,
      arena_radius: arena.radius,
      arena,
      team0: [make_entity('p0', 0, { x: 1, y: 4 }, true)],
      team1: [make_entity('m0', 1, { x: 7, y: 4 }, false)],
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
    expect(find_entity(r.state, 'm0')?.health).toBe(30) // unchanged — LoS blocked
    expect(r.events.length).toBe(0)
  })

  test('end_turn draws a card and advances to the mob', () => {
    const { state, ctx } = started_fight()
    const r = reduce(state, { type: 'end_turn', entity_id: 'p0' }, ctx)
    expect(get_current_turn_entity(r.state)?.id).toBe('m0')
    expect(r.events.map(e => e.type)).toContain('fight_turn_end')
    expect(r.events.map(e => e.type)).toContain('fight_turn_start')
  })

  test('killing the last enemy ends the fight', () => {
    const arena = flat_arena()
    const ctx = { spell_templates, arena }
    const base = create_fight_state({
      fight_id: 'f3',
      arena_seed: 1,
      arena_radius: arena.radius,
      arena,
      team0: [make_entity('p0', 0, { x: 1, y: 4 }, true, { ap: 9, ap_max: 9 })],
      team1: [
        make_entity('m0', 1, { x: 7, y: 4 }, false, {
          health: 10,
          health_max: 10,
        }),
      ],
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
    expect(find_entity(r.state, 'm0')?.health).toBe(0)
    expect(r.state.winner).toBe(0)
    expect(r.events.map(e => e.type)).toContain('fight_ended')
  })

  test('abandon kills the actor and ends the fight', () => {
    const { state, ctx } = started_fight()
    const r = reduce(state, { type: 'abandon', entity_id: 'p0' }, ctx)
    expect(r.state.winner).toBe(1)
    // The death is ANNOUNCED before the conclusion (actions.move: mark_abandoned's emit_abandoned, then the
    // terminal fold) — the forfeit carries the ordinary damage row, so the kill has a named cause.
    expect(r.events.map(e => e.type)).toEqual([
      'fight_abandoned',
      'fight_ended',
    ])
    expect(r.events[0].effects).toEqual([
      { target_id: 'p0', damage: 30, new_health: 0, killed: true },
    ])
  })

  // #936 / #937 — the sim's forfeit is the twin of actions.move `begin_abandon`: it refuses exactly where the
  // chain aborts, as DATA (unchanged state, no events), so no fight is re-decided and no death is doubled.

  // A PvP pair: a chain seat exists on BOTH sides, so team1's fighter is a participant who could otherwise
  // legally forfeit — the ONLY thing refusing it here is the winner latch.
  const pvp_fight = (seed = 12345) => {
    const arena = flat_arena()
    const ctx = { spell_templates, arena }
    const base = create_fight_state({
      fight_id: 'pvp',
      arena_seed: seed,
      arena_radius: arena.radius,
      arena,
      team0: [make_entity('p0', 0, { x: 1, y: 4 }, true)],
      team1: [make_entity('p1', 1, { x: 7, y: 4 }, true)],
    })
    return { state: reduce(base, { type: 'start' }, ctx).state, ctx }
  }

  test('abandon on a DECIDED fight is refused, winner untouched (EFightOver twin)', () => {
    const { state, ctx } = pvp_fight()
    const decided = reduce(state, { type: 'abandon', entity_id: 'p0' }, ctx)
    expect(decided.state.winner).toBe(1)
    // p1 is a live PARTICIPANT — on-chain this aborts EFightOver (105); here it changes nothing.
    const late = reduce(
      decided.state,
      { type: 'abandon', entity_id: 'p1' },
      ctx,
    )
    expect(late.state).toBe(decided.state)
    expect(late.events).toEqual([])
    expect(late.state.winner).toBe(1)
    expect(find_entity(late.state, 'p1')?.health).toBeGreaterThan(0)
  })

  test('a PvP opponent on team1 CAN forfeit — the seat, not the side, is the gate', () => {
    const { state, ctx } = pvp_fight()
    const r = reduce(state, { type: 'abandon', entity_id: 'p1' }, ctx)
    expect(find_entity(r.state, 'p1')?.health).toBe(0)
    expect(r.state.winner).toBe(0)
    expect(r.events.map(e => e.type)).toEqual([
      'fight_abandoned',
      'fight_ended',
    ])
  })

  test('abandon by an already-dead fighter is refused (EAlreadyDead twin)', () => {
    const { state, ctx } = started_fight()
    const dead = reduce(state, { type: 'abandon', entity_id: 'p0' }, ctx)
    // Re-open the fight so the winner latch cannot be what refuses — ONLY the corpse gate is under test.
    const reopened = { ...dead.state, winner: -1 }
    const again = reduce(reopened, { type: 'abandon', entity_id: 'p0' }, ctx)
    expect(again.state).toBe(reopened)
    expect(again.events).toEqual([])
    expect(find_entity(again.state, 'p0')?.health).toBe(0)
  })

  test('a MOB holds no chain seat and cannot forfeit (ENotParticipant twin)', () => {
    const { state, ctx } = started_fight()
    const r = reduce(state, { type: 'abandon', entity_id: 'm0' }, ctx)
    expect(r.state).toBe(state)
    expect(r.events).toEqual([])
    expect(find_entity(r.state, 'm0')?.health).toBeGreaterThan(0)
  })

  test('abandon by an unknown fighter is refused', () => {
    const { state, ctx } = started_fight()
    const r = reduce(state, { type: 'abandon', entity_id: 'ghost' }, ctx)
    expect(r.state).toBe(state)
    expect(r.events).toEqual([])
  })
})

// ── STALEMATE backstop (#97): an unbounded zero-progress fight auto-ends as a DRAW ──
describe('reduce: stalemate detection (no unbounded fight)', () => {
  // Two PLAYERS who never act -> HP never changes -> a genuine stalemate (the DoS shape: with no round cap and
  // no backstop this would run forever). Driving only `end_turn` keeps both at full HP for every round.
  const idle_fight = (seed = 7) => {
    const arena = flat_arena()
    const ctx = { spell_templates, arena }
    const base = create_fight_state({
      fight_id: 'stale',
      arena_seed: seed,
      arena_radius: arena.radius,
      arena,
      team0: [make_entity('p0', 0, { x: 1, y: 4 }, true)],
      team1: [make_entity('p1', 1, { x: 7, y: 4 }, true)],
    })
    return { state: reduce(base, { type: 'start' }, ctx).state, ctx }
  }

  test('a zero-damage fight auto-ends as a DRAW after STALEMATE_ROUNDS', () => {
    const { state: initial, ctx } = idle_fight()
    let state = initial
    /** @type {import('../src/reduce.js').FightEvent[]} */
    let last_events = []
    // The fight MUST terminate; bound the loop generously to prove it does (the bug was it never would).
    let guard = STALEMATE_ROUNDS * 2 + 8
    while (state.winner === -1 && guard-- > 0) {
      const active = get_current_turn_entity(state)
      expect(active).not.toBeNull()
      const { state: next_state, events } = reduce(
        state,
        { type: 'end_turn', entity_id: active?.id ?? '' },
        ctx,
      )
      state = next_state
      last_events = events
    }
    // Terminated as a DRAW (winner 2) with NO winning team — exactly STALEMATE_ROUNDS no-progress rounds.
    expect(state.winner).toBe(DRAW)
    expect(state.no_progress_rounds).toBe(STALEMATE_ROUNDS)
    expect(
      last_events.some(e => e.type === 'fight_ended' && e.winner === DRAW),
    ).toBe(true)
    // Both fighters are still ALIVE (a draw, not a wipe) -> check_victory is null -> the reward path credits nothing.
    expect(check_victory(state)).toBeNull()
    expect(find_entity(state, 'p0')?.health).toBe(30)
    expect(find_entity(state, 'p1')?.health).toBe(30)
    // A concluded fight has no current turn (the loop/timers stop the instant it ends).
    expect(get_current_turn_entity(state)).toBeNull()
  })

  test('any net HP change resets the no-progress streak (a normal fight never trips it)', () => {
    const { state, ctx } = idle_fight()
    let s = state
    // Idle to within two rounds of the cap.
    for (let i = 0; i < (STALEMATE_ROUNDS - 2) * 2; i++) {
      const active = get_current_turn_entity(s)
      if (!active) break
      s = reduce(s, { type: 'end_turn', entity_id: active.id }, ctx).state
    }
    expect(s.no_progress_rounds).toBe(STALEMATE_ROUNDS - 2)
    expect(get_current_turn_entity(s)?.id).toBe('p0')
    // p0 deals real damage (total HP drops 60 -> 50), then the round completes -> the streak RESETS to 0,
    // so the DRAW never trips. This is why a normal fight (which moves HP most rounds) is immune.
    const cast = reduce(
      s,
      {
        type: 'cast',
        entity_id: 'p0',
        spell_id: 'bolt',
        target: { x: 7, y: 4 },
      },
      ctx,
    ).state
    expect(find_entity(cast, 'p1')?.health).toBe(20) // a genuine HP change happened
    const p0_end = reduce(
      cast,
      { type: 'end_turn', entity_id: 'p0' },
      ctx,
    ).state
    const round_done = reduce(
      p0_end,
      { type: 'end_turn', entity_id: 'p1' },
      ctx,
    ).state
    expect(round_done.winner).toBe(-1) // still ongoing
    expect(round_done.no_progress_rounds).toBe(0) // the changed total reset the streak
    expect(round_done.last_total_hp).toBe(50)
  })

  // NO-TRAP invariant (#62, must survive #97): the draw never gates ABANDON. A player stuck in a stalemate can
  // still escape instantly, BEFORE the draw would ever trip.
  test('no-trap: a stuck fighter can ABANDON before the stalemate DRAW trips', () => {
    const { state, ctx } = idle_fight(9)
    let s = state
    // Idle through fewer than the cap rounds so the DRAW has NOT yet tripped.
    for (let i = 0; i < (STALEMATE_ROUNDS - 2) * 2; i++) {
      const active = get_current_turn_entity(s)
      if (!active) break
      s = reduce(s, { type: 'end_turn', entity_id: active.id }, ctx).state
    }
    expect(s.winner).toBe(-1) // still ongoing
    expect(s.no_progress_rounds).toBeLessThan(STALEMATE_ROUNDS)
    // The player escapes instantly — abandon is unconditional, never gated by the stalemate counter.
    const r = reduce(s, { type: 'abandon', entity_id: 'p0' }, ctx)
    expect(find_entity(r.state, 'p0')?.health).toBe(0)
    expect(r.state.winner).toBe(1) // team0 abandoned -> team1 wins; a real result, NOT a draw
    expect(r.events.some(e => e.type === 'fight_ended' && e.winner === 1)).toBe(
      true,
    )
  })
})

// ── Basic AI ─────────────────────────────────────────────────────────────────
describe('reduce: basic AI', () => {
  test('mob in range casts; out of range moves toward then ends turn', () => {
    const { state, ctx } = started_fight()
    // hand the mob the turn
    const { state: mob_turn } = reduce(
      state,
      { type: 'end_turn', entity_id: 'p0' },
      ctx,
    )
    const r = reduce(mob_turn, { type: 'ai_turn', entity_id: 'm0' }, ctx)
    // mob has a ranged bolt (range 8) with LoS -> it should cast and damage the player
    expect(find_entity(r.state, 'p0')?.health).toBeLessThan(30)
    expect(r.events.map(e => e.type)).toContain('fight_cast')
    // turn passes back to the player
    expect(get_current_turn_entity(r.state)?.id).toBe('p0')
  })

  test('an out-of-range mob moves toward the player instead of casting', () => {
    // 13x13 arena so the mob can sit beyond bolt range (max 8). Player (1,1), mob (12,12): dist 22 > 8.
    const arena = flat_arena(13)
    const ctx = { spell_templates, arena }
    const base = create_fight_state({
      fight_id: 'f4',
      arena_seed: 1,
      arena_radius: arena.radius,
      arena,
      team0: [make_entity('p0', 0, { x: 1, y: 1 }, true)],
      team1: [
        make_entity('m0', 1, { x: 12, y: 12 }, false, { mp: 5, mp_max: 5 }),
      ],
    })
    const { state } = reduce(base, { type: 'start' }, ctx)
    const { state: mob_turn } = reduce(
      state,
      { type: 'end_turn', entity_id: 'p0' },
      ctx,
    )
    const r = reduce(mob_turn, { type: 'ai_turn', entity_id: 'm0' }, ctx)
    const mob = find_entity(r.state, 'm0')
    // moved closer to the player (manhattan distance dropped) and back to the player's turn
    expect(mob?.cell).not.toEqual({ x: 12, y: 12 })
    expect(r.events.map(e => e.type)).toContain('fight_moved')
    expect(r.events.map(e => e.type)).not.toContain('fight_cast')
  })
})

// ── Determinism (sim.md law) ─────────────────────────────────────────────────
describe('determinism', () => {
  test('damage is a pure function of the turn-seed roll (#577)', () => {
    const effect = { type: 'DAMAGE', min: 5, max: 50, element: 'FIRE' }
    const caster = { intelligence: 100 }
    const target = { fire_resistance: 0 }
    // same roll -> byte-identical damage (rng-free; the roll is the sole variable input).
    const a = calculate_final_damage(
      /** @type {any} */ (effect),
      caster,
      target,
      6000,
      [],
    )
    const b = calculate_final_damage(
      /** @type {any} */ (effect),
      caster,
      target,
      6000,
      [],
    )
    expect(a.damage).toBe(b.damage)
    // and the roll spans the authored range: the low roll is strictly weaker than the high roll.
    const lo = calculate_final_damage(
      /** @type {any} */ (effect),
      caster,
      target,
      0,
      [],
    ).damage
    const hi = calculate_final_damage(
      /** @type {any} */ (effect),
      caster,
      target,
      9999,
      [],
    ).damage
    expect(hi).toBeGreaterThan(lo)
  })

  test('same seed + same command sequence -> byte-identical {state, events} twice', () => {
    const run = () => {
      const { state, ctx } = started_fight(98765)
      const commands = [
        { type: 'move', entity_id: 'p0', path: [{ x: 2, y: 4 }] },
        {
          type: 'cast',
          entity_id: 'p0',
          spell_id: 'bolt',
          target: { x: 7, y: 4 },
        },
        { type: 'end_turn', entity_id: 'p0' },
        { type: 'ai_turn', entity_id: 'm0' },
      ]
      return commands.reduce(
        (acc, cmd) => {
          const r = reduce(acc.state, /** @type {any} */ (cmd), ctx)
          return { state: r.state, events: [...acc.events, ...r.events] }
        },
        { state, events: [] },
      )
    }
    const first = run()
    const second = run()
    // strip Uint8Array (arena cells live in ctx, not state) — state is JSON-clonable
    expect(JSON.stringify(first.state)).toBe(JSON.stringify(second.state))
    expect(JSON.stringify(first.events)).toBe(JSON.stringify(second.events))
  })
})

// ── Join a fight during placement (Wave SPECTATE) ────────────────────────────────
describe('reduce: join (placement)', () => {
  // A fresh placement-phase 1v1 (NOT started) so a third human can join team0.
  const placement_fight = () => {
    const arena = flat_arena()
    const ctx = { spell_templates, arena }
    const team0 = [make_entity('p0', 0, { x: 1, y: 4 }, true)]
    const team1 = [make_entity('m0', 1, { x: 7, y: 4 }, false)]
    const base = create_fight_state({
      fight_id: 'f1',
      arena_seed: 999,
      arena_radius: arena.radius,
      arena,
      team0,
      team1,
    })
    return { base, ctx }
  }

  test('a human joins team0 on a free spawn cell during placement', () => {
    const { base, ctx } = placement_fight()
    const joiner = make_entity('p1', 0, { x: 0, y: 0 }, true)
    const r = reduce(base, { type: 'join', entity: joiner }, ctx)
    expect(r.state.team0.map(e => e.id)).toEqual(['p0', 'p1'])
    // placed on a free team0 spawn cell (1,4 is taken by p0 -> the next, 1,5)
    const placed = find_entity(r.state, 'p1')
    expect(placed?.cell).toEqual({ x: 1, y: 5 })
    expect(r.events).toEqual([
      {
        type: 'fight_joined',
        fight_id: 'f1',
        entity_id: 'p1',
        team: 0,
        cell: { x: 1, y: 5 },
      },
    ])
  })

  test('join is rejected once the fight has started', () => {
    const { base, ctx } = placement_fight()
    const { state } = reduce(base, { type: 'start' }, ctx)
    const joiner = make_entity('p1', 0, { x: 0, y: 0 }, true)
    const r = reduce(state, { type: 'join', entity: joiner }, ctx)
    expect(r.state.team0.map(e => e.id)).toEqual(['p0'])
    expect(r.events).toEqual([])
  })

  test('join is idempotent for an existing fighter', () => {
    const { base, ctx } = placement_fight()
    const dup = make_entity('p0', 0, { x: 0, y: 0 }, true)
    const r = reduce(base, { type: 'join', entity: dup }, ctx)
    expect(r.state.team0).toHaveLength(1)
    expect(r.events).toEqual([])
  })

  test('join is rejected when every team0 spawn cell is occupied (team full)', () => {
    const { base, ctx } = placement_fight()
    // place a second fighter on the only OTHER spawn cell so both team0 cells are taken
    const filler = make_entity('p1', 0, { x: 1, y: 5 }, true)
    const { state } = reduce(base, { type: 'join', entity: filler }, ctx)
    const joiner = make_entity('p2', 0, { x: 0, y: 0 }, true)
    const r = reduce(state, { type: 'join', entity: joiner }, ctx)
    expect(r.state.team0.map(e => e.id)).toEqual(['p0', 'p1'])
    expect(r.events).toEqual([])
  })
})
