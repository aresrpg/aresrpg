// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #1156 — "the fight seat roster has two homes and the simulator only fills one".
//
// THE CORRECTION THIS FILE SEALS. `use_dungeon().dungeon` has exactly ONE producer at runtime, on BOTH surfaces:
// `dungeon_run_store.js` — `fight_store.subscribe((s) => use_dungeon.setState({ dungeon: project.board_view(s) }))`,
// a MODULE-LEVEL mirror. The simulator installs it like the world does: `fight_shim.js` imports
// `world-shell/dungeon_store.js`, which re-exports `use_dungeon` FROM `dungeon_run_store.js` — importing the shim
// evaluates that module and arms the mirror. So `fight_shim.js`'s `escrow: []` lifecycle seed is not a second
// roster: it is the pre-fold placeholder for the window before the snapshot crosses the core door (the readers
// that do an UNGUARDED `dungeon.escrow.some(...)` — fight-stream.js:63,104 — need that window to be an array),
// and the very next fight-store input replaces the whole object with the projection.
//
// The audit that filed #1156 read `fight_shim_seed.test.js`, which INJECTS a fake dungeon store — the mirror
// never fires there — and generalised the fixture's `[]` to the product. This test drives the SINGLETON stores
// the page drives, so the claim can never be re-derived from a stub again.
//
// WHAT IS PINNED (each line is a disproof of one bullet of #1156, and of #1190's "one accident hides it"):
//   · the roster the consumers read (`my_seat_of`, the armed-wash weapon row, the LOS unions) is FULL on the
//     simulator, carrying `character`/`addr`/`cell`/`alive`/`weapon`;
//   · the D284 twin of `cast::los_obstacles` (obstacles ∪ living player bodies ∪ living mob bodies) contains
//     the player body — LOS does NOT trace through it on the sim surface;
//   · `escrow.findIndex(...)` for a seated caster resolves to a real seat, never the `-1` #1190 fears;
//   · the §7 crit clock fields (`world_seed`/`spawn_id`/`turn_deadline_ms`) ARE published here — #1190's
//     "an earlier clause of the same guard fires first" does not hold, so its fix must not lean on it.

import { describe, expect, test } from 'bun:test'

import { install_browser_globals } from '../test_helpers/browser_globals.js'

install_browser_globals({ with_document: true, with_element: true })

const { fight_store } = await import('@aresrpg/fight/store')
const { decode, encode } = await import('@aresrpg/fight/los')
const { create_sim_chain } = await import('@aresrpg/fight/sim_chain')
const { use_dungeon } = await import('../world-shell/dungeon_store.js')
const { my_seat_of } = await import('../world-shell/voxel_fight_folds.js')
const { create_fight_shim, LOCAL_ADDRESS: local_address } = await import('./fight_shim.js')

const SEED = 0x1156
const CHARACTER_ID = 'sim_c1'

const fighter = (id, cell, is_player) => ({
  id,
  name: id,
  cell,
  health: 30,
  health_max: 30,
  ap: 6,
  ap_max: 6,
  mp: 3,
  mp_max: 3,
  ap_used: 0,
  mp_used: 0,
  is_player,
  template_id: is_player ? 'senshi' : '0xmob_seed',
  level: 1,
  stats: {},
  effects: [],
  spell_levels: {},
  ap_reserve: 0,
})

/** The union `voxel_fight_adapter.js` builds at :1637 (the cast wash) and :1807 (the hover footprint), verbatim —
 *  the D284 twin of `cast::los_obstacles`. Kept a literal copy so the pin measures the SHIPPED expression. */
const adapter_los_union = (dungeon) => {
  const los = [...(dungeon.obstacles ?? [])]
  for (const p of dungeon.escrow ?? []) if (p.alive) los.push(p.cell)
  for (const m of dungeon.mobs ?? []) if (m.alive) los.push(m.cell)
  return los
}

/** Open a real simulator fight through the SINGLETON stores — exactly what `/simulator` does. */
const open_sim_fight = () => {
  const probe = create_sim_chain({ seed: SEED, fight_id: 'probe', team0: [], team1: [], templates_raw: [] })
  const shim = create_fight_shim({ schedule: () => {}, now: () => 1_700_000_000_000 })
  const started = shim.start({
    seed: SEED,
    fight_id: 'sim:1156:1',
    team0: [fighter(CHARACTER_ID, decode(probe.board.start_cells_a[0]), true)],
    team1: [fighter('mob_0', decode(probe.board.start_cells_b[0]), false)],
    templates_raw: [],
    roster: [{ id: CHARACTER_ID, name: 'KAELIS', class_id: 'senshi', level: 1 }],
    mobs: [{ template_id: '0xmob_seed', name: 'Seed Mob', level: 1, element: 0 }],
    focus_id: CHARACTER_ID,
  })
  expect(started.ok).toBe(true)
  return use_dungeon.getState().dungeon
}

describe('#1156 — the simulator roster reads the ONE home (board_view), not a stub', () => {
  test('the mirror publishes full seat rows over the shim lifecycle seed', () => {
    const dungeon = open_sim_fight()
    expect(dungeon.escrow).toHaveLength(1)
    expect(dungeon.escrow[0]).toMatchObject({ seat: 0, addr: local_address, character: CHARACTER_ID, alive: true })
  })

  test('my_seat_of resolves the seat — derive_phase never sees no_my_seat / not_escrowed here', () => {
    const dungeon = open_sim_fight()
    expect(my_seat_of(dungeon, CHARACTER_ID)?.character).toBe(CHARACTER_ID)
    expect(my_seat_of(dungeon, local_address)?.character).toBe(CHARACTER_ID) // the adapter's address fallback
  })

  test('the armed-wash weapon row lands — the WEAPON_ATTACK floor is not what prices the strike', () => {
    const dungeon = open_sim_fight()
    const row = dungeon.escrow.find((p) => (p.character ?? p.character_id) === CHARACTER_ID)
    expect(row?.weapon?.ap_cost).toBeGreaterThan(0)
    expect(row?.weapon?.reach).toBeGreaterThan(0)
  })

  test('D284 twin: the LOS union carries the living PLAYER body, so LOS never traces through it', () => {
    const dungeon = open_sim_fight()
    const [seat] = dungeon.escrow
    const [mob] = dungeon.mobs
    const los = adapter_los_union(dungeon)
    expect(seat.alive && mob.alive).toBe(true)
    expect(los).toContain(seat.cell) // the half #1156 reports as always empty
    expect(los).toContain(mob.cell)
    for (const obstacle of dungeon.obstacles ?? []) expect(los).toContain(obstacle)
    expect(los).toHaveLength((dungeon.obstacles?.length ?? 0) + 2)
    expect(seat.cell).toBe(encode(seat.cell % 20, Math.floor(seat.cell / 20))) // canonical stride-20 cells
  })

  test('#1190 cross-check: findIndex resolves a real seat and the crit clock IS published here', () => {
    const dungeon = open_sim_fight()
    expect(dungeon.escrow.findIndex((p) => (p.character ?? p.character_id) === CHARACTER_ID)).toBe(0)
    expect(dungeon.world_seed).not.toBeNull()
    expect(dungeon.spawn_id).not.toBeNull()
    expect(Number(dungeon.turn_deadline_ms)).toBeGreaterThan(0)
  })
})
