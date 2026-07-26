// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// sim_chain_death_truth.test.js — RED-FIRST for #1169: in the SIMULATOR a mob DIED without dying.
//
// THE BUG, mechanically. `encode_effect` routed on `effect.damage != null` and read the resulting hp as
// `effect.new_health ?? 0`. Most sim effect rows state both — but a RIDER does not: the erosion rider
// (`fight_actions.js` `{ target_id, status: 'EROSION', damage: erosion }`) carries a max-HP magnitude and NO
// hp at all, because erosion is not an hp hit (the chain records it inside the cast's action envelope and
// emits no event — `retro_effects.move` `erode` mutates max hp silently; EROSION is in this encoder's own
// INERT_STATUSES for exactly that reason). The damage branch won first, so the rider encoded as
// `Hit{ amount: erosion, remaining_hp: 0 }` — an INVENTED zero — and the fold killed a fighter the sim had
// alive at full health.
//
// Both reported symptoms fall out of that one row:
//   ① THE REVIVE — the client kills the mob, the next receipt states its real hp, the corpse stands back up.
//   ② THE WEDGE — the sim never agrees the mob died, so `check_victory` never fires and the fight runs forever
//      ("it should stop the sim"). Repeat the kill and it repeats, terminal-free.
//
// THE LAW THIS PINS: an hp row is a row that STATES the resulting hp. A magnitude without a resulting hp is
// not an hp fact and no `Hit` may be invented from it — the encoder's own header ("every hp it writes is the
// sim's own post-state hp, never re-derived") applied to the one branch that broke it.

import { describe, expect, test } from 'bun:test'

import * as SE from '../../sim/src/spell_effect.js'
import { board_state_from_fight } from '../src/board_state.js'
import { base_budget, base_from_view } from '../src/fold.js'
import { apply_action, normalize_events, seat_resolver } from '../src/inputs.js'
import { encode } from '../src/los.js'
import {
  arena_from_board,
  commands_from_staged,
  create_sim_chain,
  current_actor,
  derive_board,
  encode_sim_step,
  fold_projection,
  pending_mob_turn,
  run_ai_turn,
  sim_projection,
  snapshot_from_sim,
  submit_commands,
} from '../src/sim_chain.js'

const SEED = 0xc81f3a92
const FIGHT_ID = 'sim:1169:1'
const NOW = 1_784_752_468_344

// ╔════════════════ [ The scenario — an EROSION debuff, then ordinary damage ] ═════════════════════════════ ]

const level = (effects, { ap_cost = 3, range_max = 16 } = {}) => ({
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

const PLAYER_KIT = [
  { id: 's_erode', levels: [level([{ kind: SE.K_EROSION, value: 25, turns: 6, target_filter: SE.TF_NOT_TEAM }])] },
  { id: 's_nuke', levels: [level([{ kind: SE.K_DAMAGE, element: 0, value: 24, target_filter: SE.TF_NOT_TEAM }])] },
]
const MOB_KIT = [
  {
    id: 'm_hit',
    levels: [level([{ kind: SE.K_DAMAGE, element: 0, value: 4, target_filter: SE.TF_NOT_TEAM }], { range_max: 7 })],
  },
]
const TEMPLATES_RAW = [...PLAYER_KIT, ...MOB_KIT]

const fighter = (id, cell, is_player, { health, deck }) => ({
  id,
  name: id,
  cell,
  health,
  health_max: health,
  ap: 8,
  ap_max: 8,
  mp: 4,
  mp_max: 4,
  ap_used: 0,
  mp_used: 0,
  is_player,
  template_id: is_player ? 'senshi' : '0xmob_template',
  level: 20,
  stats: {},
  effects: [],
  spell_levels: Object.fromEntries(deck.map((s) => [s, 1])),
  ap_reserve: 0,
})

/** One seat on the board's own team-A start cell, one mob on team B — the simulator's own composition. */
const build_chain = () => {
  const { board } = derive_board(SEED)
  const arena = arena_from_board(board)
  return create_sim_chain({
    seed: SEED,
    fight_id: FIGHT_ID,
    team0: [fighter('sim_c1', arena.spawns_a[0], true, { health: 400, deck: PLAYER_KIT.map((s) => s.id) })],
    team1: [fighter('mob_0', arena.spawns_b[0], false, { health: 90, deck: MOB_KIT.map((s) => s.id) })],
    templates_raw: TEMPLATES_RAW,
  })
}

// ╔════════════════ [ The fold side — the production door, verbatim (sim_chain.test.js's pipeline) ] ═══════ ]

const view_of = (snapshot) => board_state_from_fight({ fight: snapshot, version: 1 })

const normalized = (receipt, version, view) =>
  normalize_events(receipt, {
    version,
    fight_id: view.id,
    resolve_seat: seat_resolver(view),
    base_of: base_budget(view),
  })

/** The seat's turn: erode the mob, then hit it — the exact order that arms the rider on the SECOND cast. */
const seat_turn = (state) => {
  const mob = state.team1.find((e) => e.health > 0)
  if (!mob) return []
  const at = encode(mob.cell.x, mob.cell.y)
  return [
    { kind: 1, spell_template_id: 's_erode', target: at },
    { kind: 1, spell_template_id: 's_nuke', target: at },
  ]
}

/** Drive the whole fight one batch at a time, banking both halves of the twin at every boundary AND the fold's
 *  liveness after EVERY single action — a death that only holds at batch boundaries is not a death. */
const drive = ({ max_batches = 80 } = {}) => {
  const view = view_of(snapshot_from_sim(build_chain(), { now_ms: NOW }))
  let chain = build_chain()
  let folded = base_from_view(view, FIGHT_ID)
  const batches = []
  const liveness = []
  for (let round = 0; round < max_batches; round += 1) {
    const actor = current_actor(chain)
    if (actor == null) break
    const mob = pending_mob_turn(chain)
    const {
      chain: next,
      receipt,
      version,
    } = mob
      ? run_ai_turn(chain, mob, { now_ms: NOW })
      : submit_commands(chain, commands_from_staged(seat_turn(chain.sim_state), actor), { now_ms: NOW })
    chain = next
    for (const action of normalized(receipt, version, view)) {
      folded = apply_action(folded, action)
      liveness.push({ round, kind: action.kind, fighters: fold_projection(folded).fighters })
    }
    batches.push({
      round,
      rows: receipt.events,
      sim: sim_projection(chain.sim_state),
      fold: fold_projection(folded),
    })
  }
  return { chain, batches, liveness }
}

const run = drive()

// ╔════════════════ [ The gates ] ═════════════════════════════════════════════════════════════════════════ ]

describe('#1169 — the dead stay dead and victory always fires', () => {
  test('① no receipt row states an hp the sim never held — the twin never drifts', () => {
    const drift = run.batches.find((b) => JSON.stringify(sorted(b.sim)) !== JSON.stringify(sorted(b.fold)))
    // RED before the fix: the erosion rider encoded `Hit{ remaining_hp: 0 }` and the fold buried a mob the sim
    // still had at full health.
    expect(drift && { round: drift.round, sim: drift.sim.fighters, fold: drift.fold.fighters }).toBeUndefined()
  })

  test('② a fighter the fold has buried never comes back — checked after EVERY folded action', () => {
    const revived = []
    run.liveness.reduce((prev, step) => {
      for (const [key, f] of Object.entries(step.fighters))
        if (prev?.[key]?.alive === false && f.alive === true)
          revived.push(`${key} revived on ${step.kind} (round ${step.round}): ${prev[key].hp} → ${f.hp}`)
      return step.fighters
    }, null)
    expect(revived).toEqual([])
  })

  test('③ the last enemy death and the victory terminal ride the SAME batch', () => {
    const wipe = run.batches.find((b) => Object.entries(b.sim.fighters).every(([key, f]) => key[0] !== 'm' || !f.alive))
    expect(wipe).toBeDefined()
    // The commit cycle that empties team1 is the cycle that carries the terminal — never a later one.
    expect(wipe.sim.winner).toBe(0)
    expect(wipe.rows.some((row) => String(row.type).endsWith('::Victory'))).toBe(true)
    expect(wipe.fold.winner).toBe(0)
  })

  test('④ the fight REACHES its terminal — a simulator fight can never run open-ended', () => {
    expect(run.chain.sim_state.winner).toBe(0)
    expect(run.chain.sim_state.team1.every((m) => m.health <= 0)).toBe(true)
  })

  test('⑤ a damage/heal row with NO resulting hp is LOUD, never an invented zero', () => {
    const state = run.chain.sim_state
    const step = () =>
      encode_sim_step({
        pre_state: state,
        post_state: state,
        events: [
          {
            type: 'fight_turn_effects',
            fight_id: FIGHT_ID,
            entity_id: state.team0[0].id,
            effects: [{ target_id: state.team0[0].id, damage: 3 }],
          },
        ],
        fight_id: FIGHT_ID,
      })
    expect(step).toThrow(/states no resulting hp/)
  })
})

/** Fighter maps compare by CONTENT, not by insertion order (the sim collects players first, the fold sorts). */
function sorted(projection) {
  return {
    ...projection,
    fighters: Object.fromEntries(
      Object.keys(projection.fighters)
        .sort()
        .map((key) => [key, projection.fighters[key]])
    ),
  }
}
