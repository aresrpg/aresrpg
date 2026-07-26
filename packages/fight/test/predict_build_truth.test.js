// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #1077 — THE PREDICT-PATH BUILD TRUTH. The optimistic prediction every fight surface paints (damage floaters,
// range highlights, AP costs) and the authority that resolves the cast are THE SAME MATH — so fed the same
// inputs they must land the same number. They were not fed the same inputs: the wire carried `stats:{agility}`
// and the escrow row carried no `spell_levels` at all, so the prediction ran a level-1 spell with an empty
// stat block while the chain resolved level 6 with the seat's full build.
//
// This drives BOTH halves through the real modules on ONE fixture — a seat at spell level 6 with a composed
// stat snapshot (+intelligence, +raw damage) against a fire-resistant mob:
//   RESOLUTION: create_sim_chain → submit_commands (the sim reducer IS the authority here)
//   PREDICTION: snapshot_from_sim → board_state_from_fight → the store → engine_view → predict_cast
// and asserts the predicted post-cast hp equals the resolved one. Nothing is hand-computed: a hardcoded
// expectation would just be a third implementation of the damage formula.

import { describe, test, expect } from 'bun:test'
import { normalize_spell_templates } from '@aresrpg/sim/spell_templates'

import { board_state_from_fight } from '../src/board_state.js'
import { engine_view } from '../src/project.js'
import { predict_cast } from '../src/predict_cast.js'
import { create_fight_store } from '../src/store.js'
import { encode } from '../src/los.js'
import { LOCAL_ADDRESS, arena_from_board, create_sim_chain, derive_board, snapshot_from_sim, submit_commands } from '../src/sim_chain.js'

const SEED = 0xc81f3a92
const FIGHT_ID = 'sim:1077:1'
const WORLD = '0xworld'
const ME = 'seat_a'
const NOW = 1_784_752_468_344

// The spell an on-chain SpellTemplate is named by — an OBJECT id, the key space both the chain's
// `Participant.spell_levels` VecMap and the simulator's spellbook use.
const SPELL_ID = '0xcinder_shaft'
const SEAT_SPELL_LEVEL = 6

const K_DAMAGE = 0
const EL_FIRE = 0
const TF_NOT_TEAM = 1

/** Six authored levels whose damage, AP cost and range ALL move with the level — so a level-1 read is
 *  distinguishable from a level-6 read on every one of the three surfaces the issue names. */
const LEVEL_ROWS = [
  { value: 10, ap_cost: 2, range_max: 3 },
  { value: 14, ap_cost: 2, range_max: 8 },
  { value: 18, ap_cost: 3, range_max: 13 },
  { value: 22, ap_cost: 3, range_max: 18 },
  { value: 26, ap_cost: 4, range_max: 23 },
  { value: 30, ap_cost: 4, range_max: 28 },
]

const SPELL_RAW = {
  id: SPELL_ID,
  name: 'Cinder Shaft',
  levels: LEVEL_ROWS.map(({ value, ap_cost, range_max }) => ({
    ap_cost,
    range_min: 1,
    range_max,
    modifiable_range: false,
    line_launch: false,
    line_of_sight: false,
    free_cell: false,
    casts_per_turn: 255,
    casts_per_target: 255,
    cooldown_turns: 0,
    crit_rate: 0,
    effects: [{ kind: K_DAMAGE, element: EL_FIRE, value, target_filter: TF_NOT_TEAM, chance: 100 }],
    crit_effects: [],
  })),
}

const SPELL_TEMPLATE = normalize_spell_templates([SPELL_RAW]).get(SPELL_ID)

// THE COMPOSED BUILD: the locked stat snapshot the resolution consumes. `intelligence` amplifies a FIRE line
// and `raw_damage` is the flat add (spell_calculator) — both invisible to an `{agility}`-only wire row.
const SEAT_STATS = {
  strength: 0,
  intelligence: 100,
  chance: 0,
  agility: 40,
  raw_damage: 5,
  critical_hit: 0,
  range: 0,
  fire_resistance: 0,
  water_resistance: 0,
  earth_resistance: 0,
  air_resistance: 0,
}

// The TARGET's own block matters too: a resistance the prediction cannot see inflates every floater.
const MOB_STATS = { ...SEAT_STATS, intelligence: 0, raw_damage: 0, agility: 10, fire_resistance: 20 }

const entity = (id, cell, is_player, extra) => ({
  id,
  name: id,
  cell,
  health: 400,
  health_max: 400,
  ap: 8,
  ap_max: 8,
  mp: 4,
  mp_max: 4,
  ap_used: 0,
  mp_used: 0,
  is_player,
  template_id: is_player ? 'senshi' : '0xmob_template',
  level: 20,
  effects: [],
  ap_reserve: 0,
  ...extra,
})

/** The local chain, booted with the seat's REAL build: its stat snapshot and its learned spell level. */
const boot_chain = () => {
  const { board } = derive_board(SEED)
  const arena = arena_from_board(board)
  const team0 = [
    entity(ME, arena.spawns_a[0], true, { stats: SEAT_STATS, spell_levels: { [SPELL_ID]: SEAT_SPELL_LEVEL } }),
  ]
  const team1 = [entity('mob_0', arena.spawns_b[0], false, { stats: MOB_STATS, spell_levels: {} })]
  return create_sim_chain({
    seed: SEED,
    fight_id: FIGHT_ID,
    team0,
    team1,
    templates_raw: [SPELL_RAW],
    group_template: '0xgroup',
  })
}

/** The board view + the HUD's engine_view, adopted through the production snapshot door. */
const adopt = (chain) => {
  const snapshot = snapshot_from_sim(chain, { now_ms: NOW })
  const store = create_fight_store()
  store.getState().input(
    {
      type: 'init',
      fight_id: FIGHT_ID,
      ctx: { world_id: WORLD, my_entity_id: ME, address: LOCAL_ADDRESS, beat_ctx: { grid_width: 20 } },
    },
    NOW
  )
  store.getState().input({ type: 'snapshot', fight: snapshot, version: 1 }, NOW + 100)
  return { board: board_state_from_fight({ fight: snapshot, version: 1 }), view: engine_view(store.getState()) }
}

/** The escrow-seat ↔ fighter-id mapping the HUD surfaces pass predict_cast (a mob rides 'mob-N'). */
const ref_of = (board) => (id) => {
  const mob = /^mob-(\d+)$/.exec(String(id))
  if (mob) return { is_mob: true, idx: Number(mob[1]) }
  const idx = board.escrow.findIndex((row) => String(row.character) === String(id))
  return idx < 0 ? null : { is_mob: false, idx }
}

describe('#1077 — the predict path runs on the seat\'s composed build, not level 1 with empty stats', () => {
  const chain = boot_chain()
  const { board, view } = adopt(chain)
  const mob_cell = chain.sim_state.team1[0].cell
  const target_cell = encode(mob_cell.x, mob_cell.y)

  test('the wire carries the build: the escrow row holds the seat\'s spell_levels + full stat snapshot', () => {
    expect(board.escrow[0].spell_levels?.[SPELL_ID]).toBe(SEAT_SPELL_LEVEL)
    expect(board.escrow[0].base_stats).toMatchObject({ intelligence: 100, raw_damage: 5 })
    // the TARGET's block rides the same wire — its resistance is an input to my own damage number
    expect(board.mobs[0].base_stats).toMatchObject({ fire_resistance: 20 })
    // and the projection hands it to the predict path (predict_cast reads the view, not a per-surface adapter)
    expect(view.fighters.get(ME).spell_levels?.[SPELL_ID]).toBe(SEAT_SPELL_LEVEL)
    expect(view.fighters.get(ME).base_stats).toMatchObject({ intelligence: 100, raw_damage: 5 })
    expect(view.fighters.get('mob-0').base_stats).toMatchObject({ fire_resistance: 20 })
  })

  test('RED (a): the predicted damage equals what the authority resolves for the SAME cast', () => {
    // the seat's level, read off the build the wire now carries — never a hardcoded 1
    const spell_level = Number(view.fighters.get(ME).spell_levels?.[SPELL_ID] ?? 1)
    const prediction = predict_cast({
      view,
      caster_id: ME,
      spell: SPELL_TEMPLATE,
      spell_level,
      target_cell,
      critical: false,
      resolve_ref: ref_of(board),
    })
    const predicted_hp = prediction.actions.find((a) => a.kind === 'Hit' && a.victim_is_mob)?.remaining_hp

    const resolved = submit_commands(
      chain,
      [{ type: 'cast', entity_id: ME, spell_id: SPELL_ID, target: mob_cell }],
      { now_ms: NOW }
    )
    const resolved_hp = resolved.chain.sim_state.team1[0].health

    // the fixture must actually exercise the build: a level-1 cast with no stats would take 10 - resist off
    expect(400 - resolved_hp).toBeGreaterThan(LEVEL_ROWS[0].value)
    expect(predicted_hp).toBe(resolved_hp)
  })

  test('the level row the seat casts at carries its own AP cost and range — level 6, not level 1', () => {
    const level = Number(view.fighters.get(ME).spell_levels?.[SPELL_ID] ?? 1)
    expect(SPELL_TEMPLATE.levels[level - 1].cost).toBe(LEVEL_ROWS[SEAT_SPELL_LEVEL - 1].ap_cost)
    expect(SPELL_TEMPLATE.levels[level - 1].range[1]).toBe(LEVEL_ROWS[SEAT_SPELL_LEVEL - 1].range_max)
  })
})
