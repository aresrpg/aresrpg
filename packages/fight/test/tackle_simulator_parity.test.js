// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #1207 — THE TACKLE THE CLIENT PREVIEWS MUST BE THE TACKLE THE RESOLVER ROLLS.
//
// `next_move_tackle` (project.js) is the gate the mounted board obeys before a walk: non-null ⇒ the move is
// DENIED and both pools forfeit, null ⇒ the walk plays optimistically. It derives the chain's own roll —
// spell_formula::tackle_seed(fight::turn_seed, casts_this_turn, live mp) → prng::rng_next → escape iff
// draw % den < num (actions.move:53-63). The turn seed folds the turn's stamped entropy carrier + ordinal.
//
// The SIMULATOR mounts that same board (frontend/src/simulator/FightHud.jsx:41,90 → DungeonBoard.jsx:1021) over
// the local mock chain, whose snapshot ships world_seed + spawn_id + turn_entropy + turn_ordinal, so
// the gate takes its EXACT-PREVIEW branch there. But the mock's RESOLVER is `@aresrpg/sim`'s reducer, whose
// contest must receive those same bytes at the same cast slot.
//
// Two independent coins for one contest. This gate drives the real mock chain end to end and asserts they are
// the SAME verdict for every seed: the preview's bite ⇔ the resolver's denial, and the forfeit it announced ⇔
// the pools the resolver actually stripped.

import { describe, expect, test } from 'bun:test'

import { next_move_tackle } from '../src/project.js'
import {
  arena_from_board,
  create_sim_chain,
  current_actor,
  derive_board,
  run_ai_turn,
  snapshot_from_sim,
  submit_commands,
} from '../src/sim_chain.js'
import { create_fight_store } from '../src/store.js'

import { MOB_DECK, PLAYER_DECK, TEMPLATES_RAW, fighter } from './sim_chain_corpus.js'

const NOW = 1_784_752_468_344
const PLAYER = 'sim_p0'
const MOB = 'mob_0'
// Both sides at agility 40 ⇒ bucket 6 ⇒ num/den = 6/12 — the golden tackle vector, a true coin flip either way.
const AGI = 40
const SEEDS = [0xc81f3a92, 0x1a2b3c4d, 0x51a0b1c2, 0x7f0a1b2c, 0x0badc0de, 0x12345678]

const free_cell = (arena, taken, c) =>
  c.x >= 0 &&
  c.y >= 0 &&
  c.x < arena.width &&
  c.y < arena.height &&
  arena.cells[c.y * arena.width + c.x] === 0 &&
  !taken.has(`${c.x},${c.y}`)

const neighbours = (c) => [
  { x: c.x + 1, y: c.y },
  { x: c.x - 1, y: c.y },
  { x: c.x, y: c.y + 1 },
  { x: c.x, y: c.y - 1 },
]

const occupied = (state) =>
  new Set([...state.team0, ...state.team1].filter((e) => e.health > 0).map((e) => `${e.cell.x},${e.cell.y}`))

const at = (state, team, id) => state[team].find((e) => e.id === id)

const adjacent = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y) === 1

/** Boot a one-versus-one mock fight: a fat-MP player on team A's first spawn, one mob on team B's. */
const boot = (seed) => {
  const { board } = derive_board(seed)
  const arena = arena_from_board(board)
  const team0 = [
    fighter(PLAYER, arena.spawns_a[0], true, {
      health: 300,
      ap: 8,
      mp: 30,
      deck: PLAYER_DECK,
      stats: { agility: AGI },
    }),
  ]
  const team1 = [
    fighter(MOB, arena.spawns_b[0], false, {
      health: 300,
      ap: 6,
      mp: 3,
      deck: MOB_DECK,
      level: 12,
      stats: { agility: AGI },
    }),
  ]
  const chain = create_sim_chain({
    seed,
    fight_id: `sim:${seed >>> 0}:1207`,
    team0,
    team1,
    templates_raw: TEMPLATES_RAW,
  })
  return { chain, arena }
}

/** The store the mounted board reads, fed the mock's own snapshot through the production door. */
const store_over = (chain) => {
  const store = create_fight_store()
  store.getState().input({ type: 'init', fight_id: chain.fight_id, ctx: { my_entity_id: PLAYER } }, NOW)
  store.getState().input({ type: 'snapshot', fight: snapshot_from_sim(chain, { now_ms: NOW }), version: 1 }, NOW)
  return store
}

const rows_of = (receipt, name) => receipt.events.filter((row) => String(row.type).endsWith(`::${name}`))

/**
 * One seed's experiment: walk INTO the mob's tackle zone (uncontested — nobody locks the far spawn), read the
 * client's gate over the mock's snapshot, then submit the move OUT and read what the resolver actually did.
 */
const drive = (seed) => {
  const { chain: booted, arena } = boot(seed)
  let chain = booted
  for (let guard = 0; guard < 8 && current_actor(chain) !== PLAYER; guard++) {
    const actor = current_actor(chain)
    if (actor == null) break
    ;({ chain } = run_ai_turn(chain, actor, { now_ms: NOW }))
  }
  if (current_actor(chain) !== PLAYER) return { skipped: 'the player never got the first turn' }

  const mob_cell = at(chain.sim_state, 'team1', MOB).cell
  const start = at(chain.sim_state, 'team0', PLAYER).cell
  if (adjacent(start, mob_cell)) return { skipped: 'the seat spawned already locked' }
  const approach = neighbours(mob_cell).find((c) => free_cell(arena, occupied(chain.sim_state), c))
  if (!approach) return { skipped: 'the mob has no free neighbour' }

  // MOVE 1 — into the zone. No living enemy locks the start cell, so this one never contests.
  ;({ chain } = submit_commands(chain, [{ type: 'move', entity_id: PLAYER, path: [approach] }], { now_ms: NOW }))
  const me = at(chain.sim_state, 'team0', PLAYER)
  if (!adjacent(me.cell, mob_cell)) return { skipped: 'the approach never reached the zone' }

  // THE CLIENT'S GATE, over the mock's own snapshot — exactly what DungeonBoard consults before walking.
  const preview = next_move_tackle(store_over(chain).getState())

  // MOVE 2 — out of the zone. This is the contested one.
  const away = neighbours(me.cell).find((c) => free_cell(arena, occupied(chain.sim_state), c) && !adjacent(c, mob_cell))
  if (!away) return { skipped: 'no cell leaves the zone in one step' }
  const submitted = submit_commands(chain, [{ type: 'move', entity_id: PLAYER, path: [away] }], { now_ms: NOW })
  const after = at(submitted.chain.sim_state, 'team0', PLAYER)

  const tackled_rows = rows_of(submitted.receipt, 'Tackled')
  const moved_rows = rows_of(submitted.receipt, 'Moved')
  if (!tackled_rows.length && !moved_rows.length) return { skipped: 'the resolver refused the move outright' }

  return {
    seed,
    preview,
    predicted_tackle: preview != null,
    resolved_tackle: tackled_rows.length > 0,
    ap_lost: me.ap - after.ap,
    mp_lost: me.mp - after.mp,
    walked: !(after.cell.x === me.cell.x && after.cell.y === me.cell.y),
  }
}

describe('#1207 — the simulator resolves the tackle the client previewed', () => {
  const runs = SEEDS.map(drive).filter((run) => !run.skipped)

  test('the corpus actually exercised the contest', () => {
    expect(runs.length, 'at least three seeds produced a real contested move').toBeGreaterThanOrEqual(3)
  })

  test('every seed: the preview verdict IS the resolver verdict (no snap after commit)', () => {
    const disagreed = runs.filter((run) => run.predicted_tackle !== run.resolved_tackle)
    expect(
      disagreed.map(
        (run) =>
          `seed 0x${(run.seed >>> 0).toString(16)}: previewed ` +
          `${run.predicted_tackle ? 'TACKLED' : 'walks free'} · resolved ${run.resolved_tackle ? 'TACKLED' : 'walked'}`
      ),
      'the client gate and the mock resolver must roll ONE contest'
    ).toEqual([])
  })

  test('a previewed bite forfeits exactly the pools it announced', () => {
    const bitten = runs.filter((run) => run.predicted_tackle && run.resolved_tackle)
    for (const run of bitten) {
      expect(run.ap_lost, `seed 0x${(run.seed >>> 0).toString(16)} ap forfeit`).toBe(run.preview.ap_lost)
      expect(run.mp_lost, `seed 0x${(run.seed >>> 0).toString(16)} mp forfeit`).toBe(run.preview.mp_lost)
      expect(run.walked, 'a bitten move never displaces').toBe(false)
    }
  })
})
