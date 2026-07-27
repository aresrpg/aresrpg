// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// trap_midpath_crossing.test.js — THE MID-PATH TRAP GATE (#954 · #1050).
//
// THE ROOT CAUSE THIS PINS: a receipt collapses a whole walk into its LANDED cell (`Moved`/`MobMoved` carry
// `to_cell` and nothing else), so a trap crossed MID-PATH had no row of its own. The renderer matched traps
// against `to` alone, so:
//   · no `trap_trigger` beat ever fired for a crossing (no boom, and the fold never retired the trap), and
//   · the chain's trap `Hit` — emitted BEFORE the walk's row, because `movement::walk` fires the trap INLINE
//     and `actions.move:69` / `turns.move:305` emit `Moved`/`MobMoved` only AFTER the walk returns — fell into
//     `pending` and flushed into a bare synthetic `fight` turn at `at: 0`.
// That last line IS the owner's live symptom, three times over: "the mob took the trap damage at TURN START,
// before its movement, and the trap did not disappear".
//
// THE SPEC IS THE CHAIN, and the chain is CORRECT (`packages/move/engine/sources/movement.move:43-50`): the
// trap fires the instant its cell is ENTERED, entrant-blind (the placer springs their own), it is consumed by
// the trigger, and the route RESUMES. The sim reducer already mirrors it exactly (`packages/sim/src/reduce.js`
// `walk_path`) — the divergence was never in the mechanics, only in what the receipt could NARRATE. No Move
// change is needed to close it: the renderer already reconstructs the walked route, so the trigger cell is
// re-derivable client-side.

import { describe, expect, test } from 'bun:test'

import { DAMAGE_BEAT_MS, TRAP_BEAT_MS, produce_receipt_render_turns } from '../src/fight_render_events.js'
import { FIGHT_RENDER_TIMINGS } from '../src/fight_render_prims.js'
import { encode_sim_step } from '../src/sim_chain_events.js'

const W = 20
const enc = (x, y) => y * W + x
const FIGHT = 'f1'
const WALK = FIGHT_RENDER_TIMINGS.walk_cell

const ev = (kind, fields) => ({ type: `0xE::fight_events::${kind}`, parsedJson: { fight: FIGHT, ...fields } })

// The mob walks (10,0) → (7,0). The trap sits MID-PATH at (8,0): entered on step 2 of 3, never the endpoint.
const MOB_MOVED = ev('MobMoved', { idx: '0', to_cell: String(enc(7, 0)) })
const TRAP_HIT = ev('Hit', { victim_is_mob: true, victim_idx: '0', amount: '10', remaining_hp: '190' })

const resolve_fighter_id = ({ is_mob, idx, character }) => character ?? `${is_mob ? 'm' : 'p'}${idx}`

const render = (raw_events, { trap_cell = enc(8, 0), from = { x: 10, y: 0 }, id = 'm0' } = {}) =>
  produce_receipt_render_turns(raw_events, {
    fight_id: FIGHT,
    trap_cells: new Set([trap_cell]),
    resolve_fighter_id,
    fighter_cells: new Map([[id, from]]),
  })

const shape = (turn) =>
  turn.events.map((beat) => ({
    kind: beat.kind,
    at: beat.at,
    duration: beat.duration,
    cell: beat.payload.cell ?? beat.payload.path?.at(-1) ?? null,
  }))

// The beat sequence a mid-path crossing MUST produce: the walk is SPLIT at the trap cell, the boom is anchored
// there, the damage lands on that step, and the remaining movement resumes — the chain's own resume semantics
// (`movement.move`: detonate, then continue unless the mover died or was displaced off the route).
const SPLIT_WALK = [
  { kind: 'move', at: 0, duration: 2 * WALK, cell: { x: 8, y: 0 } },
  { kind: 'arrival', at: 2 * WALK, duration: 0, cell: { x: 8, y: 0 } },
  { kind: 'trap_trigger', at: 2 * WALK, duration: TRAP_BEAT_MS, cell: { x: 8, y: 0 } },
  { kind: 'damage', at: 2 * WALK + TRAP_BEAT_MS, duration: DAMAGE_BEAT_MS, cell: null },
  { kind: 'move', at: 2 * WALK + TRAP_BEAT_MS + DAMAGE_BEAT_MS, duration: WALK, cell: { x: 7, y: 0 } },
  { kind: 'arrival', at: 3 * WALK + TRAP_BEAT_MS + DAMAGE_BEAT_MS, duration: 0, cell: { x: 7, y: 0 } },
]

describe('mid-path trap crossing — the destination-only row no longer eats the trigger (#954)', () => {
  // ① THE REPORTED BUG, in the chain's own emitter order.
  test('CHAIN order (Hit before MobMoved): the walk splits at the trap, no turn-start damage bucket', () => {
    const receipt = render([TRAP_HIT, MOB_MOVED])

    // The whole turn belongs to the MOVER. A synthetic `fight` turn holding a damage beat at at:0 IS the
    // "damage at turn start, before the mob moved" the owner reported.
    expect(receipt.turns.map((turn) => turn.source_id)).toEqual(['m0'])
    expect(shape(receipt.turns[0])).toEqual(SPLIT_WALK)
  })

  test('the trap Hit is attributed as TRAP damage, not an anonymous hit', () => {
    const receipt = render([TRAP_HIT, MOB_MOVED])
    const damage = receipt.turns[0].events.find((beat) => beat.kind === 'damage')
    expect(damage.payload.trap_damage).toBe(true)
    expect(damage.payload.damage).toBe(10)
    expect(receipt.turns[0].events.find((beat) => beat.kind === 'trap_trigger').payload.damage).toBe(10)
  })

  // ④ THE EMITTER-ORDER GUARD. An earlier lane aligned the sim encoder's Hit/Moved order to the chain's and
  // reverted it, correctly: with the renderer blind to mid-path traps, the alignment merely handed the
  // simulator the world's symptom (the `fight`-turn damage bucket above). Both orders must now render
  // IDENTICALLY — that equality is what makes the alignment safe.
  test('SIM order (MobMoved before Hit) renders byte-identically to the chain order', () => {
    expect(shape(render([MOB_MOVED, TRAP_HIT]).turns[0])).toEqual(shape(render([TRAP_HIT, MOB_MOVED]).turns[0]))
    expect(render([MOB_MOVED, TRAP_HIT]).turns.map((turn) => turn.source_id)).toEqual(['m0'])
  })

  // ③ THE #1050 RULING — entrant-blind: the placer springs their own trap (`movement.move:10`, "AresRPG's 1.29
  // brand law is entrant-based"). The renderer must narrate MY OWN walk across MY OWN trap exactly the same.
  test('the placer walking through their OWN trap narrates identically (no owner immunity)', () => {
    const moved = ev('Moved', { character: '0xc1', to_cell: String(enc(7, 0)) })
    const hit = ev('Hit', { victim_is_mob: false, victim_idx: '0', amount: '10', remaining_hp: '190' })
    const receipt = produce_receipt_render_turns([hit, moved], {
      fight_id: FIGHT,
      trap_cells: new Set([enc(8, 0)]),
      // Production shape (`inputs.js seat_resolver`): a seat index and its character id name the SAME fighter —
      // the walker and the Hit's victim must resolve identically or nothing can be attributed.
      resolve_fighter_id: ({ character, is_mob, idx }) => character ?? (is_mob ? `m${idx}` : '0xc1'),
      fighter_cells: new Map([['0xc1', { x: 10, y: 0 }]]),
    })
    expect(receipt.turns.map((turn) => turn.source_id)).toEqual(['0xc1'])
    expect(shape(receipt.turns[0])).toEqual(SPLIT_WALK)
  })

  // The ENDPOINT case is the one the renderer already handled — it must fall out of the same general split
  // (the trap is simply the LAST step), never a second code path.
  test('a trap ON the destination cell keeps its existing shape (one leg, no tail)', () => {
    const receipt = render([MOB_MOVED, TRAP_HIT], { trap_cell: enc(7, 0) })
    expect(shape(receipt.turns[0])).toEqual([
      { kind: 'move', at: 0, duration: 3 * WALK, cell: { x: 7, y: 0 } },
      { kind: 'arrival', at: 3 * WALK, duration: 0, cell: { x: 7, y: 0 } },
      { kind: 'trap_trigger', at: 3 * WALK, duration: TRAP_BEAT_MS, cell: { x: 7, y: 0 } },
      { kind: 'damage', at: 3 * WALK + TRAP_BEAT_MS, duration: DAMAGE_BEAT_MS, cell: null },
    ])
  })

  test('a walk that crosses NO trap is untouched — one move beat, one arrival', () => {
    const receipt = render([MOB_MOVED], { trap_cell: enc(4, 4) })
    expect(shape(receipt.turns[0])).toEqual([
      { kind: 'move', at: 0, duration: 3 * WALK, cell: { x: 7, y: 0 } },
      { kind: 'arrival', at: 3 * WALK, duration: 0, cell: { x: 7, y: 0 } },
    ])
  })

  // The gait is a property of the WALK, not of a leg: splitting a long (run-cadence) path must not silently
  // slow the mover down to a walk on both halves.
  // (the encoder's own order is pinned in the `mock chain` block below)
  test('splitting a run-length path keeps the run cadence on both legs', () => {
    const receipt = render([ev('MobMoved', { idx: '0', to_cell: String(enc(4, 0)) }), TRAP_HIT], {
      trap_cell: enc(8, 0),
    })
    const moves = receipt.turns[0].events.filter((beat) => beat.kind === 'move')
    // (10,0) → (4,0) is 6 cells, past the run threshold; the trap at (8,0) splits it 2 + 4.
    expect(moves.map((beat) => beat.payload.path.length)).toEqual([2, 4])
    expect(moves.map((beat) => beat.duration)).toEqual([
      2 * FIGHT_RENDER_TIMINGS.run_cell,
      4 * FIGHT_RENDER_TIMINGS.run_cell,
    ])
  })
})

// ── THE MOCK CHAIN'S EMISSION ORDER (④) ────────────────────────────────────────────────────────────────────
// The simulator's local "chain" must speak the real chain's dialect or the two surfaces are different products.
// `movement::walk` fires a crossed trap INLINE and the walk's single row is emitted only after it returns
// (actions.move:69 / turns.move:305), so the Hit precedes the Moved row. The sim reducer returns them the other
// way round, and an earlier lane's attempt to align this was reverted — correctly, because with the renderer
// blind to mid-path traps the alignment only handed the simulator the world's symptom. The equality asserted
// above ("SIM order renders byte-identically to the chain order") is what makes it safe now.
describe('the mock chain emits a crossed trap the way the chain does (④)', () => {
  const fighter = (id, cell) => ({ id, cell, health: 200, health_max: 200, effects: [], is_player: id === 'p0' })
  const state = (mob_cell) => ({
    team0: [fighter('p0', { x: 0, y: 0 })],
    team1: [{ ...fighter('mob_0', mob_cell), health: 190 }],
  })

  test('the trap Hit precedes the walk row it fired inside', () => {
    const { rows } = encode_sim_step({
      pre_state: state({ x: 10, y: 0 }),
      post_state: state({ x: 7, y: 0 }),
      fight_id: FIGHT,
      events: [
        // the reducer's own order: the move, then the trap it sprang on the way (reduce.js handle_move)
        {
          type: 'fight_moved',
          fight_id: FIGHT,
          entity_id: 'mob_0',
          path: [
            { x: 9, y: 0 },
            { x: 8, y: 0 },
            { x: 7, y: 0 },
          ],
          tackled: false,
          mp_remaining: 0,
        },
        {
          type: 'fight_trap_triggered',
          fight_id: FIGHT,
          entity_id: 'mob_0',
          cell: { x: 8, y: 0 },
          effects: [{ target_id: 'mob_0', damage: 10, new_health: 190, killed: false }],
        },
      ],
    })
    expect(rows.map((row) => row.type.split('::').at(-1))).toEqual(['Hit', 'MobMoved'])
  })
})
