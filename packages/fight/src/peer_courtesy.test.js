// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// THE COURTESY CHANNEL (#334) — the SECOND of two channels (docs/FIGHT_PIPELINE.md). A peer's committed draft,
// relayed real-time over the party's webrtc transport, enters the ONE fight door as a legality-gated PREDICTION:
// it PAINTS for the eye (source 'intent' → the overlay) but NEVER touches committed truth (p2p costs LATENCY, not
// correctness); an ILLEGAL injected batch never displays and raises ONE neutral flag; and the canonical receipt/
// journal retires a matched prediction by its CLAIM (byte-match ⇒ silent, mismatch ⇒ ONE forward correction) —
// the SAME claim engine my own predictions ride, never a purge. These are the RED-FIRST proofs.

import { describe, expect, test } from 'bun:test'

import { active_store, ev, fight_object, mob, participant, ME, PEER, T0 } from '../harness/fixtures.js'

import { committed_state, presented_state } from './fold.js'
import { apply_peer_batch, drafted_batches } from './txs.js'

// encode(x,y)=y*20+x: 21=(1,1) 22=(2,1) 24=(4,1) 28=(8,1) 45=(5,2). A coop board: ME at seat 0 (cell 21), a PEER
// at seat 1 (cell 22, turn-start MP 3), one mob at cell 45. The peer authors ITS OWN turn; the store opens MY
// turn (active_store), which the courtesy gate never depends on (it reads committed positions + the refill budget).
const CELL = { p_me: 21, p_peer: 22, near: 24, far: 28, mob: 45 }
const coop_store = () =>
  active_store({
    fight: fight_object({
      participants: [participant(ME, CELL.p_me), participant(PEER, CELL.p_peer, { base_mp: 3 })],
      mobs: [mob(CELL.mob, { hp: 20 })],
    }),
  })

const peer_cell = (store, key = 'p1') => presented_state(store.getState()).fighters?.[key]?.cell
const committed_peer_cell = (store, key = 'p1') => committed_state(store.getState()).fighters?.[key]?.cell
const mob_hp = store => presented_state(store.getState()).fighters?.m0?.hp
const committed_mob_hp = store => committed_state(store.getState()).fighters?.m0?.hp

// A receipt paces its NON-LOCAL (peer) turn into a presentation wave; presented_state holds at the pre-wave floor
// until the renderer acks it. Drain the wave so a post-receipt presented read reflects the fully-played state.
const drain = store => store.getState().input({ type: 'presented', seq: store.getState().wave_seq }, T0 + 9_000)

// `peer` is the BROADCASTER (whose seat the door resolves + gates); `character` is who the Moved is authored as
// (defaults to the broadcaster). The spoof case broadcasts as PEER but authors ME's move — a cross-seat forgery.
const send_peer_move = (store, { to_cell, character = PEER, intent_id = 'peer:move' }) =>
  apply_peer_batch(store, { peer: PEER, intent_id, actions: [{ kind: 'Moved', character, to_cell }] })

// A peer cast on the mob (Cast by seat 1 at cell 45 + a Hit down to `remaining_hp`) — the composite the courtesy
// relay carries. The chain Cast event carries target_cell (fight_events.move:55), so the claim key pins it too.
const send_peer_cast = (store, { remaining_hp, intent_id = 'peer:cast' }) =>
  apply_peer_batch(store, {
    peer: PEER,
    intent_id,
    actions: [
      { kind: 'Cast', caster_is_mob: false, caster_idx: 1, target_cell: CELL.mob, damaging: true },
      { kind: 'Hit', victim_is_mob: true, victim_idx: 0, remaining_hp },
    ],
  })

// The peer's turn CONFIRMED authoritatively (Cast + the authoritative Hit) at the next version — the same claim
// vocabulary the courtesy prediction carries, so it retires by identity.
const confirm_peer_cast = (store, { remaining_hp, at = T0 + 3_000 }) =>
  store.getState().input(
    {
      type: 'receipt',
      version: store.getState().applied_version + 1,
      receipt: {
        events: [
          ev('Cast', { caster_is_mob: false, caster_idx: 1, target_cell: CELL.mob }),
          ev('Hit', { victim_is_mob: true, victim_idx: 0, amount: 20 - remaining_hp, remaining_hp }),
        ],
      },
    },
    at
  )

describe('#334 (a) — the legality gate: an illegal peer batch never paints, and is flagged', () => {
  test('a legal in-budget move pre-paints the peer — presentation only, committed truth untouched', () => {
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

describe('#334 (b) — claim retirement: a peer prediction retires on its canonical receipt, presenting ONCE', () => {
  test('a peer cast pre-paints the hit; the receipt retires it byte-equal (silent, committed adopts)', () => {
    const store = coop_store()
    expect(committed_mob_hp(store)).toBe(20)

    send_peer_cast(store, { remaining_hp: 5 })
    expect(mob_hp(store), 'the peer cast pre-paints the mob at 5').toBe(5)
    expect(committed_mob_hp(store), 'committed truth is untouched until the receipt').toBe(20)

    confirm_peer_cast(store, { remaining_hp: 5 })
    expect(committed_mob_hp(store), 'the receipt raises committed truth to the authoritative hit').toBe(5)
    expect(store.getState().divergence, 'a byte-equal claim retires SILENTLY — zero divergence toast').toBeNull()
    drain(store)
    expect(mob_hp(store), 'the confirmed value holds — presented once, no rollback').toBe(5)
  })

  test('a DIVERGENT canonical hit corrects forward: committed adopts the authoritative value', () => {
    const store = coop_store()
    send_peer_cast(store, { remaining_hp: 5 }) // the peer painted the mob at 5
    expect(mob_hp(store)).toBe(5)

    confirm_peer_cast(store, { remaining_hp: 8 }) // the chain resolved it at 8 — a same-claim mismatch
    expect(committed_mob_hp(store), 'committed truth is the AUTHORITATIVE hit, not the peer preview').toBe(8)
    expect(store.getState().divergence?.action, 'the same-claim mismatch surfaces ONE forward correction').toBe(
      'Hit:m0'
    )
    drain(store)
    expect(mob_hp(store), 'presentation corrects forward to the authoritative value').toBe(8)
  })
})

describe('#334 (c) — idempotence: a re-delivered peer batch paints once', () => {
  test('the same batch delivered twice folds once (peer dedupe)', () => {
    const store = coop_store()
    send_peer_cast(store, { remaining_hp: 8, intent_id: 'peer:turn-7' })
    const seq_after_first = store.getState().intent_seq
    expect(mob_hp(store)).toBe(8)

    send_peer_cast(store, { remaining_hp: 8, intent_id: 'peer:turn-7' }) // exact re-delivery
    expect(store.getState().intent_seq, 'the intent cursor never advances on a duplicate').toBe(seq_after_first)
    expect(mob_hp(store), 'the mob is painted once, not double-struck').toBe(8)
  })
})

describe('#334 (d) — a peer disconnect mid-turn leaves canonical truth intact', () => {
  test('courtesy never writes committed state; the canonical turn lands the same state with or without it', () => {
    const store = coop_store()
    // The peer streams a move, then goes silent (disconnects) — the courtesy paint is all the eye ever saw.
    send_peer_move(store, { to_cell: CELL.near })
    expect(peer_cell(store), 'the eye saw the courtesy move').toBe(CELL.near)
    expect(committed_peer_cell(store), 'committed truth NEVER moved on courtesy alone').toBe(CELL.p_peer)

    // The canonical turn resolves as a timeout PASS (the disconnected peer never actually committed the move).
    store.getState().input(
      {
        type: 'receipt',
        version: store.getState().applied_version + 1,
        receipt: { events: [ev('TurnEnded', { is_mob: false, idx: 1 })] },
      },
      T0 + 4_000
    )
    expect(committed_peer_cell(store), 'canonical truth is intact — the courtesy paint corrupted nothing').toBe(
      CELL.p_peer
    )
  })
})

describe('#334 — the sender read: drafted_batches carries MY drafts, never a peer relay', () => {
  test('my move + my cast are broadcast-ready (stripped, grouped by intent_id); peer courtesy is excluded', () => {
    const store = coop_store()
    // MY optimistic move (the intent door) + MY optimistic cast (the composite door) — what the eye drafts.
    store.getState().input({ type: 'intent', intent: { kind: 'move', character: ME, to_cell: CELL.near } }, T0 + 1_000)
    store.getState().input(
      {
        type: 'predicted',
        intent_id: 'mine:cast',
        basis_version: store.getState().applied_version + 1,
        actions: [
          { kind: 'Cast', caster_is_mob: false, caster_idx: 0, target_cell: CELL.mob, damaging: true },
          { kind: 'Hit', victim_is_mob: true, victim_idx: 0, remaining_hp: 12 },
        ],
      },
      T0 + 1_100
    )
    // A peer's courtesy overlay lands in the SAME entries map — it must NEVER be re-broadcast as my own draft.
    send_peer_move(store, { to_cell: CELL.near })

    const batches = drafted_batches(store)
    expect(batches.find(b => b.intent_id === 'mine:cast')?.actions.map(a => a.kind)).toEqual(['Cast', 'Hit'])
    // transport keys are the receiver's to assign — never on the wire.
    for (const batch of batches)
      for (const action of batch.actions) {
        expect(action).not.toHaveProperty('version')
        expect(action).not.toHaveProperty('source')
        expect(action).not.toHaveProperty('event_idx')
        expect(action).not.toHaveProperty('courtesy')
      }
    expect(batches.some(b => b.actions.some(a => a.kind === 'Moved' && a.character === ME))).toBe(true)
    expect(batches.some(b => b.actions.some(a => a.character === PEER)), 'a peer relay is never my draft').toBe(false)
  })
})

describe('#334 (e) — never a purge: MY turn-end never expires a peer courtesy prediction', () => {
  test('a peer courtesy cast survives my own turn-ending receipt — it retires ONLY by its own claim', () => {
    const store = coop_store()
    send_peer_cast(store, { remaining_hp: 5 })
    expect(mob_hp(store)).toBe(5)

    // MY turn ends. The blanket end-of-turn expiry is MINE — it must never purge the peer's courtesy overlay
    // (that would be the forbidden "purge on unrelated receipt"; the courtesy lane retires by claim only).
    store.getState().input(
      {
        type: 'receipt',
        version: store.getState().applied_version + 1,
        receipt: { events: [ev('TurnEnded', { is_mob: false, idx: 0 })] },
      },
      T0 + 4_000
    )
    drain(store)
    expect(mob_hp(store), 'the peer courtesy prediction is NOT purged by my turn-end').toBe(5)
  })
})
