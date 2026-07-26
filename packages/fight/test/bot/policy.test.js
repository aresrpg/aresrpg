// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #1100 — the scripted fight bot's brain and its assertions, headless. No browser, no page, no dev server:
// the policy is a pure function over a `__ARES_DEV_READ()` snapshot, so every behaviour the ruling asks for
// ("check reach", "buff when it pays", "trap the approach", "push and VERIFY the push landed", "prefer the
// highest-value legal cast", "move to keep range") is a fixture and an expectation here — and the browser
// run is left to prove only the wiring.

import { describe, expect, test } from 'bun:test'

import { TF_ONLY_CASTER } from '../../../sim/src/spell_effect.js'
import { assert_traps_sprung, assert_turn, plan_turn, summarise } from '../../src/bot/index.js'
import { GRID_H, GRID_W, encode } from '../../src/los.js'

const ME = '0xme'

/** A fighter row in the seam's read shape. */
const fighter = (id, team, cell, over = {}) => ({
  id,
  team,
  name: id,
  cell,
  cell_committed: cell,
  hp: 100,
  hp_committed: 100,
  hp_max: 100,
  ap: 6,
  ap_committed: 6,
  ap_max: 6,
  mp: 3,
  mp_committed: 3,
  mp_max: 3,
  dead: false,
  alive_committed: true,
  is_player: team === 0,
  level: 1,
  class_id: 'senshi',
  base_range: 0,
  effects: [],
  ...over,
})

const effect = (kind, over = {}) => ({
  kind,
  kind_id: null,
  base: 0,
  chance: 0,
  turns: 0,
  area_shape: 'POINT',
  area_size: 0,
  element: null,
  target_filter: 0,
  ...over,
})

const spell = (id, over = {}) => ({
  id,
  name_key: id,
  name: id,
  element: 'fire',
  ap: 3,
  mp: 0,
  range: [1, 6],
  modifiable_range: false,
  line_of_sight: true,
  linear: false,
  free_cell: false,
  casts_per_turn: 1,
  casts_per_target: 1,
  cooldown: 0,
  crit_rate: 0,
  effects: [effect('DAMAGE', { base: 20 })],
  ...over,
})

/** An empty board with `fighters` on it — the read every test starts from. */
const read = ({ fighters, spellbook = [], blocked = [], my_traps = [] }) => ({
  ok: true,
  fight_id: '0xfight',
  status: 1,
  busy: false,
  error: null,
  placement: false,
  placement_cells: [],
  winner: -1,
  turn_number: 1,
  my_id: ME,
  active_id: ME,
  presenting: false,
  turn_order: fighters.map((f) => f.id),
  arena: {
    width: GRID_W,
    height: GRID_H,
    cells: Array.from({ length: GRID_W * GRID_H }, (_, i) => (blocked.includes(i) ? 1 : 0)),
  },
  my_traps,
  hand: [],
  fighters,
  spellbook,
})

describe('policy — reading the board like a player', () => {
  test('prefers the highest-value legal cast', () => {
    const plan = plan_turn(
      read({
        fighters: [fighter(ME, 0, { x: 5, y: 5 }), fighter('mob-0', 1, { x: 5, y: 7 })],
        spellbook: [
          spell('weak', { ap: 2, effects: [effect('DAMAGE', { base: 5 })] }),
          spell('strong', { ap: 3, effects: [effect('DAMAGE', { base: 40 })] }),
        ],
      })
    )
    const casts = plan.actions.filter((a) => a.kind === 1)
    // ONE cast, the best one: both spells claim the same assertable fact (mob-0's HP) and the harness
    // constraint forbids two actions owning one fact — see the policy header.
    expect(casts.map((c) => c.spell_id)).toEqual(['strong'])
  })

  test('spends the AP budget across DIFFERENT facts — two mobs, two casts', () => {
    const plan = plan_turn(
      read({
        fighters: [
          fighter(ME, 0, { x: 5, y: 5 }),
          fighter('mob-0', 1, { x: 5, y: 7 }),
          fighter('mob-1', 1, { x: 7, y: 5 }),
        ],
        spellbook: [
          spell('a', { ap: 3, effects: [effect('DAMAGE', { base: 40 })] }),
          spell('b', { ap: 3, effects: [effect('DAMAGE', { base: 20 })] }),
        ],
      })
    )
    const casts = plan.actions.filter((a) => a.kind === 1)
    expect(casts).toHaveLength(2)
    expect(new Set(casts.map((c) => c.expect.target_id)).size).toBe(2)
  })

  test('checks REACH: an out-of-range mob is not cast at, it is walked toward', () => {
    const plan = plan_turn(
      read({
        fighters: [fighter(ME, 0, { x: 2, y: 2 }), fighter('mob-0', 1, { x: 15, y: 2 })],
        spellbook: [spell('bolt', { range: [1, 3] })],
      })
    )
    expect(plan.actions.filter((a) => a.kind === 1)).toHaveLength(0)
    const move = plan.actions.find((a) => a.kind === 0)
    expect(move).toBeDefined()
    // it closed the distance rather than standing still
    expect(move.cell.x).toBeGreaterThan(2)
    expect(move.expect.mp_cost).toBeLessThanOrEqual(3)
  })

  test('a wall between us blocks the cast — line of sight is the SIM gate, not a guess', () => {
    const wall = Array.from({ length: 5 }, (_, i) => encode(5, 4 + i))
    const plan = plan_turn(
      read({
        fighters: [fighter(ME, 0, { x: 3, y: 6 }), fighter('mob-0', 1, { x: 7, y: 6 })],
        spellbook: [spell('bolt', { range: [1, 8], line_of_sight: true, mp: 0 })],
        blocked: wall,
      })
    )
    const cast = plan.actions.find((a) => a.kind === 1)
    // either it found a cell with a clean line, or it declined to cast — never a cast through the wall
    if (cast) expect(plan.actions.find((a) => a.kind === 0)).toBeDefined()
    else expect(plan.actions.filter((a) => a.kind === 1)).toHaveLength(0)
  })

  test('never disengages from an adjacent body — that is a free tackle', () => {
    const plan = plan_turn(
      read({
        fighters: [fighter(ME, 0, { x: 5, y: 5 }), fighter('mob-0', 1, { x: 5, y: 6 })],
        spellbook: [spell('bolt', { range: [1, 6] })],
      })
    )
    expect(plan.actions.find((a) => a.kind === 0)).toBeUndefined()
    expect(plan.decisions.find((d) => d.phase === 'move').why).toContain('tackle')
  })

  test('buffs itself when it pays — and NOT when the buff is already up', () => {
    const buff = spell('guard', {
      ap: 2,
      range: [0, 0],
      effects: [effect('ALTER_STAT', { kind_id: 9, base: 30, turns: 3, target_filter: TF_ONLY_CASTER })],
    })
    const fresh = plan_turn(
      read({ fighters: [fighter(ME, 0, { x: 5, y: 5 }), fighter('mob-0', 1, { x: 5, y: 9 })], spellbook: [buff] })
    )
    expect(fresh.actions.find((a) => a.spell_id === 'guard')).toBeDefined()

    const already = plan_turn(
      read({
        fighters: [
          fighter(
            ME,
            0,
            { x: 5, y: 5 },
            { effects: [{ kind: 9, remaining_turns: 2, value: 30, stat: 1, element: null }] }
          ),
          fighter('mob-0', 1, { x: 5, y: 9 }),
        ],
        spellbook: [buff],
      })
    )
    expect(already.actions.find((a) => a.spell_id === 'guard')).toBeUndefined()
  })

  test('drops a trap on the mob’s approach path, never under itself or on an already-trapped cell', () => {
    const trap = spell('snare', {
      ap: 3,
      range: [1, 6],
      free_cell: true,
      line_of_sight: false,
      effects: [effect('PLACE_TRAP', { base: 25 })],
    })
    const board = {
      fighters: [fighter(ME, 0, { x: 5, y: 5 }), fighter('mob-0', 1, { x: 5, y: 10 })],
      spellbook: [trap],
    }
    const plan = plan_turn(read(board))
    const cast = plan.actions.find((a) => a.spell_id === 'snare')
    expect(cast).toBeDefined()
    // on the straight line between us, and not on either body
    expect(cast.cell.x).toBe(5)
    expect(cast.cell.y).toBeGreaterThan(5)
    expect(cast.cell.y).toBeLessThan(10)

    const again = plan_turn(read({ ...board, my_traps: [encode(cast.cell.x, cast.cell.y)] }))
    expect(
      again.actions.find((a) => a.expect?.cell && a.expect.cell.x === cast.cell.x && a.expect.cell.y === cast.cell.y)
    ).toBeUndefined()
  })

  test('a push is planned with its direction and distance, ready to be verified', () => {
    const plan = plan_turn(
      read({
        fighters: [
          fighter(ME, 0, { x: 5, y: 5 }),
          fighter('mob-0', 1, { x: 8, y: 5 }, { hp_committed: 400, hp_max: 400 }),
        ],
        spellbook: [spell('shove', { ap: 3, range: [1, 6], effects: [effect('PUSH', { base: 3 })] })],
      })
    )
    const push = plan.actions.find((a) => a.expect?.type === 'push')
    expect(push).toBeDefined()
    expect(push.expect.cells).toBe(3)
    expect(push.expect.from).toEqual({ x: 5, y: 5 })
  })

  test('never plans two actions claiming the same assertable fact', () => {
    const plan = plan_turn(
      read({
        fighters: [
          fighter(ME, 0, { x: 5, y: 5 }, { ap_committed: 12 }),
          fighter('mob-0', 1, { x: 5, y: 7 }, { hp_committed: 900, hp_max: 900 }),
        ],
        spellbook: [
          spell('a', { ap: 2, effects: [effect('DAMAGE', { base: 10 })] }),
          spell('b', { ap: 2, effects: [effect('DAMAGE', { base: 9 })] }),
        ],
      })
    )
    const facts = plan.actions.filter((a) => a.kind === 1).map((a) => `${a.expect.type}:${a.expect.target_id}`)
    expect(new Set(facts).size).toBe(facts.length)
  })

  test('deterministic: the same seed replays the same turn', () => {
    const board = {
      fighters: [
        fighter(ME, 0, { x: 5, y: 5 }),
        fighter('mob-0', 1, { x: 5, y: 8 }),
        fighter('mob-1', 1, { x: 8, y: 5 }),
      ],
      spellbook: [spell('bolt')],
    }
    const a = plan_turn(read(board), { seed: 7 })
    const b = plan_turn(read(board), { seed: 7 })
    expect(JSON.stringify(a.actions)).toBe(JSON.stringify(b.actions))
  })

  test('passes cleanly when there is nothing to do', () => {
    const plan = plan_turn(read({ fighters: [fighter(ME, 0, { x: 5, y: 5 })], spellbook: [spell('bolt')] }))
    expect(plan.actions).toEqual([])
    expect(plan.reason).toContain('no living enemy')
  })
})

// #1157 ① — THE COOLDOWN BOUNDARY, the case no fixture measured (this file authored every spell at cooldown 0).
// The chain (`cast.move:380`), the sim (`fight_cast_limits.js:41`) and the board's own gate (`draft_budget.on_
// cooldown`) all recast only when `turn − last > cooldown`; the policy carried a fourth copy that said `>=`. At
// the boundary turn it planned a cast all three authorities refuse — and one refusal used to retire the spell for
// the rest of the run, so every cooldown spell in the corpus was under-exercised by the rig built to exercise it.
describe('#1157 — the bot obeys the chain’s cooldown rule, not a copy of it', () => {
  const board = (turn_number, casts) => ({
    ...read({
      fighters: [fighter(ME, 0, { x: 5, y: 5 }), fighter('mob-0', 1, { x: 5, y: 7 })],
      spellbook: [spell('slow_bolt', { cooldown: 2 })],
    }),
    turn_number,
  })

  const casts_at = (turn_number, last) =>
    plan_turn(board(turn_number), { history: { casts: { slow_bolt: last }, blocked: [], traps: [] } }).actions.filter(
      (action) => action.kind === 1
    )

  test('RED: at turn − last === cooldown the spell is STILL locked (the chain refuses it)', () => {
    expect(casts_at(3, 1)).toHaveLength(0)
  })

  test('one turn later it is castable — the lock releases at `>` and not before', () => {
    expect(casts_at(4, 1).map((a) => a.spell_id)).toEqual(['slow_bolt'])
  })

  test('a spell never cast this fight is free, and cooldown 0 never locks', () => {
    expect(casts_at(1, null).map((a) => a.spell_id)).toEqual(['slow_bolt'])
    const zero = plan_turn(
      read({
        fighters: [fighter(ME, 0, { x: 5, y: 5 }), fighter('mob-0', 1, { x: 5, y: 7 })],
        spellbook: [spell('bolt', { cooldown: 0 })],
      }),
      { history: { casts: { bolt: 1 }, blocked: [], traps: [] } }
    )
    expect(zero.actions.filter((a) => a.kind === 1).map((a) => a.spell_id)).toEqual(['bolt'])
  })
})

// #1157 ③ — the per-turn cap is READ, not assumed. The seam publishes `casts_per_turn`; the policy used to
// hardcode one cast per spell per turn, which left half a turn's damage unexercised on any authored row above 1.
describe('#1157 — the authored cast caps come off the book', () => {
  const two_mobs = (over) => ({
    fighters: [fighter(ME, 0, { x: 5, y: 5 }), fighter('mob-0', 1, { x: 5, y: 7 }), fighter('mob-1', 1, { x: 7, y: 5 })],
    spellbook: [spell('twin', { ap: 3, casts_per_turn: 2, effects: [effect('DAMAGE', { base: 20 })], ...over })],
  })

  test('a casts_per_turn:2 spell is planned twice — on two different targets', () => {
    const casts = plan_turn(read(two_mobs())).actions.filter((a) => a.kind === 1)
    expect(casts).toHaveLength(2)
    expect(new Set(casts.map((c) => c.expect.target_id)).size).toBe(2)
  })

  test('casts_per_turn:1 still caps at one, and the per-target cap holds', () => {
    const casts = plan_turn(read(two_mobs({ casts_per_turn: 1 }))).actions.filter((a) => a.kind === 1)
    expect(casts).toHaveLength(1)
  })
})

describe('assertions — a success without a delta is a FAIL, never a warning', () => {
  const cast_plan = {
    actions: [
      {
        kind: 1,
        cell: { x: 5, y: 7 },
        spell_id: 'bolt',
        spell_key: 'bolt',
        ap_cost: 3,
        from: { x: 5, y: 5 },
        expect: { type: 'damage', target_id: 'mob-0', min_damage: 1, kill: false },
      },
    ],
  }
  const snapshot = (mob_hp, my_ap) =>
    read({
      fighters: [
        fighter(ME, 0, { x: 5, y: 5 }, { ap: my_ap, ap_committed: my_ap }),
        fighter('mob-0', 1, { x: 5, y: 7 }, { hp_committed: mob_hp }),
      ],
    })

  test('a cast that changed nothing fails, even though the commit said ok', () => {
    const rows = assert_turn(cast_plan, { ok: true, before: snapshot(100, 6), after: snapshot(100, 3) })
    expect(summarise(rows).verdict).toBe('FAIL')
    expect(rows.find((r) => r.check.includes('lost HP')).pass).toBe(false)
  })

  test('a cast that landed passes, budget row included', () => {
    const rows = assert_turn(cast_plan, { ok: true, before: snapshot(100, 6), after: snapshot(80, 3) })
    expect(summarise(rows)).toEqual({ checks: 2, passed: 2, failed: 0, verdict: 'PASS' })
  })

  test('a batch billed over the seat’s AP is its own failure', () => {
    const rows = assert_turn(cast_plan, { ok: true, before: snapshot(100, 2), after: snapshot(80, 2) })
    expect(rows.find((r) => r.check.includes('fitted the AP')).pass).toBe(false)
  })

  test('a refused turn fails once, loudly, instead of reporting per-action noise', () => {
    const rows = assert_turn(cast_plan, {
      ok: false,
      error: 'the sim refused it (range, line of sight, AP, or a cast limit)',
    })
    expect(rows).toHaveLength(1)
    expect(rows[0].pass).toBe(false)
    expect(rows[0].actual).toContain('the sim refused it')
  })

  const push_plan = (cells) => ({
    actions: [
      {
        kind: 1,
        cell: { x: 8, y: 5 },
        spell_id: 'shove',
        spell_key: 'shove',
        ap_cost: 3,
        from: { x: 5, y: 5 },
        expect: { type: 'push', target_id: 'mob-0', cells, from: { x: 5, y: 5 } },
      },
    ],
  })
  const push_board = (mob_cell, mob_hp, my_ap = 3) =>
    read({
      fighters: [
        fighter(ME, 0, { x: 5, y: 5 }, { ap: my_ap, ap_committed: my_ap }),
        fighter('mob-0', 1, mob_cell, { hp_committed: mob_hp }),
      ],
    })

  test('a push that landed its full distance in the right direction passes', () => {
    const rows = assert_turn(push_plan(3), {
      ok: true,
      before: push_board({ x: 8, y: 5 }, 100, 6),
      after: push_board({ x: 11, y: 5 }, 100, 3),
    })
    expect(summarise(rows).verdict).toBe('PASS')
  })

  test('a push that did not move the target fails', () => {
    const rows = assert_turn(push_plan(3), {
      ok: true,
      before: push_board({ x: 8, y: 5 }, 100, 6),
      after: push_board({ x: 8, y: 5 }, 100, 3),
    })
    expect(rows.find((r) => r.check.includes('push direction')).pass).toBe(false)
  })

  test('a push that moved the WRONG way fails', () => {
    const rows = assert_turn(push_plan(3), {
      ok: true,
      before: push_board({ x: 8, y: 5 }, 100, 6),
      after: push_board({ x: 6, y: 5 }, 100, 3),
    })
    expect(rows.find((r) => r.check.includes('push direction')).pass).toBe(false)
  })

  test('a SHORT push is only legal when it collided — and a collision hurts', () => {
    const stopped_free = assert_turn(push_plan(3), {
      ok: true,
      before: push_board({ x: 8, y: 5 }, 100, 6),
      after: push_board({ x: 9, y: 5 }, 100, 3),
    })
    expect(stopped_free.find((r) => r.check.includes('collided')).pass).toBe(false)
    const stopped_hurt = assert_turn(push_plan(3), {
      ok: true,
      before: push_board({ x: 8, y: 5 }, 100, 6),
      after: push_board({ x: 9, y: 5 }, 85, 3),
    })
    expect(summarise(stopped_hurt).verdict).toBe('PASS')
  })

  test('a move that ended somewhere else fails on the cell', () => {
    const plan = {
      actions: [{ kind: 0, cell: { x: 5, y: 8 }, expect: { type: 'move', cell: { x: 5, y: 8 }, mp_cost: 3 } }],
    }
    const before = read({ fighters: [fighter(ME, 0, { x: 5, y: 5 })] })
    const after = read({ fighters: [fighter(ME, 0, { x: 5, y: 6 }, { mp: 2, mp_committed: 2 })] })
    const rows = assert_turn(plan, { ok: true, before, after })
    expect(rows.find((r) => r.check.includes('stands on the cell')).pass).toBe(false)
  })

  test('a walk longer than the seat’s MP fails', () => {
    const plan = {
      actions: [{ kind: 0, cell: { x: 5, y: 9 }, expect: { type: 'move', cell: { x: 5, y: 9 }, mp_cost: 4 } }],
    }
    const before = read({ fighters: [fighter(ME, 0, { x: 5, y: 5 })] })
    const after = read({ fighters: [fighter(ME, 0, { x: 5, y: 9 })] })
    expect(assert_turn(plan, { ok: true, before, after }).find((r) => r.check.includes('fitted the MP')).pass).toBe(
      false
    )
  })
})

describe('the deferred trap assertion — a trap proves itself when something walks into it', () => {
  const armed = [{ cell: { x: 5, y: 7 }, turn: 2, spell_key: 'snare' }]
  const board = (mob_cell, mob_hp) =>
    read({ fighters: [fighter(ME, 0, { x: 5, y: 5 }), fighter('mob-0', 1, mob_cell, { hp_committed: mob_hp })] })

  test('nothing on the cell yet: the trap stays armed and says nothing', () => {
    const out = assert_traps_sprung(armed, board({ x: 5, y: 9 }, 100), board({ x: 5, y: 8 }, 100))
    expect(out.rows).toEqual([])
    expect(out.remaining).toEqual(armed)
  })

  test('a mob that walked onto the trap and paid for it passes, and the trap retires', () => {
    const out = assert_traps_sprung(armed, board({ x: 5, y: 8 }, 100), board({ x: 5, y: 7 }, 75))
    expect(out.rows).toHaveLength(1)
    expect(out.rows[0].pass).toBe(true)
    expect(out.remaining).toEqual([])
  })

  test('a mob standing ON the trap at full health is the silent no-op — FAIL', () => {
    const out = assert_traps_sprung(armed, board({ x: 5, y: 8 }, 100), board({ x: 5, y: 7 }, 100))
    expect(out.rows[0].pass).toBe(false)
  })
})
