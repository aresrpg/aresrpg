import { describe, test, expect } from 'bun:test'

import { reduce, create_fight_state } from '../src/reduce.js'
import {
  normalize_spell_templates,
  MOB_ATTACK_ID,
} from '../src/spell_templates.js'
import { find_entity, get_current_turn_entity } from '../src/fight_state.js'
import { summon_entity } from '../src/fight_summon.js'
import real_spells from '../../sdk/src/spells.json'

// ── Fixtures ─────────────────────────────────────────────────────────────────
const flat_arena = (width = 11) => ({
  width,
  radius: (width - 1) / 2,
  center: { x: (width - 1) / 2, y: (width - 1) / 2 },
  cells: new Uint8Array(width * width),
  spawns_a: [{ x: 4, y: 5 }],
  spawns_b: [{ x: 6, y: 5 }],
})

// summon1 — SUMMON 'wolf' at the cast cell (range 0, self). The minion shares the generic MOB_ATTACK.
const SPELLS_JSON = {
  yajin: {
    summon1: {
      name: 'Summon',
      description: 's',
      levels: [
        {
          cost: 1,
          range: [0, 0],
          critical_chance: 0,
          area: 0,
          area_type: 'circle',
          modifiable_range: false,
          line_of_sight: false,
          linear: false,
          free_cell: false,
          base_effects: [
            { type: 'summon', summon: 'wolf', target: 'cell', chance: 100 },
          ],
          critical_effects: [],
        },
      ],
    },
  },
}

const spell_templates = normalize_spell_templates(SPELLS_JSON)

const make_player = (id, cell, overrides = {}) => ({
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
  is_player: true,
  template_id: 'yajin',
  level: 1,
  stats: {},
  effects: [],
  deck: ['summon1'],
  hand: [],
  discard: [],
  spell_levels: { summon1: 1 },
  ap_reserve: 0,
  ...overrides,
})

const make_mob = (id, cell, overrides = {}) => ({
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
  stats: {},
  effects: [],
  deck: [],
  hand: [MOB_ATTACK_ID],
  discard: [],
  spell_levels: { [MOB_ATTACK_ID]: 1 },
  ap_reserve: 0,
  ...overrides,
})

const fight = (
  seed = 1,
  { p = {}, m = {}, templates = spell_templates } = {},
) => {
  const arena = flat_arena()
  const ctx = { spell_templates: templates, arena }
  const state = create_fight_state({
    fight_id: 'f',
    arena_seed: seed,
    arena_radius: arena.radius,
    arena,
    team0: [make_player('p0', { x: 4, y: 5 }, p)],
    team1: [make_mob('m0', { x: 6, y: 5 }, m)],
  })
  return { state: reduce(state, { type: 'start' }, ctx).state, ctx }
}

const cast = (state, ctx, entity_id, spell_id, target) =>
  reduce(state, { type: 'cast', entity_id, spell_id, target }, ctx)
const end = (state, ctx, entity_id) =>
  reduce(state, { type: 'end_turn', entity_id }, ctx)
const ai = (state, ctx, entity_id) =>
  reduce(state, { type: 'ai_turn', entity_id }, ctx)

const summon_of = state => state.team0.find(e => e.is_summon)

// ── Spawn ───────────────────────────────────────────────────────────────────
describe('SUMMON spawns a minion', () => {
  test('appends an AI minion to the caster team AND the turn order', () => {
    const { state, ctx } = fight(1)
    const r = cast(state, ctx, 'p0', 'summon1', { x: 4, y: 5 })
    expect(r.state.team0.length).toBe(2)
    const s = summon_of(r.state)
    expect(s).toBeDefined()
    expect(s.is_player).toBe(false)
    expect(s.is_summon).toBe(true)
    expect(s.variant).toBe('wolf')
    expect(s.health).toBe(40) // 30 + level(1) * 10
    expect(s.health_max).toBe(40)
    // p0 occupies (4,5) -> the minion takes the first free neighbor in scan order, (5,5)
    expect(s.cell).toEqual({ x: 5, y: 5 })
    expect(r.state.turn_order).toContain(s.id)
    // the cast reports the spawn (the server maps status:'SUMMON' to a board spawn)
    const evt = r.events.find(e => e.type === 'fight_cast')
    expect(evt.effects.some(x => x.status === 'SUMMON')).toBe(true)
  })

  test('the minion HP scales with the summoner level', () => {
    const { state, ctx } = fight(1, { p: { level: 5 } })
    const r = cast(state, ctx, 'p0', 'summon1', { x: 4, y: 5 })
    expect(summon_of(r.state).health).toBe(80) // 30 + 5 * 10
    expect(summon_of(r.state).level).toBe(5)
  })
})

// ── It takes turns + fights ─────────────────────────────────────────────────
describe('SUMMON takes AI turns and attacks', () => {
  test('the minion damages an adjacent enemy on its own turn', () => {
    const { state, ctx } = fight(2)
    const summoned = cast(state, ctx, 'p0', 'summon1', { x: 4, y: 5 })
    const s = summon_of(summoned.state)
    expect(s.cell).toEqual({ x: 5, y: 5 }) // adjacent to m0 at (6,5)

    // p0 ends -> m0's AI turn -> advances to the minion's turn
    const after_p0 = end(summoned.state, ctx, 'p0')
    const after_m0 = ai(after_p0.state, ctx, 'm0')
    expect(get_current_turn_entity(after_m0.state).id).toBe(s.id)

    const m0_before = find_entity(after_m0.state, 'm0').health
    const after_summon = ai(after_m0.state, ctx, s.id)
    // the minion cast MOB_ATTACK on the adjacent mob -> it lost health
    expect(find_entity(after_summon.state, 'm0').health).toBeLessThan(m0_before)
  })
})

// ── Death = corpse (skipped, not removed) ───────────────────────────────────
describe('SUMMON dies as a corpse', () => {
  test('a dead minion is skipped by the turn advance and lingers in state', () => {
    const { state, ctx } = fight(3)
    const summoned = cast(state, ctx, 'p0', 'summon1', { x: 4, y: 5 })
    const s = summon_of(summoned.state)
    // kill the minion outright
    const killed = reduce(
      summoned.state,
      { type: 'abandon', entity_id: s.id },
      ctx,
    )
    expect(find_entity(killed.state, s.id).health).toBe(0)
    expect(killed.state.winner).toBe(-1) // p0 still alive -> fight continues

    // cycle: p0 ends, m0 AI -> the dead minion is stepped over, turn returns to p0
    const after_p0 = end(killed.state, ctx, 'p0')
    const after_m0 = ai(after_p0.state, ctx, 'm0')
    expect(get_current_turn_entity(after_m0.state).id).toBe('p0')
    // the corpse is still present (not spliced out -> no turn-order index desync)
    expect(find_entity(after_m0.state, s.id)).not.toBeNull()
  })
})

// ── Determinism ─────────────────────────────────────────────────────────────
describe('determinism with summons', () => {
  const run = () => {
    const { state, ctx } = fight(987654)
    const summoned = cast(state, ctx, 'p0', 'summon1', { x: 4, y: 5 })
    const s = summon_of(summoned.state)
    const cmds = [
      { type: 'end_turn', entity_id: 'p0' },
      { type: 'ai_turn', entity_id: 'm0' },
      { type: 'ai_turn', entity_id: s.id },
    ]
    return cmds.reduce(
      (acc, cmd) => {
        const r = reduce(acc.state, cmd, ctx)
        return { state: r.state, events: [...acc.events, ...r.events] }
      },
      { state: summoned.state, events: summoned.events },
    )
  }
  test('same seed -> deep-equal {state, events, rng}', () => {
    const a = run()
    const b = run()
    expect(a.state).toEqual(b.state)
    expect(a.events).toEqual(b.events)
    expect(a.state.rng).toBe(b.state.rng)
  })
})

// ── Summon cap (the `summons` stat) ──────────────────────────────────
// summon_entity enforces a per-caster cap = (stats.summons ?? 1) + summons buffs. Tested directly (the pure
// spawn fn) so the card system (a cast discards the spell) doesn't get in the way of casting twice.
describe('per-caster summon cap', () => {
  const all_walkable = () => true
  // Minimal FightState with the caster alone on team0 (summon_entity needs team_of / find_entity_at / next_id;
  // it never touches rng). owner_id on each spawn is what scopes the cap to the summoner.
  const cap_state = caster => ({
    fight_id: 'cap',
    arena_seed: 1,
    arena_radius: 5,
    started: true,
    ready: [],
    rng: 1,
    next_id: 10,
    team0: [caster],
    team1: [],
    turn_order: [caster.id],
    current_turn_idx: 0,
    turn_number: 1,
    traps: [],
    glyphs: [],
    team0_cells: [],
    team1_cells: [],
    winner: -1,
  })

  test('a fresh spawn stamps owner_id = the caster', () => {
    const caster = make_player('p0', { x: 4, y: 5 }, { stats: { summons: 1 } })
    const r = summon_entity(
      cap_state(caster),
      caster,
      { x: 4, y: 5 },
      all_walkable,
      'wolf',
    )
    const s = r.state.team0.find(e => e.is_summon)
    expect(s.owner_id).toBe('p0')
  })

  test('cap defaults to 1 with no summons stat: a 2nd summon is a no-op', () => {
    const caster = make_player('p0', { x: 4, y: 5 }, { stats: {} })
    const first = summon_entity(
      cap_state(caster),
      caster,
      { x: 4, y: 5 },
      all_walkable,
      'wolf',
    )
    expect(first.state.team0.length).toBe(2)
    expect(first.effects.length).toBe(1)
    // caster already owns 1 living summon -> at cap 1 the next summon is refused (no team/effect change)
    const second = summon_entity(
      first.state,
      caster,
      { x: 4, y: 5 },
      all_walkable,
      'wolf',
    )
    expect(second.state.team0.length).toBe(2)
    expect(second.effects).toEqual([])
  })

  test('summons stat 2 allows two summons, blocks the third', () => {
    const caster = make_player('p0', { x: 4, y: 5 }, { stats: { summons: 2 } })
    const a = summon_entity(
      cap_state(caster),
      caster,
      { x: 4, y: 5 },
      all_walkable,
      'wolf',
    )
    const b = summon_entity(
      a.state,
      caster,
      { x: 4, y: 5 },
      all_walkable,
      'wolf',
    )
    expect(b.state.team0.length).toBe(3) // caster + 2 summons
    const c = summon_entity(
      b.state,
      caster,
      { x: 4, y: 5 },
      all_walkable,
      'wolf',
    )
    expect(c.state.team0.length).toBe(3) // third refused
    expect(c.effects).toEqual([])
  })

  test('an in-fight summons buff raises the cap', () => {
    const caster = make_player(
      'p0',
      { x: 4, y: 5 },
      {
        stats: { summons: 1 },
        effects: [
          {
            id: 1,
            type: 'STAT_BUFF',
            timing: 'DIRECT',
            source_id: 'p0',
            value: 1,
            stat: 'summons',
            turns_remaining: 2,
          },
        ],
      },
    )
    // cap = base 1 + buff 1 = 2
    const a = summon_entity(
      cap_state(caster),
      caster,
      { x: 4, y: 5 },
      all_walkable,
      'wolf',
    )
    const b = summon_entity(
      a.state,
      caster,
      { x: 4, y: 5 },
      all_walkable,
      'wolf',
    )
    expect(b.state.team0.length).toBe(3)
  })

  test('a dead summon frees a cap slot (only LIVING summons count)', () => {
    const caster = make_player('p0', { x: 4, y: 5 }, { stats: { summons: 1 } })
    const first = summon_entity(
      cap_state(caster),
      caster,
      { x: 4, y: 5 },
      all_walkable,
      'wolf',
    )
    // kill the summon: a corpse no longer counts toward the cap
    const dead = {
      ...first.state,
      team0: first.state.team0.map(e =>
        e.is_summon ? { ...e, health: 0 } : e,
      ),
    }
    const again = summon_entity(
      dead,
      caster,
      { x: 4, y: 5 },
      all_walkable,
      'wolf',
    )
    expect(again.effects.length).toBe(1) // re-summon allowed (the corpse doesn't occupy a slot)
  })
})

// ── Real content ────────────────────────────────────────────────────────────
describe('real spells.json SUMMON spawns minions', () => {
  const real = normalize_spell_templates(real_spells)
  const real_fight = deck => {
    const arena = flat_arena()
    const ctx = { spell_templates: real, arena }
    const state = create_fight_state({
      fight_id: 'f',
      arena_seed: 11,
      arena_radius: arena.radius,
      arena,
      team0: [
        make_player(
          'p0',
          { x: 4, y: 5 },
          {
            deck,
            spell_levels: Object.fromEntries(deck.map(s => [s, 1])),
          },
        ),
      ],
      team1: [make_mob('m0', { x: 8, y: 5 })],
    })
    return { state: reduce(state, { type: 'start' }, ctx).state, ctx }
  }

  test('yajin/arise summons "igris"', () => {
    const { state, ctx } = real_fight(['arise'])
    const r = cast(state, ctx, 'p0', 'arise', { x: 4, y: 5 })
    expect(summon_of(r.state)?.variant).toBe('igris')
  })

  test('rojin/dummy summons a generic (no variant) minion', () => {
    const { state, ctx } = real_fight(['dummy'])
    const r = cast(state, ctx, 'p0', 'dummy', { x: 4, y: 5 })
    const s = summon_of(r.state)
    expect(s).toBeDefined()
    expect(s.variant).toBeUndefined()
    expect(s.name).toBe('Summon')
  })
})
