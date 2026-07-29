// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #1323 — THE WIRE SEAM. The seat's authored weapon lines live in per-seat DYNAMIC FIELDS on the Fight, so they
// are absent from the object json the 4s poll decodes. Two things have to hold or the preview silently keeps
// pricing every strike off the family line:
//
//   1. the sync leg ATTACHES the seat-keyed map onto the decoded fight under the name `board_state` reads
//      (`weapon_lines`) — a rename on either side is a wire that dies without a single failing assertion;
//   2. the resolver READS ONCE per fight and re-reads only when the roster GREW, because these lines are
//      immutable for a seat's lifetime and the poll runs every 4 seconds.
//
// Driven through the real modules with a stubbed gRPC client — the decode/attach is what is measured, not a node.

import { describe, test, expect, mock, beforeEach } from 'bun:test'

const listDynamicFields = mock(async () => ({ dynamicFields: [], hasNextPage: false, cursor: null }))
const getObjects = mock(async ({ objectIds }) => ({
  objects: objectIds.map(() => ({
    json: { name: { seat: '0' }, value: [{ element: 0, damage: '10', damage_max: '20' }] },
  })),
}))

const sdk = { grpc_client: { core: { listDynamicFields, getObjects } } }

const KEY_TYPE = '0xengine::fight::WeaponLinesKey'

const { resolve_weapon_lines, sync_dungeon_fight } = await import('./dungeon_fight_sync.js')
const { fight_store } = await import('@aresrpg/fight/store')

/** A Fight object read shaped like the poll's own: one seat, geometry complete (the adoption gate). */
const read_of = (participants) => ({
  version: 1,
  json: {
    id: '0xfight_lines',
    status: 1,
    participants,
    mobs: [],
    board: { width: 15, height: 17, shape_mask: [], obstacles: [], holes: [], start_cells_a: [], start_cells_b: [] },
  },
})

const SEAT = { owner: '0xme', character: '0xchar', team: 0, hp: '30', max_hp: '30', cell: 0 }

beforeEach(() => {
  listDynamicFields.mockClear()
  getObjects.mockClear()
  // `fight_store` is a process-wide singleton, so this file inherits whatever session the previously
  // executed file left in it. A chain input for a DIFFERENT fight is refused outright by the
  // provenance gate (store.js `refuse_reason`), so the sync below would attach nothing and the
  // escrow assertion would read undefined — a red that depends only on file order. `init` is a
  // control signal that always passes that gate: it opens a fresh session for THIS fight.
  fight_store.getState().input({ type: 'init', fight_id: '0xfight_lines', my_key: SEAT.character, ctx: {} })
})

describe('#1323 — the authored weapon lines reach the fight record the preview reads', () => {
  test('sync attaches the seat-keyed map under the name board_state reads', () => {
    const fight = sync_dungeon_fight({
      read: read_of([SEAT]),
      weapon_lines: { 0: [{ element: 0, damage: 10, damage_max: 20, crit_damage: 15, crit_damage_max: 30 }] },
    })
    // The field name IS the contract with @aresrpg/fight/board_state — assert it by name, not by shape.
    expect(fight.weapon_lines[0]).toEqual([
      { element: 0, damage: 10, damage_max: 20, crit_damage: 15, crit_damage_max: 30 },
    ])
    // …and the view the core adopted carries the lines onto the seat's weapon, which is what every preview prices from.
    expect(fight_store.getState().view?.escrow?.[0]?.weapon?.lines).toEqual([
      { element: 0, damage: 10, damage_max: 20, crit_damage: 15, crit_damage_max: 30 },
    ])
  })

  test('a fight with no lines still syncs — every seat honestly falls back to its family line', () => {
    const fight = sync_dungeon_fight({ read: read_of([SEAT]) })
    expect(fight.weapon_lines).toEqual({})
  })

  test('the resolver reads ONCE per fight and re-reads only when the roster grew', async () => {
    listDynamicFields.mockImplementation(async () => ({
      dynamicFields: [{ name: { type: KEY_TYPE }, fieldId: '0xfield' }],
      hasNextPage: false,
      cursor: null,
    }))

    const first = await resolve_weapon_lines(sdk, '0xfight_cache', 1)
    expect(first[0]).toEqual([{ element: 0, damage: 10, damage_max: 20, crit_damage: 10, crit_damage_max: 10 }])
    expect(listDynamicFields).toHaveBeenCalledTimes(1)

    // the 4s poll, over and over: the lines are immutable for a seat's lifetime, so this must not hit the node
    await resolve_weapon_lines(sdk, '0xfight_cache', 1)
    await resolve_weapon_lines(sdk, '0xfight_cache', 1)
    expect(listDynamicFields).toHaveBeenCalledTimes(1)

    // a JOINER seats new lines — the roster grew, so the cached map is now incomplete and must be re-read
    await resolve_weapon_lines(sdk, '0xfight_cache', 2)
    expect(listDynamicFields).toHaveBeenCalledTimes(2)
  })

  test('an empty roster never reads — nothing is seated yet', async () => {
    expect(await resolve_weapon_lines(sdk, '0xfight_empty', 0)).toEqual({})
    expect(listDynamicFields).not.toHaveBeenCalled()
  })
})
