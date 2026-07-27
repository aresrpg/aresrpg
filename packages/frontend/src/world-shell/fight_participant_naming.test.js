// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// RED-FIRST (#929) — turn cards rendered RAW ADDRESSES instead of names, twice over:
//   · coop: the remote participant's wallet on every row of the other client,
//   · simulator: `0X51M0…0000` on EVERY player row — the sim chain's ONE mock owner, shared by all seats.
// Both are the same defect: `engine_view`'s last-ditch fallback is the participant's OWNER ADDRESS, and the
// only thing keeping it off screen is a ctx.roster row keyed by the CHARACTER id. fight.js used to REPLACE
// ctx.roster with `sui.characters` alone, so any seat outside my own kiosk roster — a coop remote, every
// simulator seat the shim had just seeded — lost its row on the next recompose and printed its owner.
// These drive the REAL fight core (create_fight_store + the snapshot door) and assert through the REAL
// projection every HUD turn card reads (engine_view.fighters[].name).

import { describe, test, expect } from 'bun:test'
import { create_fight_store } from '@aresrpg/fight/store'
import * as project from '@aresrpg/fight/project'

import { compose_fight_roster, fight_roster_signature, short_fighter_id } from './character_name_resolve.js'

const FIGHT_ID = '0xnaming-fight'
/** The simulator's shape: every seat is owned by the SAME mock address (fight/sim_chain LOCAL_ADDRESS). */
const ONE_OWNER = '0x51m00000000000000000000000000000000000000000000000000000000000'

const seat = (character, cell, owner = ONE_OWNER) => ({
  owner,
  character,
  class: 'senshi',
  team: 0,
  hp: 40,
  max_hp: 40,
  ap: 6,
  mp: 3,
  base_ap: 6,
  base_mp: 3,
  cell,
  ready: true,
  casts_this_turn: 0,
})

const decoded_fight = (participants) => ({
  id: FIGHT_ID,
  width: 20,
  height: 19,
  status: 1,
  participants,
  mobs: [{ level: 1, hp: 20, max_hp: 20, cell: 25, ap: 4, mp: 3 }],
  group_template: '0xgroup',
  group_base_ap: 4,
  group_base_mp: 3,
  obstacles: [],
  holes: [],
  start_cells_a: [20, 21],
  start_cells_b: [25],
  queue: [
    { is_mob: false, idx: 0 },
    { is_mob: false, idx: 1 },
    { is_mob: true, idx: 0 },
  ],
  turn_ptr: 0,
  turn_deadline_ms: 5000,
  placement_deadline_ms: 0,
  world_seed: 1,
  spawn_id: 1,
  anchor_x: 0,
  anchor_z: 0,
  shape_mask: [],
  invisibility_statuses: [],
})

/** A live two-seat fight, opened exactly like the simulator shim opens one: ctx.roster seeded at init. */
const open_fight = (roster) => {
  const store = create_fight_store()
  store.getState().input({
    type: 'init',
    fight_id: FIGHT_ID,
    my_key: null,
    ctx: { address: ONE_OWNER, roster, my_entity_id: 'sim_c1', spectator: false },
  })
  store.getState().input({
    type: 'snapshot',
    fight: decoded_fight([seat('sim_c1', 20), seat('sim_c2', 21)]),
    version: 1,
  })
  return store
}

const names_of = (store) => {
  const view = project.engine_view_of(store.getState())
  return [...view.fighters.values()].filter((f) => f.is_player).map((f) => f.name)
}

describe('#929 — turn-card names key off the CHARACTER, never the owner address', () => {
  test('the seeded seat names survive a recompose driven by a roster that does not contain them', () => {
    const seeded = [
      { id: 'sim_c1', name: 'Kaelen', classe: 'senshi', level: 1 },
      { id: 'sim_c2', name: 'Mireth', classe: 'iyashi', level: 1 },
    ]
    const store = open_fight(seeded)
    expect(names_of(store)).toEqual(['Kaelen', 'Mireth'])

    // The recompose fight.js runs on every core input: my WORLD kiosk roster (which never contains a sim seat)
    // plus whatever /v1 resolved (nothing — a sim seat is not an indexed character). The old composition was
    // exactly `mine`, which is what wiped both names.
    const view = project.engine_view_of(store.getState())
    const rows = compose_fight_roster({
      mine: [{ id: '0xreal-world-character', name: 'MyRealAlt' }],
      resolved: [],
      carried: store.getState().ctx?.roster ?? [],
      fighters: view.fighters,
    })
    store.getState().input({ type: 'ctx', ctx: { roster: rows } })

    expect(names_of(store)).toEqual(['Kaelen', 'Mireth'])
    // and never the shared mock owner — the exact string the served build printed on every player row
    expect(names_of(store).some((name) => name.toLowerCase().startsWith('0x51m0'))).toBe(false)
  })

  test('an unresolved coop remote falls back to its short CHARACTER id, never to the joiner wallet', () => {
    const store = open_fight([{ id: 'sim_c1', name: 'Kaelen' }])
    const remote_id = '0xb4951111222233334444555566667777888899990000aaaabbbbccccd177'
    const view = project.engine_view_of(store.getState())
    const rows = compose_fight_roster({
      mine: [],
      resolved: [], // the /v1 read has not landed (or the doc is genuinely unindexed)
      carried: store.getState().ctx?.roster ?? [],
      fighters: new Map([
        ...view.fighters,
        ['sim_c2', { is_player: true, character_id: 'sim_c2' }], // the remote seat, no doc yet
      ]),
    })
    store.getState().input({ type: 'ctx', ctx: { roster: rows } })

    const [, remote] = names_of(store)
    expect(remote).toBe(short_fighter_id('sim_c2'))
    expect(remote).not.toContain('0x51m0')
    expect(remote).not.toContain(remote_id.slice(0, 6))
  })

  test('a resolved /v1 doc wins over the provisional row, and my own kiosk row wins over both', () => {
    const rows = compose_fight_roster({
      mine: [{ id: 'c_mine', name: 'MineFresh' }],
      resolved: [
        { id: 'c_mine', name: 'MineStale' },
        { id: 'c_remote', name: 'RemoteReal' },
      ],
      carried: [{ id: 'c_remote', name: short_fighter_id('c_remote') }],
      fighters: new Map([
        ['c_mine', { is_player: true, character_id: 'c_mine' }],
        ['c_remote', { is_player: true, character_id: 'c_remote' }],
        ['mob-0', { is_player: false, character_id: null }],
      ]),
    })
    expect(rows.find((row) => row.id === 'c_mine')?.name).toBe('MineFresh')
    expect(rows.find((row) => row.id === 'c_remote')?.name).toBe('RemoteReal')
    expect(rows.some((row) => row.id === 'mob-0')).toBe(false) // mobs name off mob_names, never the roster
  })

  test('every player fighter gets a row — the owner-address fallback has no precondition left', () => {
    const fighters = new Map([
      ['a', { is_player: true, character_id: 'a' }],
      ['b', { is_player: true, character_id: 'b' }],
    ])
    const rows = compose_fight_roster({ fighters })
    expect(rows.map((row) => row.id).sort()).toEqual(['a', 'b'])
  })
})

describe('coop roster appearance adoption', () => {
  test('the normalized custody/display row carries into the partner roster entry and projection', () => {
    const colors = [0xc58b6a, 0x375a7f, 0xd6b36a]
    const appearance = {
      id: 'sim_c2',
      name: 'Mireth',
      classe: 'senshi',
      sex: 'female',
      male: false,
      color_1: colors[0],
      color_2: colors[1],
      color_3: colors[2],
    }
    const store = open_fight([
      { id: 'sim_c1', name: 'Kaelen' },
      { id: appearance.id, name: appearance.name },
    ])
    const prior_rows = store.getState().ctx?.roster ?? []
    const enriched_rows = compose_fight_roster({
      mine: [],
      resolved: [appearance],
      carried: prior_rows,
      fighters: project.engine_view_of(store.getState()).fighters,
    })

    // The production publication gate: name resolution has already produced the same name, so only appearance
    // changes. Before this regression fix both signatures were identical and the richer row never re-entered.
    if (fight_roster_signature(enriched_rows) !== fight_roster_signature(prior_rows))
      store.getState().input({ type: 'ctx', ctx: { roster: enriched_rows } })

    expect(store.getState().ctx?.roster?.find((row) => row.id === appearance.id)).toMatchObject(appearance)
    expect(project.engine_view_of(store.getState()).fighters.get(appearance.id)).toMatchObject({
      class_id: 'senshi',
      sex: 'female',
      male: false,
      colors,
    })
  })

  test('appearance-only enrichment invalidates the roster publication signature', () => {
    const thin = [{ id: 'sim_c2', name: 'Mireth' }]
    const enriched = [{ ...thin[0], male: false, color_1: 11, color_2: 22, color_3: 33 }]

    expect(fight_roster_signature(enriched)).not.toBe(fight_roster_signature(thin))
  })
})
