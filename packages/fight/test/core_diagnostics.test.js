// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//
// A co-op client's canonical fingerprint names only shared chain truth. Arrival order, duplicate delivery and
// status-row order cannot perturb it; a missing state-changing event or roster row must.

import { describe, expect, test } from 'bun:test'

import {
  adopt_snapshot,
  admit_events,
  batch_to_actions,
  canonical_fingerprint,
  empty_core_state,
  empty_inbox,
  fight_diagnostics,
  ingest,
} from '../src/core.js'
import { input_envelope, journal_rows_received } from '../src/envelope.js'

const FIGHT = '0xf1'
const PLAYER = '0xcharacter'
const PKG = '0xpkg::fight_events::'

const participant = {
  owner: '0xowner',
  character: PLAYER,
  class: 'yajin',
  team: 0,
  hp: 50,
  max_hp: 50,
  ap: 6,
  mp: 3,
  base_ap: 6,
  base_mp: 3,
  cell: 21,
}

const mob = (cell, hp = 20) => ({
  template: '0xmob',
  level: 1,
  hp,
  max_hp: 20,
  cell,
  ap: 4,
  mp: 3,
})

const STATUSES = [
  {
    fighter: 0,
    kind: 9,
    remaining_turns: 2,
    element: 255,
    value: 2,
    stat: 6,
    chance: 100,
    source: 0,
    flags: 0,
  },
  {
    fighter: 0,
    kind: 27,
    remaining_turns: 1,
    element: 255,
    value: 0,
    stat: 0,
    chance: 100,
    source: 0,
  },
  {
    fighter: 1000,
    kind: 21,
    remaining_turns: 3,
    element: 2,
    value: 4,
    stat: 0,
    chance: 100,
    source: 1000,
  },
]

const fight_object = ({ mob_count = 2, statuses = STATUSES } = {}) => ({
  id: FIGHT,
  status: 1,
  width: 20,
  height: 19,
  participants: [participant],
  mobs: Array.from({ length: mob_count }, (_, i) => mob(40 + i)),
  queue: [{ is_mob: false, idx: 0 }, ...Array.from({ length: mob_count }, (_, idx) => ({ is_mob: true, idx }))],
  turn_ptr: 0,
  turn_deadline_ms: 90_000,
  invisibility_statuses: statuses,
})

const event = (kind, fields) => ({
  type: `${PKG}${kind}`,
  parsedJson: { fight: FIGHT, ...fields },
})

const TURN_AND_MOVE = [
  event('TurnStarted', { is_mob: false, idx: 0, deadline_ms: 90_000 }),
  event('Moved', { character: PLAYER, to_cell: 22 }),
]

const actions = (rows = TURN_AND_MOVE) =>
  batch_to_actions({ events: rows }, { version: 11, source: 'receipt', fight_id: FIGHT })

const snapshot_first = ({ rows = TURN_AND_MOVE, fight = fight_object() } = {}) => {
  const base = adopt_snapshot(empty_inbox(), fight, 10, {})
  return admit_events(base, actions(rows), 1).inbox
}

describe('canonical_fingerprint — co-op divergence detector', () => {
  test('identical chain state is identical across delivery order, duplicates, and status row order', () => {
    const reference = canonical_fingerprint(snapshot_first())

    const received_first = admit_events(empty_inbox(), [...actions()].reverse(), 1).inbox
    const duplicated = admit_events(received_first, actions(), 2).inbox
    const reordered_statuses = fight_object({ statuses: [...STATUSES].reverse() })
    const reordered = adopt_snapshot(duplicated, reordered_statuses, 10, {})
    const actual = canonical_fingerprint(reordered)

    expect(actual).toEqual(reference)
    expect(actual).toMatchObject({
      roster_count: 3,
      frontier: { version: 11, ordinal: 1 },
      turn_ordinal: 2,
      turn_anchor: { source: 'event', version: 11, event_idx: 0, owner: PLAYER },
    })
  })

  test('dropping one state-changing event changes the hash at the same anchored turn', () => {
    const complete = canonical_fingerprint(snapshot_first())
    const dropped_move = canonical_fingerprint(snapshot_first({ rows: TURN_AND_MOVE.slice(0, 1) }))

    expect(dropped_move.turn_anchor).toEqual(complete.turn_anchor)
    expect(dropped_move.hash).not.toBe(complete.hash)
  })

  test('fighter-count mismatch changes both roster count and hash', () => {
    const two_mobs = canonical_fingerprint(snapshot_first({ rows: [], fight: fight_object({ mob_count: 2 }) }))
    const one_mob = canonical_fingerprint(snapshot_first({ rows: [], fight: fight_object({ mob_count: 1 }) }))

    expect(two_mobs.turn_anchor).toEqual({
      source: 'snapshot',
      base_version: 10,
      turn_ptr: 0,
      owner: PLAYER,
    })
    expect(two_mobs.roster_count).toBe(3)
    expect(one_mob.roster_count).toBe(2)
    expect(one_mob.hash).not.toBe(two_mobs.hash)
  })

  test('the reducer accounts for fresh and duplicate deliveries with both input and event cursors', () => {
    const step = (state, payload, input_seq) =>
      ingest(state, input_envelope({ session_id: FIGHT, input_seq, observed_at_ms: input_seq, payload }))
    const snapshot = journal_rows_received({
      source: 'snapshot',
      fight_id: FIGHT,
      version: 10,
      rows: fight_object(),
      snapshot_head: '0',
    })
    const receipt = journal_rows_received({
      source: 'receipt',
      fight_id: FIGHT,
      version: 11,
      rows: { events: TURN_AND_MOVE },
    })

    let core = step(empty_core_state(FIGHT), snapshot, 0)
    core = step(core, receipt, 1)
    expect(fight_diagnostics(core).ingestion).toMatchObject({
      received: 2,
      folded: 2,
      dropped: 0,
      input_cursor: 1,
      last: {
        source: 'receipt',
        received: 2,
        folded: 2,
        dropped: 0,
        cursor: { base_version: 10, frontier: { version: 11, ordinal: 1 } },
      },
    })

    core = step(core, receipt, 2)
    expect(fight_diagnostics(core).ingestion).toMatchObject({
      received: 4,
      folded: 2,
      dropped: 2,
      input_cursor: 2,
      last: { source: 'receipt', received: 2, folded: 0, dropped: 2 },
    })
  })
})
