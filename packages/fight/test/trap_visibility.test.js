// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Spectator trap visibility — the public Fight.fx board entry reaches the fold as chain_traps, which the fold
// ADOPTS into the one trap ledger (#1858); the projection then crosses the viewer predicate once and decides
// whether this viewer receives a persistent board-render primitive. Paint and prediction/legality read that
// single result, so the two can no longer disagree about what exists.

import { describe, expect, test } from 'bun:test'

import { create_fight_store } from '../src/store.js'
import { engine_view } from '../src/project.js'

const FIGHT = '0xf1'
const CASTER = '0xc1'
const ALLY = '0xa1'
const ENEMY = '0xe1'
const TRAP = 108

const participant = (character, owner, team, cell) => ({
  owner,
  character,
  class: 'yajin',
  team,
  hp: 50,
  max_hp: 50,
  ap: 6,
  mp: 3,
  base_ap: 6,
  base_mp: 3,
  cell,
})

const fight_object = {
  id: FIGHT,
  status: 1,
  width: 20,
  height: 19,
  participants: [
    participant(CASTER, '0xaaa', 0, 105),
    participant(ALLY, '0xaaa', 0, 109),
    participant(ENEMY, '0xbbb', 1, 110),
  ],
  mobs: [],
  queue: [
    { is_mob: false, idx: 0 },
    { is_mob: false, idx: 1 },
    { is_mob: false, idx: 2 },
  ],
  turn_ptr: 0,
  turn_deadline_ms: 90_000,
}

// Compact output of the raw public Fight.fx CellEntry decoder: one point trap owned by caster team 0.
const chain_traps = [{ anchor: TRAP, owner_team: 0, cells: [TRAP] }]

const trap_prims_for = (ctx) => {
  const store = create_fight_store()
  store.getState().input({ type: 'init', fight_id: FIGHT, ctx })
  store.getState().input({ type: 'snapshot', fight: fight_object, version: 1, ctx: { chain_traps } }, 1_000)
  return engine_view(store.getState()).trap_prims ?? []
}

describe('trap visibility — public chain traps become viewer-scoped render prims', () => {
  test('a spectator fold renders a placed trap', () => {
    expect(trap_prims_for({ spectator: true })).toEqual([TRAP])
    expect(trap_prims_for({ my_entity_id: CASTER })).toEqual([TRAP])
    expect(trap_prims_for({ my_entity_id: ALLY })).toEqual([TRAP])
  })

  test('an enemy seat fold does not render the placed trap', () => {
    expect(trap_prims_for({ my_entity_id: ENEMY })).toEqual([])
  })
})
