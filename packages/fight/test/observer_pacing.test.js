// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// OBSERVER PACING (#1649) — presentation must not depend on WHICH transport carried a peer's turn.
//
// An ACTING seat learns its own tx through the receipt; an OBSERVING seat learns the same events through the
// JOURNAL (the SSE stream / the walker's pages). The pacing seam used to gate on `msg.type === 'receipt'`, so a
// journal-fed observer got ZERO paced presentation: no cast, no damage floater, no `presenting`, no entry mask —
// the fold jumped the board and the position safety net was the only thing that moved a peer rig.
//
// This suite drives the REAL store twice over ONE logical event stream — once as a receipt, once as journal rows —
// and pins that both clients present the SAME wave. It also pins the two facts that make the journal lane possible:
//   · the wave's version + window come from the PACED ROWS (a journal batch names no chain version — classify_input
//     falls back to the batch head, which is a seq), and
//   · a batch that straddles SEVERAL chain versions is a CATCH-UP, folded without pacing (never a wave that replays
//     minutes of already-settled fight).

import { describe, expect, test } from 'bun:test'

import { create_fight_store } from '../src/store.js'
import { presenting } from '../src/project.js'
import { MOB_TURN_MS } from '../src/present.js'

const FIGHT = '0xc00p'
const ALICE = '0xchar_alice'
const BOB = '0xchar_bob'
const T0 = 2_000_000

const participant = (owner, character, cell) => ({
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
  ready: true,
  casts_this_turn: 0,
  weapon: null,
})

const fight_object = () => ({
  id: FIGHT,
  status: 1,
  width: 20,
  height: 19,
  participants: [participant('0xa11ce', ALICE, 21), participant('0xb0b', BOB, 22)],
  group_template: '0xmob_t',
  group_base_ap: 6,
  group_base_mp: 3,
  mobs: [{ template: '0xmob_t', level: 3, hp: 20, max_hp: 20, cell: 45, ap: 6, mp: 3 }],
  obstacles: [],
  holes: [],
  shape_mask: [],
  start_cells_a: [21, 22],
  start_cells_b: [],
  turn_ptr: 0,
  queue: [],
  turn_deadline_ms: T0 + 30_000,
  turn_entropy: T0 + 30_000,
  turn_ordinal: 1,
  placement_deadline_ms: 0,
  world_seed: null,
  spawn_id: null,
  last_action_ms: 0,
})

// BOB's whole turn then the mob's — the SAME logical stream both transports carry.
const STREAM = [
  ['TurnStarted', { is_mob: false, idx: 1 }],
  ['Moved', { character: BOB, to_cell: 42 }],
  ['Cast', { caster_is_mob: false, caster_idx: 1, target_cell: 45 }],
  ['Hit', { victim_is_mob: true, victim_idx: 0, amount: 8, remaining_hp: 12, caster_is_mob: false, caster_idx: 1 }],
  ['TurnEnded', { is_mob: false, idx: 1 }],
  ['TurnStarted', { is_mob: true, idx: 0 }],
  ['Cast', { caster_is_mob: true, caster_idx: 0, target_cell: 22 }],
  ['Hit', { victim_is_mob: false, victim_idx: 1, amount: 6, remaining_hp: 44, caster_is_mob: true, caster_idx: 0 }],
  ['TurnEnded', { is_mob: true, idx: 0 }],
  ['TurnStarted', { is_mob: false, idx: 0, deadline_ms: T0 + 60_000 }],
]

/** The actor's transport: one tx receipt, its object version named by the envelope. */
const receipt_input = (version) => ({
  type: 'receipt',
  fight_id: FIGHT,
  version,
  receipt: {
    events: STREAM.map(([kind, json]) => ({
      type: `0xpkg::fight_events::${kind}`,
      parsedJson: { fight: FIGHT, ...json },
    })),
  },
})

/** The observer's transport: journal rows. The envelope names NO chain version — every row carries its own. */
const journal_input = (rows, { first_seq = 10 } = {}) => ({
  type: 'journal',
  fight_id: FIGHT,
  page: {
    fight: FIGHT,
    events: rows.map(([kind, json, version], index) => ({
      seq: String(first_seq + index),
      kind,
      data: { fight: FIGHT, ...json },
      digest: '0xdig',
      version: String(version),
    })),
    journal_head: String(first_seq + rows.length - 1),
  },
})

/** ALICE's client (seat p0), bootstrapped on the opening object read at version 2. */
const alice_store = () => {
  const store = create_fight_store()
  store
    .getState()
    .input(
      { type: 'init', fight_id: FIGHT, ctx: { my_entity_id: ALICE, address: '0xa11ce', beat_ctx: { grid_width: 20 } } },
      T0
    )
  store.getState().input({ type: 'snapshot', fight: fight_object(), version: 2 }, T0 + 50)
  return store
}

/** The presentation facts a viewer can actually SEE, transport-independent by construction. */
const wave_shape = (store) =>
  store.getState().wave.map((turn) => ({
    source_id: String(turn.source_id),
    is_local: turn.is_local,
    version: turn.version,
    duration: turn.duration,
    from_idx: turn.from_idx,
    until_idx: turn.until_idx,
    beats: turn.beats.map((beat) => [beat.kind, beat.payload?.damage ?? null]),
  }))

describe('observer pacing — a journal-fed seat presents exactly what a receipt-fed seat presents', () => {
  test('a peer turn delivered as JOURNAL rows paces the same wave the receipt lane paces', () => {
    const actor = alice_store()
    const observer = alice_store()
    actor.getState().input(receipt_input(3), T0 + 500)
    observer.getState().input(journal_input(STREAM.map(([kind, json]) => [kind, json, 3])), T0 + 500)

    // ZERO paced presentation was the bug: no cast, no floater, no presenting state.
    expect(presenting(observer.getState()), 'a journal-fed peer turn must present').toBe(true)
    const remote = observer.getState().wave.filter((turn) => !turn.is_local)
    expect(remote.map((turn) => String(turn.source_id))).toEqual([BOB, 'mob-0'])
    const [bob_turn] = remote
    expect(bob_turn.duration).toBe(MOB_TURN_MS) // the SAME 3s slot the receipt lane gives a peer
    const kinds = bob_turn.beats.map((beat) => beat.kind)
    expect(kinds).toContain('move')
    expect(kinds).toContain('cast')
    expect(kinds).toContain('damage')
    expect(bob_turn.beats.find((beat) => beat.kind === 'damage').payload.damage).toBe(8)

    // …and it is the SAME wave, beat for beat and window for window, as the actor's receipt-fed one.
    expect(wave_shape(observer)).toEqual(wave_shape(actor))
  })

  test('the wave version and its entry window come from the ROWS, never from the transport envelope', () => {
    const observer = alice_store()
    // The journal door message carries no `version` at all — only the rows do.
    observer.getState().input(journal_input(STREAM.map(([kind, json]) => [kind, json, 3])), T0 + 500)
    const bob_turn = observer.getState().wave.find((turn) => String(turn.source_id) === BOB)
    expect(bob_turn.version).toBe(3)
    // The window is the turn's own ordinal span inside version 3 (seqs 10..14 ⇒ ordinals 0..4).
    expect(bob_turn.from_idx).toBe(0)
    expect(bob_turn.until_idx).toBe(4)
    // The mask holds the peer at his pre-move cell until his walk presents — the whole point of the window.
    expect(observer.getState().entries[`3:1`]?.kind).toBe('Moved')
  })

  test('a CATCH-UP batch (several chain versions in one delivery) folds without pacing', () => {
    const observer = alice_store()
    // The walker's gap page: BOB's turn at v3 and the mob's at v4 — minutes of already-settled fight.
    observer
      .getState()
      .input(
        journal_input([
          ...STREAM.slice(0, 5).map(([kind, json]) => [kind, json, 3]),
          ...STREAM.slice(5).map(([kind, json]) => [kind, json, 4]),
        ]),
        T0 + 500
      )
    expect(observer.getState().wave, 'a multi-version catch-up replays nothing').toEqual([])
    expect(presenting(observer.getState())).toBe(false)
    // …but it FOLDS: committed truth carries the whole page.
    expect(observer.getState().applied_version).toBe(4)
  })
})
