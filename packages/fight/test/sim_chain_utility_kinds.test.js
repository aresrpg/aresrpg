// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// sim_chain_utility_kinds.test.js — THE PER-KIND FOLD GATE (#952).
//
// The simulator's mock chain is the ONLY channel the client has: there is no object read behind it, so a fact
// the sim folded but the receipt omits is a fact the client MUST roll back. Damage kinds were proven by the
// arming capture; this pins the UTILITY kinds that regressed:
//
//   · an AP/MP POOL buff  → a `Granted` row  (chain: cast.move:1098-1101 `k_give_points` → participant::give_points)
//   · an AP/MP POOL drain → a `Drain` row    (chain: cast.move:1796 `emit_drain`)
//   · INVISIBILITY        → a `StanceChanged` row (chain: retro_effects.move:168 `emit_stance_changed`)
//
// The chain mutates a pool SILENTLY and lets the object read carry the durable number (inputs.js `Granted`
// comment). The simulator has no such read — `snapshot_from_sim` IS the read — so the receipt must state it.

import { describe, expect, test } from 'bun:test'

import * as SE from '../../sim/src/spell_effect.js'
import { encode } from '../src/los.js'
import {
  arena_from_board,
  commands_from_staged,
  create_sim_chain,
  current_actor,
  derive_board,
  submit_commands,
} from '../src/sim_chain.js'

const SEED = 0xc81f3a92
const NOW = 1_784_752_468_344

const level = (effects, { ap_cost = 2, range_max = 14, free_cell = false } = {}) => ({
  ap_cost,
  range_min: 0,
  range_max,
  modifiable_range: false,
  line_launch: false,
  line_of_sight: false,
  free_cell,
  casts_per_turn: 255,
  casts_per_target: 255,
  cooldown_turns: 0,
  crit_rate: 0,
  effects: effects.map((e) => ({ chance: 100, ...e })),
  crit_effects: [],
})

/** One spell per utility KIND under probe, plus the damage control the arming capture already proved. */
const KIT = [
  {
    id: 'u_damage',
    levels: [level([{ kind: SE.K_DAMAGE, element: 0, value: 20, target_filter: SE.TF_NOT_TEAM }])],
  },
  {
    id: 'u_invis',
    levels: [
      level([{ kind: SE.K_INVISIBILITY, value: 1, turns: 3, target: 'self', target_filter: SE.TF_ONLY_CASTER }]),
    ],
  },
  {
    id: 'u_mp_buff',
    levels: [
      level([
        { kind: SE.K_GIVE_POINTS, stat: 1, value: 3, turns: 3, target: 'self', target_filter: SE.TF_ONLY_CASTER },
      ]),
    ],
  },
  {
    id: 'u_mp_drain',
    levels: [level([{ kind: SE.K_REMOVE_POINTS, stat: 1, value: 2, turns: 1, target_filter: SE.TF_NOT_TEAM }])],
  },
]

const MOB_KIT = [
  {
    id: 'm_hit',
    levels: [level([{ kind: SE.K_DAMAGE, element: 0, value: 5, target_filter: SE.TF_NOT_TEAM }], { range_max: 1 })],
  },
]

const fighter = (id, cell, is_player, { health, ap, mp, deck = [], level: lvl = 20 }) => ({
  id,
  name: id,
  cell,
  health,
  health_max: health,
  ap,
  ap_max: ap,
  mp,
  mp_max: mp,
  ap_used: 0,
  mp_used: 0,
  is_player,
  template_id: is_player ? 'senshi' : '0xmob_template',
  level: lvl,
  stats: {},
  effects: [],
  deck: [...deck],
  hand: is_player ? [] : [...deck],
  discard: [],
  spell_levels: Object.fromEntries(deck.map((s) => [s, 1])),
  ap_reserve: 0,
})

const build = () =>
  create_sim_chain({
    seed: SEED,
    fight_id: 'utility:1',
    group_template: '0xgroup',
    templates_raw: [...KIT, ...MOB_KIT],
    team0: [fighter('p0', { x: 0, y: 0 }, true, { health: 200, ap: 12, mp: 6, deck: KIT.map((s) => s.id) })],
    team1: [fighter('mob_0', { x: 4, y: 0 }, false, { health: 200, ap: 6, mp: 3, deck: ['m_hit'], level: 12 })],
  })

/** Cast ONE spell from p0's opening turn and hand back the receipt row names + the chain after it. */
const cast_once = (spell_id, target) => {
  const chain = build()
  expect(current_actor(chain)).toBe('p0')
  const out = submit_commands(
    chain,
    commands_from_staged([{ kind: 1, target: encode(target.x, target.y), spell_template_id: spell_id }], 'p0'),
    { now_ms: NOW }
  )
  return { out, names: out.receipt.events.map((r) => r.type.split('::').pop()) }
}

const SELF = { x: 0, y: 0 }
const MOB = { x: 4, y: 0 }

describe('sim_chain · the utility effect kinds fold into the receipt (#952)', () => {
  test('the damage control still folds a Hit (the arming capture, re-pinned)', () => {
    const { names } = cast_once('u_damage', MOB)
    expect(names).toContain('Cast')
    expect(names).toContain('Hit')
  })

  test('an MP POOL BUFF folds a Granted row — the chain grants the pool (cast.move:1098-1101)', () => {
    const { out, names } = cast_once('u_mp_buff', SELF)
    // The sim really did fold the buff — a timed row landed on the caster.
    const caster = out.chain.sim_state.team0.find((e) => e.id === 'p0')
    expect(caster.effects.some((e) => e.type === 'STAT_BUFF')).toBe(true)
    // …so the receipt MUST say so, or the client's prediction is retired and the player loses the MP.
    expect(names).toContain('Granted')
    const granted = out.receipt.events.find((r) => r.type.endsWith('::Granted'))
    expect(granted.parsedJson.target_is_mob).toBe(false)
    expect(granted.parsedJson.target_idx).toBe('0')
    expect(granted.parsedJson.point_kind).toBe(1) // 0 = AP, else MP
    expect(granted.parsedJson.granted).toBe('3')
  })

  test('an MP POOL DRAIN folds a Drain row — the chain emits one (cast.move:1796)', () => {
    const { out, names } = cast_once('u_mp_drain', MOB)
    expect(names).toContain('Drain')
    const drain = out.receipt.events.find((r) => r.type.endsWith('::Drain'))
    expect(drain.parsedJson.target_is_mob).toBe(true)
    expect(drain.parsedJson.point_kind).toBe(1)
    expect(Number(drain.parsedJson.removed)).toBeGreaterThan(0)
  })

  test('INVISIBILITY folds a StanceChanged row (retro_effects.move:168)', () => {
    const { out, names } = cast_once('u_invis', SELF)
    expect(names).toContain('StanceChanged')
    const stance = out.receipt.events.find((r) => r.type.endsWith('::StanceChanged'))
    expect(stance.parsedJson.stance).toBe('27')
    expect(stance.parsedJson.active).toBe(true)
  })
})
