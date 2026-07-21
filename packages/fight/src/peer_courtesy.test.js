// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// THE COURTESY CHANNEL (#334) — a peer's committed draft, relayed real-time, enters the ONE fight door as a
// legality-gated PREDICTION: it PAINTS for the eye but NEVER touches committed truth (p2p costs latency, never
// correctness), an ILLEGAL injected batch never displays and is flagged, and the canonical receipt retires a
// matched prediction by its CLAIM (#308) — presenting once, no double-play. These are the RED-FIRST proofs.

import { describe, expect, test } from 'bun:test'

import { active_store, ev, fight_object, mob, participant, ME, PEER, T0 } from '../harness/fixtures.js'

import { committed_state, presented_state } from './fold.js'
import { apply_peer_batch, drafted_batch } from './txs.js'

// A coop board: ME at seat 0 (cell 21), a PEER at seat 1 (cell 22, turn-start MP 3), one mob at cell 45. The
// peer authors ITS OWN turn; MY turn is the one active_store opens, which the gate never depends on.
const CELL = { p_me: 21, p_peer: 22, near: 24, far: 28, mob: 45 } // encode(x,y)=y*20+x: 22=(2,1) 24=(4,1) 28=(8,1)
const coop_store = () =>
  active_store({
    fight: fight_object({
      participants: [participant(ME, CELL.p_me), participant(PEER, CELL.p_peer, { base_mp: 3 })],
      mobs: [mob(CELL.mob, { hp: 20 })],
    }),
  })

const peer_cell = (store, key = 'p1') => presented_state(store.getState()).fighters?.[key]?.cell
const committed_peer_cell = (store, key = 'p1') => committed_state(store.getState()).fighters?.[key]?.cell
const mob_hp = (store, key = 'm0') => presented_state(store.getState()).fighters?.[key]?.hp
const committed_mob_hp = (store, key = 'm0') => committed_state(store.getState()).fighters?.[key]?.hp

// `peer` is the BROADCASTER (whose seat the door resolves + gates); `character` is who the Moved is authored as
// (defaults to the broadcaster). The spoof case broadcasts as PEER but authors ME's move — a cross-seat forgery.
const send_peer_move = (store, { to_cell, peer = PEER, character = peer, intent_id = 'peer:move' }) =>
  apply_peer_batch(store, { peer, intent_id, actions: [{ kind: 'Moved', character, to_cell }] })

// A peer cast on the mob (Cast by seat 1 + a Hit down to `remaining_hp`) — the composite the courtesy relay carries.
const send_peer_cast = (store, { remaining_hp, intent_id = 'peer:cast' }) =>
  apply_peer_batch(store, {
    peer: PEER,
    intent_id,
    actions: [
      { kind: 'Cast', caster_is_mob: false, caster_idx: 1, damaging: true },
      { kind: 'Hit', victim_is_mob: true, victim_idx: 0, remaining_hp },
    ],
  })

// The peer's turn CONFIRMED by the canonical receipt (Cast + the authoritative Hit) — the same claim vocabulary.
const confirm_peer_cast = (store, { remaining_hp, at = T0 + 3_000 }) =>
  store.getState().input(
    {
      type: 'receipt',
      version: store.getState().applied_version + 1,
      receipt: {
        events: [
          ev('Cast', { caster_is_mob: false, caster_idx: 1 }),
          ev('Hit', { victim_is_mob: true, victim_idx: 0, amount: 20 - remaining_hp, remaining_hp }),
        ],
      },
    },
    at
  )

describe('#334 (a) — the legality gate: an illegal peer batch never paints, and is flagged', () => {
  test('a legal in-budget move pre-paints the peer — presentation only, committed untouched', () => {
    const store = coop_store()
    expect(peer_cell(store)).toBe(CELL.p_peer)

    send_peer_move(store, { to_cell: CELL.near }) // 2 cells, within the peer's MP 3
    expect(peer_cell(store), 'a legal peer move pre-paints').toBe(CELL.near)
    expect(committed_peer_cell(store), 'p2p is presentation ONLY — committed truth never moves').toBe(CELL.p_peer)
    expect(store.getState().flagged, 'a legal batch raises no flag').toBeNull()
  })

  test('an OVER-BUDGET move (6 cells, MP 3) never paints and raises the flag', () => {
    const store = coop_store()
    send_peer_move(store, { to_cell: CELL.far }) // 6 cells — unreachable within MP 3
    expect(peer_cell(store), 'the illegal move NEVER reaches the eye').toBe(CELL.p_peer)
    expect(store.getState().flagged?.reason).toBe('over_budget_move')
    expect(store.getState().flagged?.peer).toBe(PEER)
  })

  test('a SPOOFED move (authored as another fighter) is flagged, never painted', () => {
    const store = coop_store()
    // The peer broadcasts a Moved for ME (seat 0) — a peer may only author its own turn.
    send_peer_move(store, { to_cell: CELL.near, character: ME, intent_id: 'peer:spoof' })
    expect(peer_cell(store, 'p0'), 'my own cell is never moved by a peer relay').toBe(CELL.p_me)
    expect(store.getState().flagged?.reason).toBe('spoofed_mover')
  })
})

describe('#334 (b) — claim integration: a peer prediction retires on its canonical receipt, presenting ONCE', () => {
  test('a peer cast pre-paints the hit; the receipt retires it byte-equal (silent, committed adopts)', () => {
    const store = coop_store()
    expect(committed_mob_hp(store)).toBe(20)

    send_peer_cast(store, { remaining_hp: 5 })
    expect(mob_hp(store), 'the peer cast pre-paints the mob at 5').toBe(5)
    expect(committed_mob_hp(store), 'committed truth is untouched until the receipt').toBe(20)

    confirm_peer_cast(store, { remaining_hp: 5 })
    expect(mob_hp(store), 'the confirmed value holds — presented once, no rollback').toBe(5)
    expect(committed_mob_hp(store), 'the receipt raises committed truth to the authoritative hit').toBe(5)
    expect(store.getState().divergence, 'a byte-equal claim retires SILENTLY — zero divergence toast').toBeNull()
  })
})

describe('#334 (c) — idempotence: a re-delivered peer batch paints once', () => {
  test('the same batch delivered twice folds once (peer_seen dedupe)', () => {
    const store = coop_store()
    send_peer_cast(store, { remaining_hp: 8, intent_id: 'peer:turn-7' })
    const seq_after_first = store.getState().intent_seq
    const peer_entries = () => Object.values(store.getState().entries).filter((entry) => entry.peer).length
    const first = peer_entries()
    expect(mob_hp(store)).toBe(8)

    send_peer_cast(store, { remaining_hp: 8, intent_id: 'peer:turn-7' }) // exact re-delivery
    expect(peer_entries(), 'a re-delivered batch folds NO new entries').toBe(first)
    expect(store.getState().intent_seq, 'the intent cursor never advances on a duplicate').toBe(seq_after_first)
    expect(mob_hp(store), 'the mob is painted once, not double-struck').toBe(8)
  })
})

describe('#334 — the broadcast payload is the drafted turn in the receipt vocabulary (one home)', () => {
  test('drafted_batch reads my own intent entries, stripped of transport keys', () => {
    // Drive MY own optimistic cast through the composite door, then read what the courtesy channel would send.
    const store = coop_store()
    store.getState().input(
      {
        type: 'predicted',
        intent_id: 'mine',
        basis_version: store.getState().applied_version + 1,
        actions: [
          { kind: 'Cast', caster_is_mob: false, caster_idx: 0, damaging: true },
          { kind: 'Hit', victim_is_mob: true, victim_idx: 0, remaining_hp: 12 },
        ],
      },
      T0 + 1_000
    )
    const batch = drafted_batch(store)
    expect(batch.actions.map((a) => a.kind)).toEqual(['Cast', 'Hit'])
    // transport keys are the receiver's to assign — never on the wire.
    for (const action of batch.actions) {
      expect(action).not.toHaveProperty('version')
      expect(action).not.toHaveProperty('source')
      expect(action).not.toHaveProperty('event_idx')
    }
    expect(batch.intent_id).toContain(':p0:')
  })
})
