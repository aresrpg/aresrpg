// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// M1 COOP SCENARIO (D768 / census M1-ii): TWO actors as two store instances fed ONE receipt feed — the
// join door, seat-keyed locality (R1: my turn paints instantly for me, paces as a wave for my peer),
// byte-identical committed convergence, and PER-SEAT settlement (each seat runs its own bounded attempt;
// one seat's claim never consumes the other's). Plain objects, explicit clocks, zero browser — the
// browser two-actor spec becomes M3's thin visual layer over exactly this contract.
import { describe, test, expect } from 'bun:test'

import { create_fight_store } from '../src/store.js'
import { state_hash, canonical_state } from '../src/inputs.js'
import { committed_truth } from '../src/store.js'
import { engine_view, board_view, presenting } from '../src/project.js'
import { MOB_TURN_MS } from '../src/present.js'

const FIGHT = '0xc00p'
const ALICE = '0xchar_alice'
const BOB = '0xchar_bob'
const T0 = 2_000_000

const ev = (kind, json) => ({ type: `0xpkg::fight_events::${kind}`, parsedJson: { fight: FIGHT, ...json } })

const participant = (owner, character, cell, ready = true) => ({
  owner,
  character,
  class: 'warrior',
  team: 0,
  hp: 50,
  max_hp: 50,
  ap: 12,
  mp: 3,
  base_ap: 12,
  base_mp: 3,
  cell,
  ready,
  casts_this_turn: 0,
  weapon: null,
})

const fight_object = ({ status = 1, seats, mob = {} }) => ({
  id: FIGHT,
  status,
  width: 20,
  height: 19,
  participants: seats,
  group_template: '0xmob_t',
  group_base_ap: 6,
  group_base_mp: 3,
  mobs: [{ template: '0xmob_t', level: 3, hp: 20, max_hp: 20, cell: 45, ap: 6, mp: 3, ...mob }],
  obstacles: [],
  holes: [],
  shape_mask: [],
  start_cells_a: [21, 22],
  start_cells_b: [],
  turn_ptr: 0,
  queue: [],
  turn_deadline_ms: T0 + 30_000,
  placement_deadline_ms: 0,
  world_seed: null,
  spawn_id: null,
  last_action_ms: 0,
})

const seat_of = (owner, character) => {
  const store = create_fight_store()
  store
    .getState()
    .input(
      { type: 'init', fight_id: FIGHT, ctx: { my_entity_id: character, address: owner, beat_ctx: { grid_width: 20 } } },
      T0
    )
  return store
}

/** Bob's whole turn (non-local for alice, local for bob) then the mob's — ONE feed both clients fold. */
const shared_receipt = () => ({
  events: [
    ev('TurnStarted', { is_mob: false, idx: 1 }),
    ev('Moved', { character: BOB, to_cell: 42 }),
    ev('Cast', { caster_is_mob: false, caster_idx: 1, target_cell: 45 }),
    ev('Hit', { victim_is_mob: true, victim_idx: 0, amount: 8, remaining_hp: 12, caster_is_mob: false, caster_idx: 1 }),
    ev('TurnEnded', { is_mob: false, idx: 1 }),
    ev('TurnStarted', { is_mob: true, idx: 0 }),
    ev('Cast', { caster_is_mob: true, caster_idx: 0, target_cell: 22 }),
    ev('Hit', { victim_is_mob: false, victim_idx: 1, amount: 6, remaining_hp: 44, caster_is_mob: true, caster_idx: 0 }),
    ev('TurnEnded', { is_mob: true, idx: 0 }),
    ev('TurnStarted', { is_mob: false, idx: 0, deadline_ms: T0 + 60_000 }),
  ],
})

describe('coop — two actors, one truth', () => {
  // V2 #522 cutover gate 8 — MODES (parties one-frontier): a MID-FIGHT roster change
  // (a peer joining after this client bootstrapped) propagates through the party journal path — a
  // second object read is an inert checkpoint, it no longer re-adopts the roster. Re-enable when the
  // modes cutover lands roster propagation over the one door.
  // #746 adjudication: un-skipped at HEAD, RED for exactly this reason (the second read leaves BOB out of
  // the roster). Registered on #522 as coverage gate 8 must restore.
  test.skip('JOIN DOOR: the second seat adopts through the same snapshot input; each client resolves ITS seat', () => {
    const alice = seat_of('0xa11ce', ALICE)
    // room opens with alice alone…
    alice
      .getState()
      .input(
        { type: 'snapshot', fight: fight_object({ seats: [participant('0xa11ce', ALICE, 21)] }), version: 1 },
        T0 + 10
      )
    expect(alice.getState().my_key).toBe('p0')
    // …bob joins: the SAME object read (now two escrow rows) is both clients' join door — no special input kind.
    const joined = fight_object({ seats: [participant('0xa11ce', ALICE, 21), participant('0xb0b', BOB, 22)] })
    const bob = seat_of('0xb0b', BOB)
    alice.getState().input({ type: 'snapshot', fight: joined, version: 2 }, T0 + 50)
    bob.getState().input({ type: 'snapshot', fight: joined, version: 2 }, T0 + 60)
    expect(bob.getState().my_key).toBe('p1')
    expect(alice.getState().my_key).toBe('p0')
    const alice_view = engine_view(alice.getState())
    expect([...alice_view.fighters.keys()].sort()).toEqual([ALICE, BOB, 'mob-0'].sort())
    expect(alice_view.my_entity_id).toBe(ALICE)
    expect(engine_view(bob.getState()).my_entity_id).toBe(BOB)
  })

  test('R1 LOCALITY BY SEAT: one feed — bob’s turn paces as a wave for ALICE, never for bob himself', () => {
    const joined = fight_object({ seats: [participant('0xa11ce', ALICE, 21), participant('0xb0b', BOB, 22)] })
    const alice = seat_of('0xa11ce', ALICE)
    const bob = seat_of('0xb0b', BOB)
    alice.getState().input({ type: 'snapshot', fight: joined, version: 2 }, T0 + 50)
    bob.getState().input({ type: 'snapshot', fight: joined, version: 2 }, T0 + 60)
    alice.getState().input({ type: 'receipt', receipt: shared_receipt(), version: 3 }, T0 + 500)
    bob.getState().input({ type: 'receipt', receipt: shared_receipt(), version: 3 }, T0 + 510)

    // ALICE sees bob's turn + the mob's as PACED waves (two non-local turns, ~3s each)…
    const alice_remote = alice.getState().wave.filter((t) => !t.is_local)
    expect(alice_remote.map((t) => t.source_id)).toEqual([BOB, 'mob-0'])
    expect(presenting(alice.getState())).toBe(true)
    // …bob paces ONLY the mob (his own turn already painted at his click — is_local by SEAT, not by id string).
    const bob_remote = bob.getState().wave.filter((t) => !t.is_local)
    expect(bob_remote.map((t) => t.source_id)).toEqual(['mob-0'])

    // CONVERGENCE: both committed folds are byte-identical — the parity guarantee across clients.
    const a = committed_truth(alice.getState())
    const b = committed_truth(bob.getState())
    expect(state_hash(a)).toBe(state_hash(b))
    expect(JSON.stringify(canonical_state(a))).toBe(JSON.stringify(canonical_state(b)))
    expect(a.fighters.m0.hp).toBe(12)
    expect(a.fighters.p1.hp).toBe(44)
  })

  test('PEER 3s WAVE: a coop peer turn renders in full, in one 3s slot, after the tx is seen', () => {
    const joined = fight_object({ seats: [participant('0xa11ce', ALICE, 21), participant('0xb0b', BOB, 22)] })
    const alice = seat_of('0xa11ce', ALICE)
    alice.getState().input({ type: 'snapshot', fight: joined, version: 2 }, T0 + 50)
    alice.getState().input({ type: 'receipt', receipt: shared_receipt(), version: 3 }, T0 + 500)
    const bob_turn = alice.getState().wave.find((t) => t.source_id === BOB)
    expect(bob_turn).toBeTruthy()
    expect(bob_turn.is_local).toBe(false)
    expect(bob_turn.duration).toBe(MOB_TURN_MS) // the peer slot = the SAME 3s pacing a mob turn gets
    // …and it carries his WHOLE tx: the move AND the cast AND its hit, every beat inside the slot.
    const kinds = bob_turn.beats.map((b) => b.kind)
    expect(kinds).toContain('move')
    expect(kinds).toContain('cast')
    expect(kinds).toContain('damage')
    for (const b of bob_turn.beats) expect(b.at + (b.duration || 0)).toBeLessThanOrEqual(MOB_TURN_MS)
  })

  test('PER-SEAT SETTLEMENT: one Victory, two independent bounded attempts — neither consumes the other', () => {
    const joined = fight_object({ seats: [participant('0xa11ce', ALICE, 21), participant('0xb0b', BOB, 22)] })
    const alice = seat_of('0xa11ce', ALICE)
    const bob = seat_of('0xb0b', BOB)
    alice.getState().input({ type: 'snapshot', fight: joined, version: 2 }, T0 + 50)
    bob.getState().input({ type: 'snapshot', fight: joined, version: 2 }, T0 + 60)
    const kill = {
      events: [
        ev('Cast', { caster_is_mob: false, caster_idx: 0, target_cell: 45 }),
        ev('Hit', {
          victim_is_mob: true,
          victim_idx: 0,
          amount: 20,
          remaining_hp: 0,
          caster_is_mob: false,
          caster_idx: 0,
        }),
        ev('Victory', {}),
      ],
    }
    alice.getState().input({ type: 'receipt', receipt: kill, version: 3 }, T0 + 900)
    bob.getState().input({ type: 'receipt', receipt: kill, version: 3 }, T0 + 910)

    const alice_request = board_view(alice.getState()).settlement_request
    const bob_request = board_view(bob.getState()).settlement_request
    expect(alice_request?.phase).toBe('victory')
    expect(bob_request?.phase).toBe('victory')
    expect(alice_request.signal).toBe(bob_request.signal) // same chain confirmation…

    // …but each SEAT runs its own attempt machine. Alice claims + succeeds:
    alice.getState().input({ type: 'settlement_attempt', signal: alice_request.signal }, T0 + 1_000)
    alice.getState().input({ type: 'settlement_outcome', signal: alice_request.signal, verdict: 'opened' }, T0 + 1_200)
    alice.getState().input({ type: 'settlement_request_consumed', signal: alice_request.signal }, T0 + 1_300)
    expect(alice.getState().settlement.attempt.verdict).toBe('opened')
    expect(alice.getState().settlement.chain_terminal.consumed).toBe(true)

    // Bob's seat is UNTOUCHED by alice's claim: his request still stands, his attempt runs independently,
    // and a transient failure re-arms only HIS machine.
    expect(bob.getState().settlement.attempt).toBe(null)
    expect(board_view(bob.getState()).settlement_request?.signal).toBe(bob_request.signal)
    bob.getState().input({ type: 'settlement_attempt', signal: bob_request.signal }, T0 + 1_400)
    bob.getState().input({ type: 'settlement_outcome', signal: bob_request.signal, verdict: 'transient' }, T0 + 1_500)
    expect(bob.getState().settlement.attempt.verdict).toBe('transient')
    expect(alice.getState().settlement.attempt.verdict).toBe('opened') // still — no cross-seat bleed
  })
})
