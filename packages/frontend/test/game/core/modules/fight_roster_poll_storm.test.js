// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #2200 — THE 4Hz FULLNODE POLL. The fight clock (world-shell/fight_core_clock.js) feeds the core a tick every
// 250ms for a bound fight's entire lifetime, and the roster adopter runs inside every fold. Two independent
// paths turned that clock into unbounded chain traffic:
//
//   1. A failed resolve was FORGOTTEN by deleting the id, so the next fold saw it missing again — one read per
//      unresolved fighter per tick, forever (and each one was a DIRECT public-fullnode call: the second
//      ingestion door this fix also deletes — see fight_roster_adoption.js's header).
//   2. The SIMULATOR (a `sim:` session — fight_session_scope.js) has no chain at all: its seats are local ids
//      that can never resolve, so path 1 ran at full rate on a chain-free surface.
//
// Both are pinned here by COUNTING the reads over a clock's worth of folds — a verdict a passing render can't
// fake. Every number below is a real read the game used to fire.

import { describe, expect, test } from 'bun:test'

import {
  create_fight_roster_adoption,
  resolve_roster_appearances_in_scope,
} from '../../../../src/game/core/modules/fight_roster_adoption.js'
import { CHARACTER_READ_TTL_MS } from '../../../../src/world-shell/character_name_resolve.js'

const ALICE = '0xalice'
const BOB = '0xbob'

const player = (character_id) => ({ is_player: true, character_id })
const flush = async () => {
  await Promise.resolve()
  await Promise.resolve()
}

/** One fight clock's worth of folds — `FIGHT_CLOCK_MS` 250ms × 40 = 10 seconds of a real fight. */
const TICKS = 40

/**
 * The production wiring (game/core/modules/fight.js `sync`): the adopter runs on every notification, and its
 * read half is the SHIPPED scoped resolver — only the state read and the `/v1` batch are seamed, so the gate
 * under test is the one the game runs.
 */
const mount = ({ fight_id, clock }) => {
  const reads = /** @type {{ids:string[]}[]} */ ([])
  let carried = /** @type {any[]} */ ([])
  const ensure_roster = create_fight_roster_adoption({
    get_mine: () => [{ id: ALICE, name: 'Kaelen' }],
    get_fighters: () =>
      new Map([
        [ALICE, player(ALICE)],
        [BOB, player(BOB)],
      ]),
    get_session_key: () => `0:${fight_id}`,
    get_carried: () => carried,
    publish: (rows) => {
      carried = rows
    },
    resolve_characters: (ids) =>
      resolve_roster_appearances_in_scope(ids, {
        get_fight_state: () => ({ fight_id }),
        // Every `/v1` read that leaves the adopter lands here. BOB never resolves: the simulator seat exists in
        // no index at all, and for the chain fight this is the not-yet-snapshotted / read-outage case.
        fetch_characters: async (query) => {
          reads.push(query)
          return []
        },
      }),
    now: () => clock.ms,
  })
  return { ensure_roster, reads }
}

describe('#2200 the fight clock never turns into a chain poll', () => {
  test('a sim-scoped fight drives ZERO chain reads across a clock of folds', async () => {
    const clock = { ms: 1_000 }
    const { ensure_roster, reads } = mount({ fight_id: 'sim:sandbox', clock })

    for (let tick = 0; tick < TICKS; tick += 1) {
      ensure_roster()
      await flush()
      clock.ms += 250
    }

    expect(reads).toEqual([])
  })

  test('a chain fight resolves its unresolved seat ONCE per retry window, not once per fold', async () => {
    const clock = { ms: 1_000 }
    // Positive control on the same wiring: this scope DOES read — the assertion above measures a gate, not a
    // resolver that silently stopped working.
    const { ensure_roster, reads } = mount({ fight_id: '0xchainfight', clock })

    for (let tick = 0; tick < TICKS; tick += 1) {
      ensure_roster()
      await flush()
      clock.ms += 250
    }

    expect(reads).toEqual([{ ids: [BOB] }])

    // The window is a floor, never a wall: once it passes, the seat is asked again — a fighter whose read failed
    // during an outage still heals.
    clock.ms += CHARACTER_READ_TTL_MS
    ensure_roster()
    await flush()

    expect(reads).toEqual([{ ids: [BOB] }, { ids: [BOB] }])
  })
})
