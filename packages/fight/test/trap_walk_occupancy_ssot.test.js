// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// trap_walk_occupancy_ssot.test.js — #1493, THE SECOND HOME: what a walk ENTERS.
//
// A chain `Moved`/`MobMoved` carries only the landing cell, so the client REBUILDS the walked route to decide
// which traps it crossed. That rebuild exists TWICE — once in the fold's trap ledger (`fold_trap_ledger`, the
// sole `gone` writer) and once in the receipt beat producer (`produce_receipt_render_turns`, the `trap_trigger`
// beat writer) — and the two disagreed on their body mask:
//
//   · chain  (`displacement::move_blocked_cells` → `add_living_bodies`): obstacles ∪ holes ∪ off-shape ∪ LIVING
//     bodies except the mover. A CORPSE never blocks a walk.
//   · producer (`fold.js` `fighter_positions`): drops `alive === false` / `hp <= 0` — matches the chain.
//   · ledger  (`trap_ledger.js` `committed_entries_of`): seeded `cell_at` from EVERY base fighter — corpses
//     included. Its rebuilt route therefore DETOURS around a body the chain walks straight through.
//
// The consequence is the reported one: a trap the mob's real route never touched is consumed by the ledger the
// instant the receipt lands — "traps disappear the moment a mob's path WOULD cross them, before any trigger" —
// and a trap the mob really did cross survives. Both rows below drive the store, not the helper.

import { describe, expect, test } from 'bun:test'

import { engine_view } from '../src/project.js'
import { create_fight_store } from '../src/store.js'

const fight_id = '0x1493b'
const character_id = '0xc1'
const width = 20
const enc = (x, y) => y * width + x

const me_cell = enc(1, 5)
const corpse_cell = enc(5, 5) // a DEAD mob squatting on the walker's straight route
const walker_cell = enc(8, 5)
const walker_dest = enc(2, 5)
const detour_cell = enc(5, 4) // the only cell a minimal go-around of the corpse must enter
const on_route_cell = enc(4, 5) // squarely on the chain's straight route

const event = (kind, fields) => ({
  type: `0x0::fight_events::${kind}`,
  parsedJson: { fight: fight_id, ...fields },
})

// Row y=6 is walled under the corpse so the only minimal detour runs through y=4 — the rebuilt route is then
// deterministic and the fixture measures the body mask, not a BFS tie-break.
const obstacles = [enc(4, 6), enc(5, 6), enc(6, 6)]

const fight_object = {
  id: fight_id,
  status: 1,
  width,
  height: 19,
  obstacles,
  participants: [
    {
      owner: '0xaaa',
      character: character_id,
      class: 'yajin',
      team: 0,
      ap: 9,
      mp: 6,
      base_ap: 9,
      base_mp: 6,
      hp: 50,
      max_hp: 50,
      cell: me_cell,
    },
  ],
  mobs: [
    { template: '0xdead', hp: 0, max_hp: 30, cell: corpse_cell, ap: 4, mp: 4, level: 1 },
    { template: '0xmob', hp: 100, max_hp: 100, cell: walker_cell, ap: 4, mp: 6, level: 1 },
  ],
  queue: [{ is_mob: false, idx: 0 }],
  turn_ptr: 0,
  turn_deadline_ms: 90_000,
}

const boot = () => {
  const store = create_fight_store()
  store.getState().input({
    type: 'init',
    fight_id,
    my_key: 'p0',
    ctx: { my_entity_id: character_id, beat_ctx: { grid_width: width } },
  })
  store.getState().input({ type: 'snapshot', fight: fight_object, version: 5 }, 1_000)
  return store
}

const place_trap = (store, intent_id, anchor) =>
  store.getState().input(
    {
      type: 'predicted',
      basis_version: 6,
      intent_id,
      actions: [{ kind: 'Cast', caster_is_mob: false, caster_idx: 0, target_cell: anchor, ap_cost: 1 }],
      place_traps: [anchor],
    },
    1_100
  )

const walk_the_mob = (store) =>
  store.getState().input(
    {
      type: 'receipt',
      version: 7,
      receipt: { events: [event('MobMoved', { idx: 1, to_cell: walker_dest })] },
    },
    1_200
  )

const trap_by_anchor = (store, anchor) => store.getState().my_traps.find((trap) => Number(trap.anchor) === anchor)

const trigger_anchors = (store) =>
  store
    .getState()
    .wave.flatMap((turn) => turn.beats)
    .filter((beat) => beat.kind === 'trap_trigger')
    .map((beat) => Number(beat.payload.trap_anchor))

describe('#1493 a corpse never re-routes the walk that decides trap consumption', () => {
  test('POSITIVE CONTROL — a trap on the walked route is consumed, and its beat is produced', () => {
    const store = boot()
    place_trap(store, 'trap-on-route', on_route_cell)
    walk_the_mob(store)

    expect(trap_by_anchor(store, on_route_cell)?.gone).toBe(true)
    expect(trigger_anchors(store)).toEqual([on_route_cell])
  })

  test('a trap on the corpse DETOUR is never entered — the chain walks through the body', () => {
    const store = boot()
    place_trap(store, 'trap-on-detour', detour_cell)
    walk_the_mob(store)

    // The beat producer already masks the corpse out, so it narrates the true route and produces NO trigger.
    expect(trigger_anchors(store)).toEqual([])
    // The ledger must agree: nothing entered that cell, so the trap is still armed and still projected.
    expect(trap_by_anchor(store, detour_cell)?.gone).toBe(false)
    expect(engine_view(store.getState()).my_traps).toEqual([detour_cell])
    expect(engine_view(store.getState()).trap_prims).toEqual([detour_cell])
  })

  test('a body killed EARLIER in the same receipt frees its cell for the walk that follows', () => {
    const store = boot()
    // The corpse of the fixture is revived for this row: it is ALIVE in the snapshot and dies in the tail, so the
    // ledger must free its cell mid-stream exactly as the chain rebuilds its wall mask per mover.
    store.getState().input(
      { type: 'snapshot', fight: { ...fight_object, mobs: [{ ...fight_object.mobs[0], hp: 30 }, fight_object.mobs[1]] }, version: 6 },
      1_050
    )
    place_trap(store, 'trap-on-detour', detour_cell)
    store.getState().input(
      {
        type: 'receipt',
        version: 8,
        receipt: {
          events: [
            event('Hit', { victim_is_mob: true, victim_idx: 0, amount: 30, remaining_hp: 0 }),
            event('MobMoved', { idx: 1, to_cell: walker_dest }),
          ],
        },
      },
      1_200
    )

    expect(trap_by_anchor(store, detour_cell)?.gone).toBe(false)
    expect(engine_view(store.getState()).trap_prims).toEqual([detour_cell])
  })
})
