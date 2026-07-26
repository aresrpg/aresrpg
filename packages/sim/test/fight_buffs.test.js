// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, test, expect } from 'bun:test'

import { reduce, create_fight_state } from '../src/reduce.js'
import { normalize_spell_templates } from '../src/spell_templates.js'
import { find_entity, effective_stats } from '../src/fight_state.js'
// The real shipped content — proves the actual 12-class kits map onto functional ADD/REMOVE handlers.
import real_spells from '../../sdk/src/spells.json'

// ── Fixtures ─────────────────────────────────────────────────────────────────
// A flat all-walkable arena; a duel (both is_player) so turns are driven purely by end_turn (no AI noise).
const flat_arena = (width = 11) => ({
  width,
  radius: (width - 1) / 2,
  center: { x: (width - 1) / 2, y: (width - 1) / 2 },
  cells: new Uint8Array(width * width),
  spawns_a: [{ x: 1, y: 5 }],
  spawns_b: [{ x: 9, y: 5 }],
})

// Buff/debuff spells in AresRPG JSON shape, run through the REAL normalizer so the handlers see what ships.
//   str_buff   — ADD strength +100 for 3 turns (self, range 0) — proves a stat buff is FELT in damage.
//   str_buff1  — ADD strength +50 for 1 turn  (self)            — proves a buff expires after its duration.
//   str_debuff — REMOVE strength 100 for 3 turns (enemies)      — proves a stat debuff (signed fold).
//   mp_buff    — ADD mp +3 for 2 turns (self)                   — proves an ap/mp pool modifier.
//   mp_debuff  — REMOVE mp 3 for 2 turns (enemies)              — proves a pool debuff.
//   earth_dmg  — DAMAGE earth 10 (enemies)                      — the probe whose damage the buff scales.
//   filler     — no effect (deck padding).
const lvl = (cost, range, base_effects) => ({
  cost,
  range,
  critical_chance: 0,
  area: 0,
  area_type: 'circle',
  modifiable_range: false,
  line_of_sight: false,
  linear: false,
  free_cell: false,
  base_effects,
  critical_effects: [],
})
const SPELLS_JSON = {
  senshi: {
    str_buff: {
      name: 'Str Buff',
      description: 'b',
      levels: [
        lvl(
          1,
          [0, 8],
          [
            {
              type: 'add',
              statistic: 'strength',
              min: 100,
              max: 100,
              target: 'cell',
              chance: 100,
              turns: 3,
            },
          ],
        ),
      ],
    },
    str_buff1: {
      name: 'Str Buff 1t',
      description: 'b',
      levels: [
        lvl(
          1,
          [0, 8],
          [
            {
              type: 'add',
              statistic: 'strength',
              min: 50,
              max: 50,
              target: 'cell',
              chance: 100,
              turns: 1,
            },
          ],
        ),
      ],
    },
    str_debuff: {
      name: 'Str Debuff',
      description: 'd',
      levels: [
        lvl(
          1,
          [1, 8],
          [
            {
              type: 'remove',
              statistic: 'strength',
              min: 100,
              max: 100,
              target: 'enemies',
              chance: 100,
              turns: 3,
            },
          ],
        ),
      ],
    },
    mp_buff: {
      name: 'MP Buff',
      description: 'b',
      levels: [
        lvl(
          1,
          [0, 0],
          [
            {
              type: 'add',
              statistic: 'mp',
              min: 3,
              max: 3,
              target: 'cell',
              chance: 100,
              turns: 2,
            },
          ],
        ),
      ],
    },
    mp_debuff: {
      name: 'MP Debuff',
      description: 'd',
      levels: [
        lvl(
          1,
          [1, 8],
          [
            {
              type: 'remove',
              statistic: 'mp',
              min: 3,
              max: 3,
              target: 'enemies',
              chance: 100,
              turns: 2,
            },
          ],
        ),
      ],
    },
    earth_dmg: {
      name: 'Earth',
      description: 'd',
      levels: [
        lvl(
          2,
          [1, 8],
          [
            {
              type: 'damage',
              element: 'earth',
              min: 10,
              max: 10,
              target: 'enemies',
              chance: 100,
            },
          ],
        ),
      ],
    },
    filler: { name: 'Filler', description: 'n', levels: [lvl(1, [1, 8], [])] },
  },
}

const spell_templates = normalize_spell_templates(SPELLS_JSON)
const DECK = [
  'str_buff',
  'str_buff1',
  'str_debuff',
  'mp_buff',
  'mp_debuff',
  'earth_dmg',
  'filler',
]

const make_player = (id, cell, overrides = {}) => ({
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
  stats: {},
  effects: [],
  spell_levels: Object.fromEntries(DECK.map(s => [s, 1])),
  ap_reserve: 0,
  ...overrides,
})

// A started duel: p0 at (1,5), p1 at (9,5). The full deck (7 cards) is drawn into the opening hand.
const duel = (seed = 1, { p0 = {}, p1 = {} } = {}) => {
  const arena = flat_arena()
  const ctx = { spell_templates, arena }
  const state = create_fight_state({
    fight_id: 'f',
    arena_seed: seed,
    arena_radius: arena.radius,
    arena,
    team0: [make_player('p0', { x: 1, y: 5 }, p0)],
    team1: [make_player('p1', { x: 9, y: 5 }, p1)],
  })
  return { state: reduce(state, { type: 'start' }, ctx).state, ctx }
}

const cast = (state, ctx, entity_id, spell_id, target) =>
  reduce(state, { type: 'cast', entity_id, spell_id, target }, ctx)
const end = (state, ctx, entity_id) =>
  reduce(state, { type: 'end_turn', entity_id }, ctx)

// ── ADD: stat buff ───────────────────────────────────────────────────────────
describe('ADD stat buff', () => {
  test('stores a STAT_BUFF the effective_stats fold reflects', () => {
    const { state, ctx } = duel(1)
    const r = cast(state, ctx, 'p0', 'str_buff', { x: 1, y: 5 })
    const buff = find_entity(r.state, 'p0').effects.find(
      e => e.type === 'STAT_BUFF',
    )
    expect(buff).toBeDefined()
    expect(buff.stat).toBe('strength')
    expect(buff.value).toBe(100)
    expect(buff.turns_remaining).toBe(3)
    // base strength 0 + 100 modifier = 100 effective
    expect(effective_stats(find_entity(r.state, 'p0')).strength).toBe(100)
  })

  test('a strength buff INCREASES the earth-damage it scales', () => {
    // control: unbuffed earth_dmg = base 10 × (100 + 0)% = 10
    const ctrl = duel(2)
    const c = cast(ctrl.state, ctrl.ctx, 'p0', 'earth_dmg', { x: 9, y: 5 })
    expect(find_entity(c.state, 'p1').health).toBe(90)

    // buffed: +100 strength -> base 10 × (100 + 100)% = 20
    const { state, ctx } = duel(2)
    const buffed = cast(state, ctx, 'p0', 'str_buff', { x: 1, y: 5 })
    const hit = cast(buffed.state, ctx, 'p0', 'earth_dmg', { x: 9, y: 5 })
    expect(find_entity(hit.state, 'p1').health).toBe(80)
  })
})

// ── REMOVE: stat debuff ───────────────────────────────────────────────────────
describe('REMOVE stat debuff', () => {
  test('stores a STAT_DEBUFF the fold subtracts (can go negative)', () => {
    // p1 carries base strength 50 so the -100 debuff overshoots to -50 (asserted below). Under the §17.28
    // GLOBAL INTERLEAVE, team0 (side A, = p0) ALWAYS opens regardless of stats, so p0's cast lands first.
    const { state, ctx } = duel(3, {
      p0: { stats: { strength: 50 } },
      p1: { stats: { strength: 50 } },
    })
    const r = cast(state, ctx, 'p0', 'str_debuff', { x: 9, y: 5 })
    const debuff = find_entity(r.state, 'p1').effects.find(
      e => e.type === 'STAT_DEBUFF',
    )
    expect(debuff).toBeDefined()
    expect(debuff.stat).toBe('strength')
    // base 50 - 100 modifier = -50 effective (a debuff that overshoots base is allowed)
    expect(effective_stats(find_entity(r.state, 'p1')).strength).toBe(-50)
  })
})

// ── ADD/REMOVE: ap/mp pool modifiers ───────────────────────────────────────────
describe('ap/mp pool modifiers', () => {
  test('an mp buff bites the pool NOW and persists via the effective turn-refill', () => {
    const { state, ctx } = duel(4)
    expect(find_entity(state, 'p0').mp).toBe(5)
    const buffed = cast(state, ctx, 'p0', 'mp_buff', { x: 1, y: 5 })
    // immediate: current mp 5 -> 8
    expect(find_entity(buffed.state, 'p0').mp).toBe(8)
    // cycle p0 -> p1 -> p0: the turn-start refill uses the EFFECTIVE max (5 + 3) while the buff is live
    const round = end(end(buffed.state, ctx, 'p0').state, ctx, 'p1')
    expect(find_entity(round.state, 'p0').mp).toBe(8)
  })

  // #598 (twin-parity): a turns=2 mp buff must boost the pool on its cast turn + ONE refill, then wear off —
  // exactly like the strength buff above and like Move's give CREDIT row (aged at the prior turn-END, so its
  // begin_turn refill never sees an expiring credit). The sim USED to refill from the row one turn too long
  // (advance_turn reads the effective max BEFORE process_turn_effects drops the expiring row), granting a turn
  // the chain had already expired — the "+1 MP badge showed but the MP was unusable" field report.
  test('an mp buff wears off after its 2 turns — pool back to BASE on turn 3, not the stale buffed max (#598)', () => {
    const { state, ctx } = duel(4)
    const buffed = cast(state, ctx, 'p0', 'mp_buff', { x: 1, y: 5 }) // +3 mp, turns=2
    expect(find_entity(buffed.state, 'p0').mp).toBe(8) // T (cast): immediate 5 -> 8
    const t1 = end(end(buffed.state, ctx, 'p0').state, ctx, 'p1')
    expect(find_entity(t1.state, 'p0').mp).toBe(8) // T+1: buff still live, refill 5 + 3
    // The timed row is gone by T+2 (badge honest); the pool must follow it back to BASE, not linger at 8.
    const t2 = end(end(t1.state, ctx, 'p0').state, ctx, 'p1')
    expect(
      find_entity(t2.state, 'p0').effects.filter(e => e.stat === 'mp').length,
    ).toBe(0)
    expect(find_entity(t2.state, 'p0').mp).toBe(5) // T+2: 2-turn buff expired -> base 5 (was a stale 8)
  })

  test('an mp debuff reduces the enemy pool immediately', () => {
    const { state, ctx } = duel(5)
    const r = cast(state, ctx, 'p0', 'mp_debuff', { x: 9, y: 5 })
    expect(find_entity(r.state, 'p1').mp).toBe(2) // 5 - 3, clamped >= 0
  })
})

// ── Expiry via the existing per-turn plumbing ───────────────────────────────────
describe('buff duration + expiry (process_turn_effects)', () => {
  test('a 1-turn buff is gone after the caster cycles back; a 3-turn buff survives', () => {
    const { state, ctx } = duel(6)
    const short = cast(state, ctx, 'p0', 'str_buff1', { x: 1, y: 5 })
    const long = cast(short.state, ctx, 'p0', 'str_buff', { x: 1, y: 5 })
    expect(
      find_entity(long.state, 'p0').effects.filter(e => e.type === 'STAT_BUFF')
        .length,
    ).toBe(2)
    // one full round: p0 end -> p1 end -> p0 turn-start decrements both buffs once
    const back = end(end(long.state, ctx, 'p0').state, ctx, 'p1')
    const buffs = find_entity(back.state, 'p0').effects.filter(
      e => e.type === 'STAT_BUFF',
    )
    expect(buffs.length).toBe(1) // the 1-turn buff expired; the 3-turn one remains
    expect(buffs[0].turns_remaining).toBe(2)
  })
})

// ── Determinism (same seed + commands -> byte-identical) ────────────────────────
describe('determinism with buffs/debuffs', () => {
  const run = () => {
    const { state, ctx } = duel(424242)
    const cmds = [
      {
        type: 'cast',
        entity_id: 'p0',
        spell_id: 'str_buff',
        target: { x: 1, y: 5 },
      },
      {
        type: 'cast',
        entity_id: 'p0',
        spell_id: 'mp_buff',
        target: { x: 1, y: 5 },
      },
      {
        type: 'cast',
        entity_id: 'p0',
        spell_id: 'earth_dmg',
        target: { x: 9, y: 5 },
      },
      { type: 'end_turn', entity_id: 'p0' },
      {
        type: 'cast',
        entity_id: 'p1',
        spell_id: 'str_debuff',
        target: { x: 1, y: 5 },
      },
      { type: 'end_turn', entity_id: 'p1' },
    ]
    return cmds.reduce(
      (acc, cmd) => {
        const r = reduce(acc.state, cmd, ctx)
        return { state: r.state, events: [...acc.events, ...r.events] }
      },
      { state, events: [] },
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

// ── REAL content (the shipped spells.json) ──────────────────────────────────────
describe('real spells.json ADD/REMOVE map to functional handlers', () => {
  const real = normalize_spell_templates(real_spells)
  const real_duel = deck => {
    const arena = flat_arena()
    const ctx = { spell_templates: real, arena }
    const mk = (id, cell) => ({
      ...make_player(id, cell),
      deck,
      spell_levels: Object.fromEntries(deck.map(s => [s, 1])),
    })
    const state = create_fight_state({
      fight_id: 'f',
      arena_seed: 7,
      arena_radius: arena.radius,
      arena,
      team0: [mk('p0', { x: 4, y: 5 })],
      team1: [mk('p1', { x: 6, y: 5 })],
    })
    return { state: reduce(state, { type: 'start' }, ctx).state, ctx }
  }

  test('senshi/power applies a raw_damage STAT_BUFF', () => {
    const { state, ctx } = real_duel(['power'])
    const r = cast(state, ctx, 'p0', 'power', { x: 4, y: 5 })
    const buff = find_entity(r.state, 'p0').effects.find(
      e => e.type === 'STAT_BUFF',
    )
    expect(buff?.stat).toBe('raw_damage')
  })

  test('senshi/rage maps the `damage` statistic onto a raw_damage buff', () => {
    const { state, ctx } = real_duel(['rage'])
    const r = cast(state, ctx, 'p0', 'rage', { x: 4, y: 5 })
    const buff = find_entity(r.state, 'p0').effects.find(
      e => e.type === 'STAT_BUFF',
    )
    expect(buff?.stat).toBe('raw_damage')
  })

  // Regression: senshi AND tomoda both have a "Rage" spell. The flat normalize Map keys by short id,
  // so before disambiguation tomoda's `rage` silently OVERWROTE senshi's. They must now resolve as
  // two DISTINCT templates (senshi -> `rage`, tomoda -> `tomoda_rage`).
  test('senshi rage and tomoda rage resolve as distinct templates (no short-id collision)', () => {
    const senshi_rage = real.get('rage')
    const tomoda_rage = real.get('tomoda_rage')
    expect(senshi_rage?.id).toBe('rage')
    expect(tomoda_rage?.id).toBe('tomoda_rage')
    // distinct objects with distinct content (senshi's buff is keyed on `damage`, tomoda's is raw_damage)
    expect(senshi_rage).not.toBe(tomoda_rage)
    expect(senshi_rage?.description).not.toBe(tomoda_rage?.description)
  })

  test('tomoda/tomoda_rage applies a raw_damage STAT_BUFF', () => {
    const { state, ctx } = real_duel(['tomoda_rage'])
    const r = cast(state, ctx, 'p0', 'tomoda_rage', { x: 4, y: 5 })
    const buff = find_entity(r.state, 'p0').effects.find(
      e => e.type === 'STAT_BUFF',
    )
    expect(buff?.stat).toBe('raw_damage')
  })

  test('tokei/obscuring_clouds applies mp AND ap STAT_DEBUFFs to enemies', () => {
    const { state, ctx } = real_duel(['obscuring_clouds'])
    const r = cast(state, ctx, 'p0', 'obscuring_clouds', { x: 6, y: 5 })
    const debuffs = find_entity(r.state, 'p1').effects.filter(
      e => e.type === 'STAT_DEBUFF',
    )
    const stats = debuffs.map(d => d.stat).sort()
    expect(stats).toEqual(['ap', 'mp'])
  })
})
