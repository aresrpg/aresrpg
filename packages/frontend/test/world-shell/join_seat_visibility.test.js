// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #2154 — the joiner's own seat took a full 4s store heartbeat to appear (measured 4.141/4.179/4.145s: a 38ms
// spread is a timer, not a chain). RED-first, for the reported reason: the post-join convergence walk exited
// SUCCESSFULLY on a read whose roster does not contain the joiner, so the seat rode the next poll tick.
//
// The two doors that had to move together are both driven here — the walk's exit predicate AND the store's
// `fight_syncing` receipt-hold chip. Fixing only the predicate would have swapped a premature 'hydrated' for a
// premature 'cancelled' and changed nothing a player can see, which is why both are asserted in one file.

import { describe, expect, test } from 'bun:test'

import { my_seat_present, poll_receipt_fight } from '../../src/world-shell/world_fight_receipt.js'

const FIGHT = '0xfight'
const ME = '0xme'
const SOMEONE_ELSE = '0xcreator'

/** The board view the projector publishes into `use_dungeon`'s `dungeon` — only the roster matters here. */
const board = (...character_ids) => ({ id: FIGHT, escrow: character_ids.map((character) => ({ character })) })

/**
 * A store double with the exact two facts the walk reads, plus the ONE behaviour the real store has that made
 * this bug: `refresh` clears the receipt-hold chip the moment ANY board is readable (dungeon_run_store.js's
 * `set({ error: null, fight_syncing: ... })`). The reads are scripted, oldest first.
 */
const store_double = (reads) => {
  const state = { fight_id: FIGHT, fight_fresh: true, fight_syncing: true, character_id: ME, dungeon: null }
  let index = 0
  return {
    get_state: () => state,
    reads_performed: () => index,
    refresh: async () => {
      const view = reads[Math.min(index, reads.length - 1)]
      index += 1
      state.dungeon = view
      // The production clear, verbatim in shape: never RAISED, and released only once my seat is in the read.
      state.fight_syncing = state.fight_syncing && !my_seat_present(view, state.character_id)
    },
  }
}

describe('#2154 — the post-join predicate is "my seat is present in the read"', () => {
  test('RED: a readable board without my seat is not convergence', () => {
    // The exact read that logs `my_entity_missing_from_fighters`: the document is there, the joiner is not.
    expect(my_seat_present(board(SOMEONE_ELSE), ME)).toBe(false)
    expect(my_seat_present(board(SOMEONE_ELSE, ME), ME)).toBe(true)
  })

  test('a session holding no seat of its own (spectator) converges on any readable board', () => {
    expect(my_seat_present(board(SOMEONE_ELSE), null)).toBe(true)
    expect(my_seat_present(null, null)).toBe(false)
  })

  test('keeps reading past the pre-join read and hydrates on the read that contains me — no poll wait', async () => {
    // Read 1 is the join's read-after-write served at the PRE-JOIN version; read 2 carries the seat.
    const store = store_double([board(SOMEONE_ELSE), board(SOMEONE_ELSE, ME)])
    const slept = []
    const outcome = await poll_receipt_fight({
      fight_id: FIGHT,
      character_id: ME,
      get_state: store.get_state,
      refresh: store.refresh,
      sleep: async (ms) => void slept.push(ms),
    })
    expect(outcome).toBe('hydrated')
    expect(store.reads_performed()).toBe(2)
    // The tight backoff — never the 4s store heartbeat — is what covered the gap.
    expect(slept).toEqual([250])
    expect(store.get_state().fight_syncing).toBe(false)
  })

  test('a joiner whose seat is in the very first read pays nothing at all', async () => {
    const store = store_double([board(SOMEONE_ELSE, ME)])
    const slept = []
    const outcome = await poll_receipt_fight({
      fight_id: FIGHT,
      character_id: ME,
      get_state: store.get_state,
      refresh: store.refresh,
      sleep: async (ms) => void slept.push(ms),
    })
    expect(outcome).toBe('hydrated')
    expect(store.reads_performed()).toBe(1)
    expect(slept).toEqual([])
  })

  test('still stops when the session is replaced under it (never an unbounded walk)', async () => {
    const store = store_double([board(SOMEONE_ELSE)])
    const outcome = await poll_receipt_fight({
      fight_id: FIGHT,
      character_id: ME,
      get_state: store.get_state,
      refresh: async () => {
        await store.refresh()
        store.get_state().fight_id = '0xanother' // a different session took the store
      },
      sleep: async () => {},
    })
    expect(outcome).toBe('cancelled')
    expect(store.reads_performed()).toBe(1)
  })

  test('gives up at its own wait ceiling rather than re-reading forever', async () => {
    const store = store_double([board(SOMEONE_ELSE)])
    let clock = 0
    const outcome = await poll_receipt_fight({
      fight_id: FIGHT,
      character_id: ME,
      get_state: store.get_state,
      refresh: store.refresh,
      sleep: async (ms) => void (clock += ms),
      now: () => clock,
      max_wait_ms: 1000,
    })
    expect(outcome).toBe('timed_out')
  })
})
