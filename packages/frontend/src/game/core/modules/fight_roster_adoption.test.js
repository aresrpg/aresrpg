// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test } from 'bun:test'

import { create_fight_roster_adoption, resolve_fight_roster_appearances } from './fight_roster_adoption.js'

const ALICE = '0xalice'
const BOB = '0xbob'
const bob_appearance = {
  id: BOB,
  name: 'Mireth',
  classe: 'senshi',
  sex: 'female',
  male: false,
  color_1: 11,
  color_2: 22,
  color_3: 33,
}

const player = (character_id) => ({ is_player: true, character_id })
const flush = async () => {
  await Promise.resolve()
  await Promise.resolve()
}

describe('fight roster appearance adoption', () => {
  test('partner ids use the same get_sdk → read_character appearance home as the owned avatar', async () => {
    const grpc_client = {}
    const calls = []
    const appearances = await resolve_fight_roster_appearances([BOB, BOB], {
      get_sdk: async () => ({ grpc_client }),
      read_character: async (client, id) => {
        calls.push({ client, id })
        return bob_appearance
      },
    })

    expect(calls).toEqual([{ client: grpc_client, id: BOB }])
    expect(appearances.get(BOB)).toBe(bob_appearance)
  })

  test('an async partner appearance re-enters only through the roster publisher', async () => {
    let resolve_read
    const read = new Promise((resolve) => {
      resolve_read = resolve
    })
    const published = []
    let carried = []
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
    expect(published[0].find((row) => row.id === BOB)).toEqual({ id: BOB, name: BOB })

    resolve_read(new Map([[BOB, bob_appearance]]))
    await read
    await flush()

    expect(published).toHaveLength(2)
    expect(published[1].find((row) => row.id === BOB)).toBe(bob_appearance)
  })

  test('a new fight re-reads the partner and rejects the prior fight response', async () => {
    const old_appearance = { ...bob_appearance, color_1: 1 }
    const new_appearance = { ...bob_appearance, color_1: 99 }
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

    reads[1](new Map([[BOB, new_appearance]]))
    await flush()
    reads[0](new Map([[BOB, old_appearance]]))
    await flush()

    expect(carried.find((row) => row.id === BOB)).toBe(new_appearance)
  })

  test('a rejected appearance read clears pending state so a later pass retries', async () => {
    let attempts = 0
    let carried = []
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
          : Promise.resolve(new Map([[BOB, bob_appearance]]))
      },
    })

    ensure_roster()
    await flush()
    ensure_roster()
    await flush()

    expect(attempts).toBe(2)
    expect(carried.find((row) => row.id === BOB)).toBe(bob_appearance)
  })
})
