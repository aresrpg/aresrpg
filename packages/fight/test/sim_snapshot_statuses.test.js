// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// sim_snapshot_statuses.test.js — THE SNAPSHOT STATUS GATE (#952).
//
// `snapshot_from_sim` IS the simulator's object read: it is the ONLY durable channel behind the receipt. The
// store's omission-hold law (fold.js `carry_statuses`) is explicit — a view whose `invisibility_statuses` is
// ANY array, INCLUDING [], is AUTHORITATIVE ("an absent fighter there is genuinely not-invisible"); only
// `undefined` means "this payload does not model the class, HOLD the prior fact".
//
// The mock used to hardcode `[]`. That is the strongest possible lie: every snapshot refresh told the store
// "nobody has any status", wiping the invisibility the receipt had just floored AND every buff/debuff badge
// with it — the wholesale rollback #952 reports. The sim DOES model statuses (`entity.effects`), so the
// snapshot must state them.

import { describe, expect, test } from 'bun:test'

import * as SE from '../../sim/src/spell_effect.js'
import { board_state_from_fight } from '../src/board_state.js'
import { base_from_view } from '../src/fold.js'
import { encode } from '../src/los.js'
import {
  commands_from_staged,
  create_sim_chain,
  current_actor,
  snapshot_from_sim,
  submit_commands,
} from '../src/sim_chain.js'

const SEED = 0xc81f3a92
const NOW = 1_784_752_468_344

const level = (effects, { ap_cost = 2, range_max = 14 } = {}) => ({
  ap_cost,
  range_min: 0,
  range_max,
  modifiable_range: false,
  line_launch: false,
  line_of_sight: false,
  free_cell: false,
  casts_per_turn: 255,
  casts_per_target: 255,
  cooldown_turns: 0,
  crit_rate: 0,
  effects: effects.map((e) => ({ chance: 100, ...e })),
  crit_effects: [],
})

const KIT = [
  {
    id: 'u_invis',
    levels: [
      level([{ kind: SE.K_INVISIBILITY, value: 1, turns: 3, target: 'self', target_filter: SE.TF_ONLY_CASTER }]),
    ],
  },
  {
    id: 'u_str_buff',
    levels: [
      level([
        { kind: SE.K_ALTER_STAT, stat: 0, value: 40, turns: 3, target: 'self', target_filter: SE.TF_ONLY_CASTER },
      ]),
    ],
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
  spell_levels: Object.fromEntries(deck.map((s) => [s, 1])),
  ap_reserve: 0,
})

const build = () =>
  create_sim_chain({
    seed: SEED,
    fight_id: 'snapstatus:1',
    group_template: '0xgroup',
    templates_raw: [...KIT, ...MOB_KIT],
    team0: [fighter('p0', { x: 0, y: 0 }, true, { health: 200, ap: 12, mp: 6, deck: KIT.map((s) => s.id) })],
    team1: [fighter('mob_0', { x: 4, y: 0 }, false, { health: 200, ap: 6, mp: 3, deck: ['m_hit'], level: 12 })],
  })

const cast_self = (spell_id) => {
  const chain = build()
  expect(current_actor(chain)).toBe('p0')
  return submit_commands(
    chain,
    commands_from_staged([{ kind: 1, target: encode(0, 0), spell_template_id: spell_id }], 'p0'),
    { now_ms: NOW }
  ).chain
}

describe('snapshot_from_sim · the read states the statuses the sim holds (#952)', () => {
  test('a fresh fight really does report an empty status set', () => {
    // The control: [] is only a lie when the sim HOLDS rows. Nobody has cast anything here.
    expect(snapshot_from_sim(build()).invisibility_statuses).toEqual([])
  })

  test('INVISIBILITY survives the snapshot — the read carries the kind-27 row', () => {
    const chain = cast_self('u_invis')
    // Ground truth: the sim folded the row.
    const caster = chain.sim_state.team0.find((e) => e.id === 'p0')
    expect(caster.effects.some((e) => e.type === 'INVISIBILITY')).toBe(true)

    const rows = snapshot_from_sim(chain).invisibility_statuses
    expect(rows.length).toBeGreaterThan(0)
    const invis = rows.find((r) => Number(r.kind) === SE.K_INVISIBILITY)
    expect(invis).toBeDefined()
    expect(Number(invis.fighter)).toBe(0) // participant seat 0
    expect(Number(invis.remaining_turns)).toBeGreaterThan(0)
  })

  test('the whole production read path still shows p0 invisible after a snapshot', () => {
    const chain = cast_self('u_invis')
    const snapshot = snapshot_from_sim(chain)
    const view = board_state_from_fight({ fight: snapshot, version: 1 })
    const base = base_from_view(view, snapshot.id)
    expect(base.fighters.p0.invisible).toBe(true)
  })

  test('a timed STAT buff badge survives the snapshot too', () => {
    const chain = cast_self('u_str_buff')
    const rows = snapshot_from_sim(chain).invisibility_statuses
    expect(rows.some((r) => Number(r.kind) === SE.K_ALTER_STAT)).toBe(true)
  })
})
