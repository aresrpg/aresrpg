// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, test, expect } from 'bun:test'

import { reduce, create_fight_state } from '../src/reduce.js'
import {
  process_spell_cast,
  check_cast_limits,
  record_cast,
} from '../src/fight_spells.js'
import { normalize_spell_templates } from '../src/spell_templates.js'

// ───────────────────────────────────────────────────────────────────────────────
// PARITY oracle for cooldown / casts_per_turn / casts_per_target, mirroring
// aresrpg_fight::cast::enforce_and_record_cast (packages/move/engine/sources/cast.move:160-192).
// The Move rule this suite pins, quoted verbatim from cast.move:
//   let this_turn = if (rec.last_turn == t) rec.casts_this_turn else 0;          // :169 lazy reset
//   if (cooldown > 0) assert!(t - rec.last_turn > (cooldown as u64), ...);       // :170 STRICT `>`
//   assert!((this_turn as u64) < (casts_per_turn as u64), ...);                  // :171
//   assert!((this_target as u64) < (casts_per_target as u64), ...);             // :184
// UNLIMITED sentinel = 255 (cast.move:43). The clock `t` is FightState.turn_number.
// ───────────────────────────────────────────────────────────────────────────────

const CELL = { x: 7, y: 4 }

// A minimal FightState slice the pure §2 helpers read (turn_number + the two history maps).
const S = (turn_number, cast_history = {}, target_history = {}) => ({
  turn_number,
  cast_history,
  target_history,
})
// A SpellLevel limit triplet — defaults are the "no limit" sentinels, override what a case exercises.
const SL = o => ({
  cooldown_turns: 0,
  casts_per_turn: 255,
  casts_per_target: 255,
  ...o,
})

// ── PURE §2 RULE — check_cast_limits + record_cast, exact Move arithmetic ──────
describe('cast limits — §2 rule (bit-for-bit mirror of cast.move:160-192)', () => {
  test('no authored limit (255/255/0) never tracks and never blocks; record is a no-op', () => {
    const sl = SL({}) // cooldown 0, both caps 255
    const s = S(1)
    expect(check_cast_limits(s, 'p0', 'sp', sl, CELL)).toEqual({ valid: true })
    // record returns the SAME state object untouched (cast.move:163 — the common case pays nothing)
    expect(record_cast(s, 'p0', 'sp', sl, CELL)).toBe(s)
  })

  test('casts_per_turn cap: first two pass same turn, third blocks; resets next turn', () => {
    const sl = SL({ casts_per_turn: 2 })
    let s = S(1)
    expect(check_cast_limits(s, 'p0', 'sp', sl, CELL).valid).toBe(true)
    s = record_cast(s, 'p0', 'sp', sl, CELL)
    expect(s.cast_history['p0:sp']).toEqual({
      last_turn: 1,
      casts_this_turn: 1,
    })
    expect(check_cast_limits(s, 'p0', 'sp', sl, CELL).valid).toBe(true) // 1 < 2
    s = record_cast(s, 'p0', 'sp', sl, CELL)
    expect(s.cast_history['p0:sp']).toEqual({
      last_turn: 1,
      casts_this_turn: 2,
    })
    expect(check_cast_limits(s, 'p0', 'sp', sl, CELL)).toEqual({
      valid: false,
      error: 'CASTS_PER_TURN',
    }) // 2 < 2 is false
    // lazy per-turn reset (cast.move:169): a fresh turn zeroes the counter
    expect(
      check_cast_limits({ ...s, turn_number: 2 }, 'p0', 'sp', sl, CELL).valid,
    ).toBe(true)
  })

  test('cooldown boundary proven BOTH WAYS — strict `>` (cast.move:170), NOT `>=`', () => {
    const sl = SL({ cooldown_turns: 1 })
    const s = record_cast(S(1), 'p0', 'sp', sl, CELL) // cast on turn T=1
    expect(s.cast_history['p0:sp']).toEqual({
      last_turn: 1,
      casts_this_turn: 1,
    })
    // T (same turn): t-last = 0 > 1 ? NO → blocked
    expect(
      check_cast_limits({ ...s, turn_number: 1 }, 'p0', 'sp', sl, CELL),
    ).toEqual({
      valid: false,
      error: 'SPELL_ON_COOLDOWN',
    })
    // T+1: t-last = 1 > 1 ? NO → blocked. THE off-by-one guard: `>=` would WRONGLY re-enable here and burn a
    // doomed tx (the one-line premortem). Move uses strict `>`, so turn T+1 stays on cooldown.
    expect(
      check_cast_limits({ ...s, turn_number: 2 }, 'p0', 'sp', sl, CELL),
    ).toEqual({
      valid: false,
      error: 'SPELL_ON_COOLDOWN',
    })
    // T+C+1 = 3: t-last = 2 > 1 ? YES → re-enabled
    expect(
      check_cast_limits({ ...s, turn_number: 3 }, 'p0', 'sp', sl, CELL).valid,
    ).toBe(true)
  })

  test('casts_per_target: same cell blocks, a different cell same turn is free', () => {
    const sl = SL({ casts_per_target: 1 })
    const A = { x: 7, y: 4 }
    const B = { x: 7, y: 5 }
    const s = record_cast(S(1), 'p0', 'sp', sl, A)
    expect(s.target_history['p0:sp:7,4']).toEqual({ last_turn: 1, casts: 1 })
    expect(check_cast_limits(s, 'p0', 'sp', sl, A)).toEqual({
      valid: false,
      error: 'CASTS_PER_TARGET',
    })
    expect(check_cast_limits(s, 'p0', 'sp', sl, B).valid).toBe(true) // distinct TargetKey cell
    expect(
      check_cast_limits({ ...s, turn_number: 2 }, 'p0', 'sp', sl, A).valid,
    ).toBe(true) // reset
  })

  test('cooldown + casts_per_turn are independent AND-gates; cooldown is checked first', () => {
    // C=1, per_turn unlimited → cooldown alone collapses it to once-per-turn.
    const cd = SL({ cooldown_turns: 1, casts_per_turn: 255 })
    const s1 = record_cast(S(1), 'p0', 'a', cd, CELL)
    expect(
      check_cast_limits({ ...s1, turn_number: 1 }, 'p0', 'a', cd, CELL).error,
    ).toBe('SPELL_ON_COOLDOWN')
    expect(
      check_cast_limits({ ...s1, turn_number: 3 }, 'p0', 'a', cd, CELL).valid,
    ).toBe(true)
    // C=0, per_turn=1 → once per turn but recastable the very NEXT turn (no cooldown skip).
    const pt = SL({ cooldown_turns: 0, casts_per_turn: 1 })
    const s2 = record_cast(S(1), 'p0', 'b', pt, CELL)
    expect(
      check_cast_limits({ ...s2, turn_number: 1 }, 'p0', 'b', pt, CELL).error,
    ).toBe('CASTS_PER_TURN')
    expect(
      check_cast_limits({ ...s2, turn_number: 2 }, 'p0', 'b', pt, CELL).valid,
    ).toBe(true)
  })

  test('save/resume mid-cooldown — history survives JSON round-trip and still enforces', () => {
    const sl = SL({ cooldown_turns: 2 }) // free only when t - 1 > 2, i.e. t >= 4
    const s = record_cast(S(1), 'p0', 'sp', sl, CELL)
    const resumed = JSON.parse(JSON.stringify(s))
    expect(
      check_cast_limits({ ...resumed, turn_number: 2 }, 'p0', 'sp', sl, CELL)
        .valid,
    ).toBe(false)
    expect(
      check_cast_limits({ ...resumed, turn_number: 3 }, 'p0', 'sp', sl, CELL)
        .valid,
    ).toBe(false)
    expect(
      check_cast_limits({ ...resumed, turn_number: 4 }, 'p0', 'sp', sl, CELL)
        .valid,
    ).toBe(true)
  })
})

// ── WIRING — the limits enforce through the real process_spell_cast pipeline ───
const SPELLS_JSON = {
  testclass: {
    cd1: spell({ cooldown_turns: 1 }),
    cd2: spell({ cooldown_turns: 2 }),
    pt1: spell({ casts_per_turn: 1 }),
    pt2: spell({ casts_per_turn: 2 }),
    tgt1: spell({ casts_per_target: 1 }),
    free: spell({}), // 255 / 255 / 0 — unlimited
  },
}
function spell(limits) {
  return {
    name: 'S',
    description: '',
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
            max: 1,
            element: 'fire',
            target: 'enemies',
            chance: 100,
          },
        ],
        critical_effects: [],
        ...limits,
      },
    ],
  }
}

const spell_templates = normalize_spell_templates(SPELLS_JSON)
const flat_arena = () => ({
  width: 9,
  radius: 4,
  center: { x: 4, y: 4 },
  cells: new Uint8Array(81),
  spawns_a: [{ x: 1, y: 4 }],
  spawns_b: [{ x: 7, y: 4 }],
})
const entity = (id, cell, is_player) => ({
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
  template_id: 'testclass',
  level: 1,
  stats: { agility: 0, intelligence: 0, range: 0 },
  effects: [],
  spell_levels: {},
  ap_reserve: 0,
})
// A started fight state at a chosen turn_number (process_spell_cast reads state.started + turn_number directly).
const started = (
  turn_number = 1,
  mobs = [entity('m0', { x: 7, y: 4 }, false)],
) => ({
  ...create_fight_state({
    fight_id: 'f',
    arena_seed: 1,
    arena_radius: 4,
    arena: flat_arena(),
    team0: [entity('p0', { x: 1, y: 4 }, true)],
    team1: mobs,
  }),
  started: true,
  turn_number,
})
// No obstacles, nothing blocks LoS — a clear ranged shot (mob occupancy is fine for a non-free_cell damage spell).
const CTX = { blocks_los: () => false, is_occupied: () => false }

describe('cast limits — wiring through process_spell_cast (validate + record)', () => {
  test('unlimited spell casts freely and records NOTHING (history stays empty)', () => {
    const r = process_spell_cast(
      started(1),
      'p0',
      spell_templates.get('free'),
      1,
      CELL,
      CTX,
    )
    expect(r.success).toBe(true)
    expect(Object.keys(r.state.cast_history)).toHaveLength(0)
    expect(Object.keys(r.state.target_history)).toHaveLength(0)
  })

  test('casts_per_turn=2 — third same-turn cast is refused CASTS_PER_TURN', () => {
    const sp = spell_templates.get('pt2')
    const r1 = process_spell_cast(started(1), 'p0', sp, 1, CELL, CTX)
    const r2 = process_spell_cast(r1.state, 'p0', sp, 1, CELL, CTX)
    const r3 = process_spell_cast(r2.state, 'p0', sp, 1, CELL, CTX)
    expect([r1.success, r2.success]).toEqual([true, true])
    expect(r3).toMatchObject({ success: false, error: 'CASTS_PER_TURN' })
  })

  test('cooldown blocks a same-turn recast and stays blocked until turn T+C+1 (real turn_number clock)', () => {
    const sp = spell_templates.get('cd1') // C = 1
    const c1 = process_spell_cast(started(1), 'p0', sp, 1, CELL, CTX)
    expect(c1.success).toBe(true)
    // same turn: blocked
    expect(process_spell_cast(c1.state, 'p0', sp, 1, CELL, CTX)).toMatchObject({
      success: false,
      error: 'SPELL_ON_COOLDOWN',
    })
    // caster's next turn (turn_number bumps once per round — proven below): T+1 still blocked
    expect(
      process_spell_cast(
        { ...c1.state, turn_number: 2 },
        'p0',
        sp,
        1,
        CELL,
        CTX,
      ),
    ).toMatchObject({ success: false, error: 'SPELL_ON_COOLDOWN' })
    // T+C+1 = 3: re-enabled
    expect(
      process_spell_cast(
        { ...c1.state, turn_number: 3 },
        'p0',
        sp,
        1,
        CELL,
        CTX,
      ).success,
    ).toBe(true)
  })

  test('casts_per_target=1 — same cell refused, a different living target is free same turn', () => {
    const sp = spell_templates.get('tgt1')
    const s = started(1, [
      entity('m0', { x: 7, y: 4 }, false),
      entity('m1', { x: 7, y: 5 }, false),
    ])
    const a1 = process_spell_cast(s, 'p0', sp, 1, { x: 7, y: 4 }, CTX)
    expect(a1.success).toBe(true)
    expect(
      process_spell_cast(a1.state, 'p0', sp, 1, { x: 7, y: 4 }, CTX),
    ).toMatchObject({
      success: false,
      error: 'CASTS_PER_TARGET',
    })
    expect(
      process_spell_cast(a1.state, 'p0', sp, 1, { x: 7, y: 5 }, CTX).success,
    ).toBe(true)
  })
})

// ── TWIN VECTOR (D450) — MOB cooldown parity: the sim mob cast ↔ the chain's resolve_mob_cast ─────────────────
// The sim has always enforced mob cooldowns uniformly (a mob resolves through the SAME process_spell_cast /
// check_cast_limits as a player, keyed by the mob's own id + spell); the chain did NOT until this lane. These rows
// are the shared vector: the SAME cooldown (2) over the SAME turn sequence, asserting the SAME refuse/allow
// verdicts as the Move twin `aresrpg_fight::mob_cooldown_tests` (a mob refused turns 2 & 3, castable again turn 4).
// Sim clock = the mob's per-round turn_number; chain clock = the mob's own action_envelope::mob_turn — both bump
// once per round, so `t − last_turn > cooldown` is bit-identical on both sides.
describe('cast limits — TWIN mob cooldown parity (sim ↔ resolve_mob_cast)', () => {
  const PLAYER = { x: 1, y: 4 }

  test('a mob cooldown-2 cast is refused turns 2 & 3, re-enabled turn 4 (chain resolve_mob_cast twin)', () => {
    const sp = spell_templates.get('cd2') // cooldown 2 turns
    // Turn 1 — the mob 'm0' casts at the player; first-ever cast lands and is recorded under the MOB's key.
    const c1 = process_spell_cast(started(1), 'm0', sp, 1, PLAYER, CTX)
    expect(c1.success).toBe(true)
    expect(c1.state.cast_history['m0:cd2']).toEqual({
      last_turn: 1,
      casts_this_turn: 1,
    })
    // Turn 2 — 2 − 1 = 1, NOT > 2 → still on cooldown (chain: mob_can_cast === false).
    expect(
      process_spell_cast(
        { ...c1.state, turn_number: 2 },
        'm0',
        sp,
        1,
        PLAYER,
        CTX,
      ),
    ).toMatchObject({
      success: false,
      error: 'SPELL_ON_COOLDOWN',
    })
    // Turn 3 — 3 − 1 = 2, NOT > 2 → still on cooldown.
    expect(
      process_spell_cast(
        { ...c1.state, turn_number: 3 },
        'm0',
        sp,
        1,
        PLAYER,
        CTX,
      ),
    ).toMatchObject({
      success: false,
      error: 'SPELL_ON_COOLDOWN',
    })
    // Turn 4 — 4 − 1 = 3 > 2 → re-enabled (chain: the lawful-cadence cast lands again).
    expect(
      process_spell_cast(
        { ...c1.state, turn_number: 4 },
        'm0',
        sp,
        1,
        PLAYER,
        CTX,
      ).success,
    ).toBe(true)
    // sanity: the caster really is a mob (is_player false), so this is the mob path, not a player recast.
    expect(started(1).team1.find(e => e.id === 'm0')?.is_player ?? false).toBe(
      false,
    )
  })

  test('a mob per-turn=1 cap refuses the second same-turn cast, resets next turn (chain twin)', () => {
    const sp = spell_templates.get('pt1') // one cast per turn, no cooldown
    const r1 = process_spell_cast(started(1), 'm0', sp, 1, PLAYER, CTX)
    expect(r1.success).toBe(true)
    expect(
      process_spell_cast(r1.state, 'm0', sp, 1, PLAYER, CTX),
    ).toMatchObject({
      success: false,
      error: 'CASTS_PER_TURN',
    })
    // next round resets lazily → castable again
    expect(
      process_spell_cast(
        { ...r1.state, turn_number: 2 },
        'm0',
        sp,
        1,
        PLAYER,
        CTX,
      ).success,
    ).toBe(true)
  })
})

// ── CLOCK IDENTITY — turn_number == the round index == Move seat_turn (§1 invariant) ──
describe('cast limits — the cooldown clock is turn_number', () => {
  test('turn_number is 1 in round 1 and +1 per COMPLETED round (matches Move seat_turn)', () => {
    const ctx = { spell_templates, arena: flat_arena() }
    const base = create_fight_state({
      fight_id: 'f',
      arena_seed: 1,
      arena_radius: 4,
      arena: flat_arena(),
      team0: [entity('p0', { x: 1, y: 4 }, true)],
      team1: [entity('m0', { x: 7, y: 4 }, false)],
    })
    const { state } = reduce(base, { type: 'start' }, ctx)
    expect(state.turn_number).toBe(1) // Move: every seat's SeatTurnKey == 1 on its first turn
    // Complete one full round: p0 ends, m0 (mob) takes its AI turn which ends it → wrap to idx 0.
    const after_p = reduce(state, { type: 'end_turn', entity_id: 'p0' }, ctx)
    const after_round = reduce(
      after_p.state,
      { type: 'ai_turn', entity_id: 'm0' },
      ctx,
    )
    expect(after_round.state.turn_number).toBe(2)
    expect(after_round.state.current_turn_idx).toBe(0)
  })
})
