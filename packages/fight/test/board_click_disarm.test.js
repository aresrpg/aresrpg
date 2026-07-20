// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// SPELL DESELECT IS A CORE RULE: clicking any non-targetable cell with a spell armed deselects it. The
// decision moves OFF the HUD (DungeonBoard used an arm-toggle — fragile, and off-board
// clicks never even reached it) into the ONE state atom: a `board_click` input carries the click cell (null =
// off-board) and the edge's `targetable` verdict (the castable set needs the frontend seed row — an edge input
// by the same doctrine as move_wash's `targeting`). The rule: armed ∧ ¬targetable ⇒ disarm. Nothing else —
// no cast is ever emitted by the core (drafting stays the adapter's), no entry is added to the log.

import { describe, expect, test } from 'bun:test'

import { create_fight_store } from '../src/store.js'

const FIGHT = '0xf1'
const CHAR = '0xc1'

const fight_object = () => ({
  id: FIGHT,
  status: 1,
  width: 20,
  height: 19,
  participants: [
    {
      owner: '0xaaa',
      character: CHAR,
      class: 'senshi',
      team: 0,
      ap: 6,
      mp: 3,
      base_ap: 6,
      base_mp: 3,
      hp: 50,
      max_hp: 50,
      cell: 45,
      stats: { agility: 40 },
    },
  ],
  mobs: [{ template: '0xabc', hp: 30, max_hp: 30, cell: 210, ap: 4, mp: 3, level: 1, stats: { agility: 40 } }],
  queue: [
    { is_mob: false, idx: 0 },
    { is_mob: true, idx: 0 },
  ],
  turn_ptr: 0,
  turn_deadline_ms: 90_000,
})

const boot_armed = () => {
  const store = create_fight_store()
  store.getState().input({ type: 'init', fight_id: FIGHT, ctx: { my_entity_id: CHAR } }, 1000)
  store.getState().input({ type: 'snapshot', fight: fight_object(), version: 5 }, 1000)
  store.getState().input({ type: 'arm', spell_id: 'fireball' }, 1001)
  expect(store.getState().armed_spell_id).toBe('fireball')
  return store
}

describe('board_click — the armed-spell deselect rule lives in the core', () => {
  test('armed + a NON-targetable cell click disarms, and emits nothing (no log entry, no stage)', () => {
    const store = boot_armed()
    const { log, staged } = store.getState()
    store.getState().input({ type: 'board_click', cell: 47, targetable: false }, 1002)
    const s = store.getState()
    expect(s.armed_spell_id).toBe(null)
    expect(s.log.length).toBe(log.length) // no cast emitted
    expect(s.staged).toEqual(staged)
  })

  test('armed + an OFF-BOARD click (cell null) disarms too', () => {
    const store = boot_armed()
    store.getState().input({ type: 'board_click', cell: null, targetable: false }, 1002)
    expect(store.getState().armed_spell_id).toBe(null)
  })

  test('armed + a TARGETABLE cell click keeps the spell armed until the cast enqueue succeeds, then disarms', () => {
    const store = boot_armed()
    store.getState().input({ type: 'board_click', cell: 46, targetable: true }, 1002)
    expect(store.getState().armed_spell_id).toBe('fireball')

    store
      .getState()
      .input({ type: 'intent', intent: { kind: 'cast', target_cell: 46, damaging: true, ap_cost: 2 } }, 1003)

    expect(store.getState().log.at(-1)?.kind).toBe('Cast')
    expect(store.getState().armed_spell_id).toBeNull()
  })

  test('unarmed: board_click is a pure no-op either way (never arms, never errors)', () => {
    const store = boot_armed()
    store.getState().input({ type: 'arm', spell_id: 'fireball' }, 1002) // toggle off
    expect(store.getState().armed_spell_id).toBe(null)
    store.getState().input({ type: 'board_click', cell: 46, targetable: true }, 1003)
    expect(store.getState().armed_spell_id).toBe(null)
    store.getState().input({ type: 'board_click', cell: 46, targetable: false }, 1004)
    expect(store.getState().armed_spell_id).toBe(null)
    expect(store.getState().error).toBe(null)
  })
})
