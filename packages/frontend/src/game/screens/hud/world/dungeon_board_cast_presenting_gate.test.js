// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// MP-ZONE HIDES DURING SPELL SEQUENCES: when the vfx/sequence of a spell is played, the MP zone stays
// hidden, so a misclick can't move the character mid-sequence. Two homes: the CORE projection (project.js move_wash,
// pinned in move_wash.test.js) suppresses the paint; this file pins the CLICK half — DungeonBoard's `reachable`
// (the move-click affordance's own gate) reads the SAME fact off engine_view, never a second UI-side flag.
//
// DungeonBoard.jsx imports the 3D engine (not headless-importable, no jsdom in this repo) — exactly like
// dungeon_board_walk_from.test.js: (A) a REAL @aresrpg/fight store proves the CORE fact `cast_presenting` exists
// and flips on a local cast beat; (B) a source-contract locks that `reachable`'s useMemo gates on that SAME
// projected field — the red at HEAD (the field doesn't exist yet, the guard doesn't reference it yet).

import { describe, expect, test } from 'bun:test'

import { create_fight_store } from '@aresrpg/fight/store'
import { engine_view } from '@aresrpg/fight/project'
import { local_intent_beats, synthetic_cast_events } from '@aresrpg/fight/present'

const GRID_W = 20
const FIGHT = '0xf1'
const CHAR = '0xc1'
const cell = (x, y) => y * GRID_W + x
const ME_CELL = cell(5, 2)

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
  mobs: [{ template: '0xabc', hp: 30, max_hp: 30, cell: cell(10, 10), ap: 4, mp: 3, level: 1, stats: { agility: 40 } }],
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

describe('DungeonBoard reachable — gates on the SAME cast_presenting fact the MP-zone wash reads', () => {
  // (A) ROOT FACT, real @aresrpg/fight: a local cast beat presenting flips engine_view's projected field — the
  //     ONE source DungeonBoard's click gate and voxel_fight_adapter's paint both read (no second UI-side flag).
  test('(A) engine_view.cast_presenting flips true while MY OWN cast beat is still unacked', () => {
    const store = boot()
    expect(engine_view(store.getState()).cast_presenting).toBe(false)
    store.getState().input(
      {
        type: 'predicted',
        intent_id: 'test-cast-1',
        basis_version: store.getState().applied_version + 1,
        actions: [],
        beats: local_intent_beats(
          synthetic_cast_events({ fight_id: FIGHT, caster_is_mob: false, caster_idx: 0, target_cell: cell(6, 2) }),
          { fight_id: FIGHT }
        ),
      },
      1_100
    )
    expect(engine_view(store.getState()).cast_presenting).toBe(true)
  })

  // (B) THE FIX, source-contract (red at HEAD): `reachable`'s useMemo early-return guard and its dependency array
  //     both reference `cast_presenting` off the `fight` projection — the move-click affordance can't fire while
  //     the SAME fact that hides the zone is true.
  test('(B) reachable guards on fight?.cast_presenting (early-return AND the dep array)', async () => {
    const src = await Bun.file(new URL('./DungeonBoard.jsx', import.meta.url)).text()
    const start = src.indexOf('const reachable = useMemo(')
    const end = src.indexOf('const caster_cell =', start)
    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)
    const body = src.slice(start, end)
    const guard_line = body.split('\n').find((l) => l.includes('return new Set()'))
    expect(guard_line).toBeTruthy()
    expect(guard_line).toMatch(/cast_presenting/)
    const dep_line = body.split('\n').find((l) => l.trim().startsWith('}, ['))
    expect(dep_line).toBeTruthy()
    expect(dep_line).toMatch(/cast_presenting/)
  })
})
