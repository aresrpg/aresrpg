// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// TRAP HOME-B COLLAPSE (kill-revert cluster, 2nd half) — the frontend's parallel trap home (trap_overlay.js)
// is DEAD; render + cast-legality + the receipt trap_cells all read the fold's ONE projection, engine_view.my_traps
// (own-only — the caster knows only their OWN casts, mirroring the retired overlay's coverage exactly). The divergent
// overlay lifecycle (living-only spring, no corpse/version-bump handling) produced invisible-armed traps →
// ECellAlreadyTrapped → whole-turn reverts. This spec pins: (a) the fold home carries the no-stack truth an empty
// overlay would leak, (b) the receipt render path paints a trap cross from the fold-sourced cells, and (c) every
// consumer now reads the fold, and the overlay module is gone.

import { describe, expect, test } from 'bun:test'
import { create_fight_store } from '@aresrpg/fight/store'
import { engine_view } from '@aresrpg/fight/project'
import { produce_receipt_render_turns } from '@aresrpg/fight/fight_render_events'

import { cast_range_set_dungeon } from '../fight-engine/overlay_intents.js'

const FIGHT = '0xtrapcollapse'
const CHAR = '0xc1'
const W = 20
const enc = (x, y) => y * W + x
const ME = enc(5, 5)
const MOB = enc(7, 5)
const TRAP = enc(9, 5)

const FIGHT_OBJECT = {
  id: FIGHT,
  status: 1,
  width: W,
  height: 19,
  participants: [
    {
      owner: '0xaaa',
      character: CHAR,
      class: 'senshi',
      team: 0,
      ap: 9,
      mp: 3,
      base_ap: 9,
      base_mp: 3,
      hp: 50,
      max_hp: 50,
      cell: ME,
    },
  ],
  mobs: [{ template: '0xabc', hp: 200, max_hp: 200, cell: MOB, ap: 4, mp: 3, level: 1 }],
  queue: [{ is_mob: false, idx: 0 }],
  turn_ptr: 0,
  turn_deadline_ms: 90_000,
}

const boot = () => {
  const store = create_fight_store()
  store
    .getState()
    .input({ type: 'init', fight_id: FIGHT, my_key: 'p0', ctx: { my_entity_id: CHAR, beat_ctx: { grid_width: W } } })
  store.getState().input({ type: 'snapshot', fight: FIGHT_OBJECT, version: 5 }, 1_000)
  return store
}

// A trap-placing cast folds into the durable my_traps at dispatch — the SAME seam DungeonBoard.flush_commit rides.
const place_trap = (store) =>
  store.getState().input(
    {
      type: 'predicted',
      basis_version: 6,
      intent_id: 'trap1',
      actions: [{ kind: 'Cast', caster_is_mob: false, caster_idx: 0, target_cell: TRAP, ap_cost: 2 }],
      beats: [{ kind: 'cast', at: 0, duration: 100, payload: {} }],
      place_traps: [TRAP],
    },
    1_100
  )

describe('trap home collapse — the fold (engine_view.my_traps) is the ONE client trap home', () => {
  test('THE DIVERGENCE: a fold-armed trap blocks the no-stack cast that an EMPTY overlay would leak (ECellAlreadyTrapped)', () => {
    const store = boot()
    place_trap(store)
    const armed = engine_view(store.getState()).my_traps
    expect(armed).toEqual([TRAP]) // own-only fold projection — the caster's own committed trap

    const grid = { width: W, height: 19 }
    const caster = { cell: { x: 5, y: 5 } }
    const range = [1, 6]
    // Reading the FOLD: the trapped cell is dropped from the legal set — the local refusal that stops the bad cast.
    const from_fold = cast_range_set_dungeon(range, caster, grid, [], { los: false, trap_cells: armed })
    expect(from_fold.has(TRAP)).toBe(false)
    // Reading an EMPTY source (the retired overlay's divergent state — invisible-armed) would LEAK the illegal cast.
    const from_empty = cast_range_set_dungeon(range, caster, grid, [], { los: false, trap_cells: [] })
    expect(from_empty.has(TRAP)).toBe(true)
  })

  test('the receipt render path paints a trap cross from the fold-sourced trap_cells', () => {
    const store = boot()
    place_trap(store)
    // dungeon_run_store sources the receipt's trap_cells from engine_view.my_traps — feed it to the render pipeline.
    const trap_cells = engine_view(store.getState()).my_traps
    const events = [
      {
        type: '0x0::fight_events::Hit',
        parsedJson: { fight: FIGHT, victim_is_mob: true, victim_idx: '0', amount: '15', remaining_hp: '25' },
      },
      {
        type: '0x0::fight_events::Displaced',
        parsedJson: {
          fight: FIGHT,
          target_is_mob: true,
          target_idx: '0',
          kind: '12',
          from_cell: String(MOB),
          to_cell: String(TRAP),
          requested: '3',
          blocked: '0',
        },
      },
    ]
    const receipt = produce_receipt_render_turns(events, {
      fight_id: FIGHT,
      trap_cells,
      resolve_fighter_id: ({ is_mob, idx, character }) => character ?? `${is_mob ? 'm' : 'p'}${idx}`,
      fighter_cells: new Map([['m0', { x: 7, y: 5 }]]),
    })
    const beats = receipt.turns.flatMap((t) => t.events)
    expect(beats.some((e) => e.kind === 'trap_trigger')).toBe(true)
  })

  test('CONTRACT: the RENDER seam reads engine_view.my_traps, never trap_overlay', async () => {
    const src = await Bun.file(new URL('./voxel_fight_adapter.js', import.meta.url)).text()
    expect(src).not.toContain('trap_overlay')
    expect(src).toContain('fight.my_traps')
  })

  test('CONTRACT: the CAST-LEGALITY seam reads the fold, never trap_overlay', async () => {
    const src = await Bun.file(new URL('../game/screens/hud/world/DungeonBoard.jsx', import.meta.url)).text()
    expect(src).not.toContain('trap_overlay')
    expect(src).toContain('fight.my_traps')
  })

  test('CONTRACT: the RECEIPT path sources trap_cells from the fold, never trap_overlay', async () => {
    const src = await Bun.file(new URL('./dungeon_run_store.js', import.meta.url)).text()
    expect(src).not.toContain('trap_overlay')
    expect(src).toContain('engine_view(fight_store.getState()).my_traps')
  })

  test('trap_overlay.js is DELETED — the parallel home is gone', async () => {
    const exists = await Bun.file(new URL('./trap_overlay.js', import.meta.url)).exists()
    expect(exists).toBe(false)
  })
})
