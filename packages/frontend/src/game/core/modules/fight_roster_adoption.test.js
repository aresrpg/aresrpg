// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test } from 'bun:test'

import { create_fight_roster_adoption, resolve_roster_appearances } from './fight_roster_adoption.js'

const ALICE = '0xalice'
const BOB = '0xbob'
/** A `/v1/characters` row, verbatim wire shape (packages/rpc/api/views.js): `class`, nested `colors`, `male`. */
const bob_doc = {
  id: BOB,
  name: 'Mireth',
  class: 'senshi',
  male: false,
  colors: { color_1: 11, color_2: 22, color_3: 33 },
  level: 1,
  experience: 0,
}

const player = (character_id) => ({ is_player: true, character_id })
const flush = async () => {
  await Promise.resolve()
  await Promise.resolve()
}

describe('fight roster appearance adoption', () => {
  test('partner ids resolve through OUR /v1 door, never a fullnode client', async () => {
    const queries = []
    const appearances = await resolve_roster_appearances([BOB, BOB], {
      fetch_characters: async (query) => {
        queries.push(query)
        return [bob_doc]
      },
    })

    // The only read that can leave this module is a `/v1/characters?ids=` query — ONE batch for the whole
    // missing set (character_name_resolve.js's resolve_character_docs, which also dedupes the repeated id).
    // The `get_sdk` → `read_character` fullnode route this test used to pin no longer exists here.
    expect(queries).toEqual([{ ids: [BOB] }])
    expect(appearances.get(BOB)).toBe(bob_doc)
  })

  test('an async partner appearance re-enters only through the roster publisher', async () => {
    let resolve_read
    const read = new Promise((resolve) => {
      resolve_read = resolve
    })
    const published = []
    let carried = [{ id: BOB, name: 'Mireth', level: 42, experience: 123_456 }]
    const ensure_roster = create_fight_roster_adoption({
      get_mine: () => [{ id: ALICE, name: 'Kaelen' }],
      get_fighters: () =>
        new Map([
          [ALICE, player(ALICE)],
          [BOB, player(BOB)],
        ]),
      get_session_key: () => 'fight-a:1',
      get_carried: () => carried,
      publish: (rows) => {
        carried = rows
        published.push(rows)
      },
      resolve_characters: () => read,
    })

    ensure_roster()
    expect(published).toHaveLength(1)
    expect(published[0].find((row) => row.id === BOB)).toMatchObject({
      id: BOB,
      name: 'Mireth',
      level: 42,
      experience: 123_456,
    })

    resolve_read(new Map([[BOB, bob_doc]]))
    await read
    await flush()

    expect(published).toHaveLength(2)
    // The carried row's progression survives; identity/appearance arrive in the wire's own shape.
    expect(published[1].find((row) => row.id === BOB)).toMatchObject({
      id: BOB,
      name: 'Mireth',
      level: 42,
      experience: 123_456,
      male: false,
      class: 'senshi',
      colors: { color_1: 11, color_2: 22, color_3: 33 },
    })
  })

  test('a new fight re-reads the partner and rejects the prior fight response', async () => {
    const old_doc = { ...bob_doc, colors: { color_1: 1, color_2: 22, color_3: 33 } }
    const new_doc = { ...bob_doc, colors: { color_1: 99, color_2: 22, color_3: 33 } }
    const reads = []
    let session_key = 'fight-a:1'
    let carried = []
    const ensure_roster = create_fight_roster_adoption({
      get_mine: () => [{ id: ALICE, name: 'Kaelen' }],
      get_fighters: () =>
        new Map([
          [ALICE, player(ALICE)],
          [BOB, player(BOB)],
        ]),
      get_session_key: () => session_key,
      get_carried: () => carried,
      publish: (rows) => {
        carried = rows
      },
      resolve_characters: () =>
        new Promise((resolve) => {
          reads.push(resolve)
        }),
    })

    ensure_roster()
    session_key = 'fight-b:2'
    carried = []
    ensure_roster()
    expect(reads).toHaveLength(2)

    reads[1](new Map([[BOB, new_doc]]))
    await flush()
    reads[0](new Map([[BOB, old_doc]]))
    await flush()

    expect(carried.find((row) => row.id === BOB)).toMatchObject({
      id: BOB,
      colors: new_doc.colors,
    })
  })

  test('a rejected read is retried once its window passes, never on the next fold', async () => {
    let attempts = 0
    let carried = []
    const clock = { ms: 5_000 }
    const ensure_roster = create_fight_roster_adoption({
      get_mine: () => [{ id: ALICE, name: 'Kaelen' }],
      get_fighters: () =>
        new Map([
          [ALICE, player(ALICE)],
          [BOB, player(BOB)],
        ]),
      get_session_key: () => 'fight-a:1',
      get_carried: () => carried,
      publish: (rows) => {
        carried = rows
      },
      resolve_characters: () => {
        attempts += 1
        return attempts === 1
          ? Promise.reject(new Error('temporary read failure'))
          : Promise.resolve(new Map([[BOB, bob_doc]]))
      },
      now: () => clock.ms,
    })

    ensure_roster()
    await flush()
    // The very next fold is 250ms later (the fight clock) — a failure that re-asks here is the #2200 storm.
    clock.ms += 250
    ensure_roster()
    await flush()
    expect(attempts).toBe(1)

    clock.ms += 60_000
    ensure_roster()
    await flush()

    expect(attempts).toBe(2)
    expect(carried.find((row) => row.id === BOB)).toMatchObject({
      id: BOB,
      colors: bob_doc.colors,
    })
  })
})
