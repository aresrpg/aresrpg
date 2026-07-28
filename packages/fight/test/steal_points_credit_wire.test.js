// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #1477 — the STEAL's caster credit has to reach the CLIENT, not just sim state.
//
// The chain moves a stolen point into the caster's pool SILENTLY (cast.move:1200/1328 `give_caster_points` →
// `participant::give_points`; no event, exactly like the GIVE_POINTS twin), so the receipt is the only channel a
// fold-based client has. This pins the whole hop the owner's repro broke: the sim's own cast receipt states the
// caster's pool row → `sim_chain` mints the fold's `Granted` → `inputs.apply_action` credits the caster's pool,
// which is the number the HUD paints and the move wash spends. Without the receipt row the encoder had nothing
// to state and the stolen MP evaporated the instant prediction rebased onto canonical truth (the #952 class).
import { describe, test, expect } from 'bun:test'
import { reduce } from '@aresrpg/sim/reduce'

import { apply_action } from '../src/inputs.js'
import { arena_from_board, create_sim_chain, derive_board, encode_sim_step } from '../src/sim_chain.js'

const SEED = 0xc81f3a92
const FIGHT_ID = 'sim:steal:1'
const STEAL_SPELL = 'steal_mp_probe'

/** The authored steal, in the CHAIN's dialect exactly as the seed corpus mints it (kind 8 = K_STEAL_POINTS,
 *  stat 1 = POINT_MP, target_filter 1 = NOT_TEAM, no FLAG_DODGE ⇒ a guaranteed removal). */
const STEAL_ROWS = [
  {
    id: STEAL_SPELL,
    name: STEAL_SPELL,
    levels: [
      {
        ap_cost: 3,
        range_min: 1,
        range_max: 20,
        crit_rate: 0,
        line_of_sight: false,
        effects: [
          {
            kind: 8,
            element: 0,
            value: 1,
            area_shape: 0,
            area_size: 0,
            target_filter: 1,
            chance: 100,
            turns: 1,
            stat: 1,
            flags: 0,
            phase: 0,
          },
        ],
        crit_effects: [],
      },
    ],
  },
]

const fighter = (id, cell, is_player) => ({
  id,
  name: id,
  cell,
  health: 60,
  health_max: 60,
  ap: 6,
  ap_max: 6,
  mp: 3,
  mp_max: 3,
  ap_used: 0,
  mp_used: 0,
  is_player,
  template_id: is_player ? 'senshi' : '0xmob_template',
  level: 10,
  stats: {},
  effects: [],
  spell_levels: { [STEAL_SPELL]: 1 },
  ap_reserve: 0,
})

const chain = (() => {
  const arena = arena_from_board(derive_board(SEED).board)
  return create_sim_chain({
    seed: SEED,
    fight_id: FIGHT_ID,
    team0: [fighter('sim_c1', arena.spawns_a[0], true)],
    team1: [fighter('mob_0', arena.spawns_a[2], false)],
    templates_raw: STEAL_ROWS,
    group_template: '0xgroup',
  })
})()

const parsed_of = (rows, name) => rows.filter((row) => row.type.endsWith(`::${name}`)).map((row) => row.parsedJson)

describe('#1477 — a steal states its caster credit on the wire', () => {
  const pre_state = chain.sim_state
  const [me] = pre_state.team0
  const [mob] = pre_state.team1
  const cast = reduce(pre_state, { type: 'cast', entity_id: me.id, spell_id: STEAL_SPELL, target: mob.cell }, chain.ctx)
  const { rows } = encode_sim_step({
    pre_state,
    post_state: cast.state,
    events: cast.events,
    fight_id: FIGHT_ID,
    spell_templates: chain.ctx.spell_templates,
  })

  test('the encoder mints a Granted on the CASTER and a Drain on the target', () => {
    expect(parsed_of(rows, 'Drain')).toContainEqual(
      expect.objectContaining({ target_is_mob: true, target_idx: '0', point_kind: 1, removed: '1' })
    )
    expect(parsed_of(rows, 'Granted')).toContainEqual(
      expect.objectContaining({ target_is_mob: false, target_idx: '0', point_kind: 1, granted: '1' })
    )
  })

  test('the fold credits the caster pool — the number the HUD paints and the move wash spends', () => {
    const seeded = { fighters: { p0: { key: 'p0', is_mob: false, ap: 6, mp: 3, alive: true } } }
    const [granted] = parsed_of(rows, 'Granted')
    const after = apply_action(seeded, {
      kind: 'Granted',
      target_is_mob: granted.target_is_mob,
      target_idx: granted.target_idx,
      point_kind: granted.point_kind,
      granted: granted.granted,
    })
    expect(after.fighters.p0.mp).toBe(4) // base 3 + the stolen point — the base+1 walk is funded
  })
})
