// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #11 — OWN-CAST TELEPORT PREDICTS THIS FRAME. A teleport relocates the CASTER instantly; the local sim already
// knows the landing cell, so the caster's displacement must render THIS frame (optimistic) — NOT held behind a
// slide beat, NOT waiting on the chain. The predicted door excludes a K_TELEPORT Displaced from the walk-window
// (store.js): the caster jumps to the landing cell in DISPLAY immediately (the render blinks), while a PUSH/PULL
// slide on the same caster stays windowed (held until its slide beat presents). The teleport_arrival VFX beat
// rides the same wave turn so the arrival puff plays at the landing cell.

import { describe, expect, test } from 'bun:test'

import { create_fight_store } from '../src/store.js'
import { board_view, engine_view } from '../src/project.js'
import { DISPLACE_TELEPORT } from '../src/fight_render_prims.js'

const FIGHT = '0xf1'
const CHAR = '0xc1'
const GRID_W = 20
const cell = (x, y) => y * GRID_W + x
const ME_CELL = cell(5, 2)
const LANDING = cell(12, 8) // a far blink — a slide could never cover it in one frame

const FIGHT_OBJECT = {
  id: FIGHT,
  status: 1,
  width: GRID_W,
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
      cell: ME_CELL,
      stats: { agility: 40 },
    },
  ],
  mobs: [{ template: '0xabc', hp: 30, max_hp: 30, cell: cell(5, 5), ap: 4, mp: 3, level: 1, stats: { agility: 40 } }],
  queue: [
    { is_mob: false, idx: 0 },
    { is_mob: true, idx: 0 },
  ],
  turn_ptr: 0,
  turn_deadline_ms: 90_000,
}

const boot = () => {
  const store = create_fight_store()
  store.getState().input({
    type: 'init',
    fight_id: FIGHT,
    my_key: 'p0',
    ctx: { my_entity_id: CHAR, beat_ctx: { grid_width: GRID_W } },
  })
  store.getState().input({ type: 'snapshot', fight: FIGHT_OBJECT, version: 5 }, 1_000)
  return store
}

const board_me = (store) => board_view(store.getState()).escrow[0].cell
const engine_me = (store) => engine_view(store.getState()).fighters.get(CHAR).cell
// the teleport_arrival VFX beat rides the predicted wave (the arrival puff at the landing cell).
const arrival_beat = {
  kind: 'teleport_arrival',
  at: 0,
  duration: 100,
  payload: { target_id: CHAR, cell: { x: 12, y: 8 } },
}

describe('#11 own-cast teleport predicts the caster displacement this frame', () => {
  test('a K_TELEPORT self-Displaced blinks to the landing cell THIS frame (not held)', () => {
    const store = boot()
    store.getState().input(
      {
        type: 'predicted',
        basis_version: 6,
        intent_id: 'tp1',
        actions: [
          { kind: 'Cast', caster_is_mob: false, caster_idx: 0, target_cell: LANDING, ap_cost: 3 },
          { kind: 'Displaced', target_is_mob: false, target_idx: 0, to_cell: LANDING, effect_kind: DISPLACE_TELEPORT },
        ],
        beats: [
          { kind: 'cast', at: 0, duration: 300, payload: { entity_id: CHAR } },
          { kind: 'displacement', at: 300, duration: 0, payload: { target_id: CHAR, effect_kind: DISPLACE_TELEPORT } },
          arrival_beat,
        ],
      },
      1_100
    )
    // PREDICTED THIS FRAME — the DISPLAY (rendered cell) shows the caster already at the landing cell.
    expect(board_me(store)).toBe(LANDING)
    expect(engine_me(store)).toEqual({ x: 12, y: 8 })
    // the wave turn carries NO hold-window (teleport is excluded) and the arrival VFX beat rides along.
    const turn = store.getState().wave.find((t) => t.is_local)
    expect(turn.from_idx == null).toBe(true) // instant — never windowed
    expect(turn.beats.some((b) => b.kind === 'teleport_arrival')).toBe(true) // the teleport VFX variant plays
  })

  test('a PUSH/PULL slide on the caster IS held until its slide beat presents (the contrast)', () => {
    const store = boot()
    const PUSHED = cell(5, 6)
    store.getState().input(
      {
        type: 'predicted',
        basis_version: 6,
        intent_id: 'push1',
        actions: [
          { kind: 'Cast', caster_is_mob: false, caster_idx: 0, target_cell: PUSHED, ap_cost: 3 },
          { kind: 'Displaced', target_is_mob: false, target_idx: 0, to_cell: PUSHED, effect_kind: 0 },
        ],
        beats: [
          { kind: 'cast', at: 0, duration: 300, payload: { entity_id: CHAR } },
          { kind: 'displacement', at: 300, duration: 400, payload: { target_id: CHAR } },
        ],
      },
      1_100
    )
    // A SLIDE holds the DISPLAY at the pre-move cell (the rig lerps FROM here) — never an insta-jump.
    expect(board_me(store)).toBe(ME_CELL)
    const turn = store.getState().wave.find((t) => t.is_local)
    expect(turn.from_idx != null).toBe(true) // windowed — held behind the slide
    store.getState().input({ type: 'presented', seq: turn.seq }, 2_000)
    expect(board_me(store)).toBe(PUSHED) // revealed after the slide acks
  })
})
