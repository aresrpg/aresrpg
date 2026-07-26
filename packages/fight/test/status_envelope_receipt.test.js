// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #973 — THE FOLD TWIN of `packages/sim/test/status_duration_scope.test.js`.
//
// The sim is innocent: its tick scope already matches `cast.move:1585` (that oracle pins it). The defect lived
// on the RECEIPT side — `sim_chain_events.js` emitted NONE of the action-envelope rows the chain wraps a cast
// in (`ActionStarted` / `ActionEffect` / `ActionResolved`, cast.move:208-239 → `record_timed`), so the fold's
// per-fighter `statuses` home never populated. The chip was pure PREDICTION and the receipt fold retired it:
// the counter went `3 → absent` without ever rendering `2`, and the granted MP reverted with it.
//
// So this file folds REAL receipts through the production door — `normalize_events` → `apply_action`, the same
// two functions the store runs — and asserts the committed state carries the status WITH its counter, and that
// the counter burns exactly one tick per ROUND at the OWNER's turn end (three usable turns), with two mob turns
// in between that must not touch it. Same 1-player + 2-mob seat count as the driven capture in the report.

import { describe, expect, test } from 'bun:test'

import { K_GIVE_POINTS, K_INVISIBILITY, POINT_MP, SHAPE_POINT, TF_ONLY_CASTER } from '../../sim/src/spell_effect.js'
import { board_state_from_fight } from '../src/board_state.js'
import { base_budget, base_from_view } from '../src/fold.js'
import { apply_action, empty_state, normalize_events, seat_resolver } from '../src/inputs.js'
import {
  arena_from_board,
  create_sim_chain,
  derive_board,
  pending_mob_turn,
  run_ai_turn,
  snapshot_from_sim,
  submit_commands,
} from '../src/sim_chain.js'

const SEED = 0x973f01d1
const FIGHT_ID = 'sim:973:1'
const VANISH = 'vanish_probe'

/** The reported cast, authored in the CHAIN shape the seed corpus mints: a point self-cast granting `+1 MP`
 *  and `invisible` for 3 turns — the two kinds `inputs.js SELF_STATUS_KINDS` accepts off an `ActionEffect`. */
const VANISH_ROWS = [
  {
    id: VANISH,
    name: 'Vanish (probe)',
    levels: [
      {
        ap_cost: 2,
        range_min: 0,
        range_max: 0,
        crit_rate: 0,
        line_of_sight: false,
        effects: [
          {
            kind: K_GIVE_POINTS,
            element: 255,
            value: 1,
            area_shape: SHAPE_POINT,
            area_size: 0,
            target_filter: TF_ONLY_CASTER,
            chance: 100,
            turns: 3,
            stat: POINT_MP,
            flags: 0,
            phase: 0,
          },
          {
            kind: K_INVISIBILITY,
            element: 255,
            value: 1,
            area_shape: SHAPE_POINT,
            area_size: 0,
            target_filter: TF_ONLY_CASTER,
            chance: 100,
            turns: 3,
            stat: 0,
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
  health: 400,
  health_max: 400,
  ap: 10,
  ap_max: 10,
  mp: 3,
  mp_max: 3,
  ap_used: 0,
  mp_used: 0,
  is_player,
  template_id: is_player ? 'senshi' : '0xmob_template',
  level: 1,
  stats: {},
  effects: [],
  deck: is_player ? [VANISH] : [],
  hand: is_player ? [VANISH] : [],
  discard: [],
  spell_levels: is_player ? { [VANISH]: 1 } : {},
  ap_reserve: 0,
})

/** A started fight on the reported seat count: one player, two mobs (a per-TURN tick burns 3 in one round). */
const open_fight = () => {
  const arena = arena_from_board(derive_board(SEED).board)
  const [a0] = arena.spawns_a
  const [b0, b1] = arena.spawns_b
  return create_sim_chain({
    seed: SEED,
    fight_id: FIGHT_ID,
    team0: [fighter('p0', a0, true)],
    team1: [fighter('m0', b0, false), fighter('m1', b1 ?? b0, false)],
    templates_raw: VANISH_ROWS,
    group_template: '0xgroup',
  })
}

/** The production fold door: normalize one receipt batch and reduce it onto the running committed state. */
const fold_receipt = (state, receipt, version, view) =>
  normalize_events(receipt, {
    version,
    fight_id: view.id,
    resolve_seat: seat_resolver(view),
    base_of: base_budget(view),
  }).reduce(apply_action, state)

/** Every mob turn until the player holds it again, folded onto the same committed state. */
const drive_mobs = (session) => {
  let next = session
  for (let guard = 0; guard < 8; guard += 1) {
    const mob = pending_mob_turn(next.chain)
    if (!mob) break
    const turn = run_ai_turn(next.chain, mob)
    next = {
      chain: turn.chain,
      state: fold_receipt(next.state, turn.receipt, turn.version, next.view),
      view: next.view,
    }
  }
  return next
}

const submit = (session, commands) => {
  const out = submit_commands(session.chain, commands)
  return {
    chain: out.chain,
    state: fold_receipt(session.state, out.receipt, out.version, session.view),
    view: session.view,
  }
}

const statuses_of = (state, key) => state.fighters[key]?.statuses ?? []
const row_of = (state, key, kind) => statuses_of(state, key).find((row) => Number(row.kind) === kind) ?? null
const remaining = (state, key, kind) => row_of(state, key, kind)?.remaining_turns ?? null

describe('#973 the receipt carries the status envelope — chips are fold truth, not prediction', () => {
  test('a committed 3-turn self-cast lands in the FOLD with its counter, then burns one tick per round', () => {
    const chain = open_fight()
    const view = board_state_from_fight({ fight: snapshot_from_sim(chain, { now_ms: 0 }), version: 1 })
    const opened = { chain, view, state: base_from_view(view, FIGHT_ID) }
    // The interleave can open on a mob — fold their turns until the caster holds it.
    const ready = drive_mobs(opened)
    expect(ready.chain.sim_state.team0[0].health).toBe(400)

    const cast = submit(ready, [
      { type: 'cast', entity_id: 'p0', spell_id: VANISH, target: ready.chain.sim_state.team0[0].cell },
    ])
    // THE REGRESSION: before the envelope rows existed this array was empty, so the counter could only ever
    // read `absent` — the chip the player saw was the local prediction and nothing else.
    expect(
      statuses_of(cast.state, 'p0')
        .map((row) => Number(row.kind))
        .sort((a, b) => a - b)
    ).toEqual([K_GIVE_POINTS, K_INVISIBILITY])
    expect(remaining(cast.state, 'p0', K_GIVE_POINTS)).toBe(3)
    expect(remaining(cast.state, 'p0', K_INVISIBILITY)).toBe(3)
    expect(cast.state.fighters.p0.invisible).toBe(true)
    // THE VALUE DIALECT (#979). `inputs.js:208` writes `ActionEffect.effect.value` into the status home RAW —
    // no 32768-centering decode, unlike the snapshot door — and the home's readers take the signed delta from
    // it. The emitted row must therefore carry the DECODED magnitude the sim holds (`+1 MP`), never a centered
    // wire number, or every chip reads 32768 off. Pinned here so the encoder can never drift into the other
    // dialect while the two-dialect ingress is fixed on its own row.
    expect(row_of(cast.state, 'p0', K_GIVE_POINTS)).toMatchObject({ value: 1, stat: POINT_MP, chance: 100 })

    // Round 1: the caster ends its turn (one tick), then BOTH mobs take theirs (no tick on the player's rows).
    const seen = []
    let cur = cast
    for (let round = 0; round < 3; round += 1) {
      cur = drive_mobs(submit(cur, [{ type: 'end_turn', entity_id: 'p0' }]))
      seen.push([remaining(cur.state, 'p0', K_GIVE_POINTS), remaining(cur.state, 'p0', K_INVISIBILITY)])
    }
    // Two mob turns per round, and the counter still RENDERS 2 then 1 before it is purged — the chain's
    // lifetime (cast.move:1585 decrements the ENDING actor's rows only), never `3 → absent`.
    expect(seen).toEqual([
      [2, 2],
      [1, 1],
      [null, null],
    ])
    expect(cur.state.fighters.p0.invisible).toBe(false)
  })

  test('a damage-free receipt batch folds the envelope idempotently — the action key is retired', () => {
    const chain = open_fight()
    const view = board_state_from_fight({ fight: snapshot_from_sim(chain, { now_ms: 0 }), version: 1 })
    const ready = drive_mobs({ chain, view, state: base_from_view(view, FIGHT_ID) })
    const out = submit_commands(ready.chain, [
      { type: 'cast', entity_id: 'p0', spell_id: VANISH, target: ready.chain.sim_state.team0[0].cell },
    ])
    const kinds = out.receipt.events.map((e) => e.type.split('::').pop())
    expect(kinds[0]).toBe('ActionStarted')
    expect(kinds.filter((k) => k === 'ActionEffect')).toHaveLength(2)
    expect(kinds.at(-1)).toBe('ActionResolved')

    // ActionResolved closes the envelope: the action context it opened must not survive the batch, or every
    // cast in a fight leaks a key into committed state.
    const folded = fold_receipt(base_from_view(view, FIGHT_ID), out.receipt, out.version, view)
    expect(Object.keys(folded.action_contexts)).toEqual([])
    // And the empty-state fold agrees — the arms are pure, so a bare fold sees the same rows.
    expect(Object.keys(fold_receipt(empty_state(FIGHT_ID), out.receipt, out.version, view).action_contexts)).toEqual([])
  })
})
