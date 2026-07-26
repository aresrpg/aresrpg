// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// sim_chain_silent_cast.test.js — #1012's RED: the local chain must never eat a committed cast in silence.
//
// THE MEASURED SYMPTOM. On /simulator a level-200 seat commits a staged `{ kind:1, target, spell_template_id }`
// turn, the commit "succeeds" (a version lands), and the receipt carries ONLY TurnEnded/TurnStarted: no Cast,
// no Hit, no AP spent, no refusal, nothing on the console. The player pressed a card and the game did nothing.
//
// THE MECHANISM this file pins. The staged id space was never the miss; the miss was HAND MEMBERSHIP — the
// reducer honoured only a cast whose spell sat in a dealt 7-card hand while the spell bar offered every spell
// the character unlocked, 20 of them at level 200. That deal is GONE: the chain has no hand, so the sim has
// none either, and every unlocked spell folds. What survives is the loudness law.
//
// THE LAW THIS GATE CARRIES (docs/CODE_LAW.md, no silent failures): whatever the reason a staged cast cannot
// fold — an id the ctx cannot resolve, a range it cannot reach, a purse it cannot pay, a published cast limit
// it has spent — the local chain REFUSES LOUDLY and names it, exactly as `commands_from_staged` already throws
// for the kind-2 weapon strike. A refusal rolls the drafted turn back through the production failure path; a
// silent no-op steals the turn.

import { describe, test, expect } from 'bun:test'

import * as SE from '../../sim/src/spell_effect.js'
import { encode } from '../src/los.js'
import {
  arena_from_board,
  create_sim_chain,
  current_actor,
  derive_board,
  pending_mob_turn,
  run_ai_turn,
  submit_staged,
} from '../src/sim_chain.js'

const SEED = 0xc81f3a92
const FIGHT_ID = 'sim:c81f3a92:1'
const NOW = 1_784_752_468_344
/** The retired opening-deal size. The kit is deliberately bigger than it — that spread WAS the bug. */
const RETIRED_HAND_SIZE = 7

const level = (effects, { ap_cost = 1, range_max = 14, casts_per_turn = 255 } = {}) => ({
  ap_cost,
  range_min: 0,
  range_max,
  modifiable_range: false,
  line_launch: false,
  line_of_sight: false,
  free_cell: false,
  casts_per_turn,
  casts_per_target: 255,
  cooldown_turns: 0,
  crit_rate: 0,
  effects: effects.map((e) => ({ chance: 100, ...e })),
  crit_effects: [],
})

const damage = (id, value, level_overrides = {}) => ({
  id,
  levels: [level([{ kind: SE.K_DAMAGE, element: 0, value, target_filter: SE.TF_NOT_TEAM }], level_overrides)],
})

/** A level-200-shaped spell book: MORE spells than the retired opening hand could hold. */
const PLAYER_KIT = Array.from({ length: RETIRED_HAND_SIZE + 2 }, (_unused, i) => damage(`0xspell_${i}`, 12))
/** The once-per-turn spell — its OWN published cap is the only thing that can refuse its second cast. */
const ONCE = damage('0xspell_once', 12, { casts_per_turn: 1 })
const MOB_KIT = [damage('0xmob_hit', 5)]
const TEMPLATES_RAW = [...PLAYER_KIT, ONCE, ...MOB_KIT]
const PLAYER_BOOK = [...PLAYER_KIT.map((s) => s.id), ONCE.id]

const fighter = (id, cell, is_player, { health, ap, spells }) => ({
  id,
  name: id,
  cell,
  health,
  health_max: health,
  ap,
  ap_max: ap,
  mp: 4,
  mp_max: 4,
  ap_used: 0,
  mp_used: 0,
  is_player,
  template_id: is_player ? 'yajin' : '0xmob_template',
  level: is_player ? 200 : 80,
  stats: {},
  effects: [],
  spell_levels: Object.fromEntries(spells.map((s) => [s, 1])),
  ap_reserve: 0,
})

/** The player on a team-A start cell with a walkable neighbour holding the mob — melee range, no LOS argument. */
const build_chain = () => {
  const { board } = derive_board(SEED)
  const arena = arena_from_board(board)
  const [me] = arena.spawns_a
  const walkable = ({ x, y }) =>
    x >= 0 && y >= 0 && x < arena.width && y < arena.height && arena.cells[y * arena.width + x] === 0
  const mob_cell = [
    { x: me.x + 1, y: me.y },
    { x: me.x, y: me.y + 1 },
    { x: me.x - 1, y: me.y },
    { x: me.x, y: me.y - 1 },
  ].find(walkable)
  expect(mob_cell).toBeDefined()
  return create_sim_chain({
    seed: SEED,
    fight_id: FIGHT_ID,
    team0: [fighter('sim_c1', me, true, { health: 1440, ap: 6, spells: PLAYER_BOOK })],
    team1: [fighter('mob_0', mob_cell, false, { health: 1050, ap: 4, spells: MOB_KIT.map((s) => s.id) })],
    templates_raw: TEMPLATES_RAW,
  })
}

/** Fold mob turns until the roster seat holds the turn — the state a committed player turn starts from. */
const on_my_turn = (chain) => {
  let live = chain
  for (let i = 0; i < 8 && pending_mob_turn(live) != null; i++)
    live = run_ai_turn(live, pending_mob_turn(live), { now_ms: NOW }).chain
  expect(current_actor(live)).toBe('sim_c1')
  return live
}

/** The exact staging the board performs for one card (DungeonBoard flush_commit / dev_cast), through the exact
 *  door `fight_shim.commit_turn` routes a committed turn into. */
const commit_cast = (chain, spell_template_id) => {
  const target = chain.sim_state.team1[0].cell
  return submit_staged(chain, [{ kind: 1, target: encode(target.x, target.y), spell_template_id }], 'sim_c1', {
    now_ms: NOW,
  })
}

const seat = (chain) => chain.sim_state.team0.find((e) => e.id === 'sim_c1')
const row_kinds = (result) => result.receipt.events.map((row) => String(row.type).split('::').pop())

describe('the local chain never eats a committed cast (#1012)', () => {
  test('the fixture reproduces a real seat: more spells than the retired hand could hold', () => {
    const chain = build_chain()

    expect(PLAYER_BOOK.length).toBeGreaterThan(RETIRED_HAND_SIZE)
    expect(Object.keys(seat(chain).spell_levels)).toEqual(PLAYER_BOOK)
  })

  test('a cast folds the full envelope and spends the AP (the positive control)', () => {
    const chain = on_my_turn(build_chain())
    const [dealt] = PLAYER_BOOK
    const ap_before = seat(chain).ap
    const hp_before = chain.sim_state.team1[0].health

    const result = commit_cast(chain, dealt)
    const after = result.chain

    expect(row_kinds(result)).toContain('Cast')
    expect(row_kinds(result)).toContain('Hit')
    expect(after.sim_state.team1[0].health).toBeLessThan(hp_before)
    // AP is spent on the caster's own turn; the pool refills only when the turn comes back around.
    expect(seat({ sim_state: result.chain.sim_state }).ap).toBeLessThan(ap_before)
  })

  test('EVERY spell in the book folds — the ninth is as castable as the first (#1012)', () => {
    const last = PLAYER_BOOK[RETIRED_HAND_SIZE + 1] // past the retired hand size by construction
    const chain = on_my_turn(build_chain())

    expect(chain.ctx.spell_templates.has(last)).toBe(true)
    expect(row_kinds(commit_cast(chain, last))).toContain('Cast')
  })

  test('the SECOND cast of a once-per-turn spell refuses LOUDLY — the turn is all or nothing', () => {
    const chain = on_my_turn(build_chain())
    const target = chain.sim_state.team1[0].cell
    const staged = Array.from({ length: 2 }, () => ({
      kind: 1,
      target: encode(target.x, target.y),
      spell_template_id: ONCE.id,
    }))

    // `casts_per_turn: 1` is the ONLY thing refusing the repeat — no card left a hand. Loud, and the WHOLE
    // turn is refused: the caller keeps the pre-turn chain, so the first cast never half-commits.
    expect(() => submit_staged(chain, staged, 'sim_c1', { now_ms: NOW })).toThrow(/already cast that spell/)
  })

  test('a staged cast the sim refuses on its own rules REFUSES LOUDLY — never an empty committed turn', () => {
    const chain = on_my_turn(build_chain())
    // Aim at empty ground far from the seat: nothing to hit and, at that distance, nothing in range either.
    expect(() =>
      submit_staged(chain, [{ kind: 1, target: encode(19, 19), spell_template_id: PLAYER_BOOK[0] }], 'sim_c1', {
        now_ms: NOW,
      })
    ).toThrow(/folded nothing — the sim refused it \(range, line of sight, AP, or a cast limit\)/)
  })

  test('a staged cast naming a template the ctx cannot resolve REFUSES LOUDLY', () => {
    const chain = on_my_turn(build_chain())

    expect(chain.ctx.spell_templates.has('0xnot_a_template')).toBe(false)
    expect(() => commit_cast(chain, '0xnot_a_template')).toThrow(/sim_chain: cast .* folded nothing/)
  })
})
