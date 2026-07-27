// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// RESEED WORLD PLAN — the two properties the republish restructure broke and this file pins.
///
/// 1. A WRAPPED World reads through `Versioned`. `World` is now `{ id, inner }` with every table under the
///    versioned payload, so a planner that reads the ROOT sees an empty world, rewrites all of it, and can never
///    converge on a re-run. The zero-drift rerun test below is the convergence proof.
/// 2. Authored MOB LEVELS survive a reseed. `clear_tables` empties them and `add_mob_entry` re-inits to 0, so a
///    plan that never emits `set_mob_level` silently erases every authored level.
import { describe, expect, test } from 'bun:test'

import { build_world_leg } from './reseed_world_plan.mjs'

const TARGET = '0xcafe'
const WID = 'w1'
const OBJ = '0xw0r1d'
const MOB_A = '0x' + 'a'.repeat(64)
const MOB_B = '0x' + 'b'.repeat(64)

const seed_manifest = {
  worlds: [{ wid: WID, id: OBJ }],
  mobs: { mob_a: { id: MOB_A, role: 'r' }, mob_b: { id: MOB_B, role: 'r' } },
}

// the authored corpus rows the driver passes as `mob_rows` — `maxLevel` is the eligibility ceiling
const mob_rows = [
  { key: 'mob_a', role: 'normal', maxLevel: 30 },
  { key: 'mob_b', role: 'boss', maxLevel: 120 },
]

const seed_rows = [
  {
    id: WID,
    resources: [],
    mobGroups: [
      { mob: 'mob_a', rate: 0.01 },
      { mob: 'mob_b', rate: 0.02 },
    ],
    dungeonRooms: [],
  },
]

/// What a WRAPPED World actually looks like on chain: the tables live under `inner`, never at the root.
const wrapped_world = {
  fields: {
    id: OBJ,
    inner: {
      fields: {
        value: {
          fields: {
            resources: [],
            mobs: [
              {
                fields: {
                  template_id: MOB_A,
                  rate_bp: 100,
                  min_group: 2,
                  max_group: 3,
                },
              },
              {
                fields: {
                  template_id: MOB_B,
                  rate_bp: 200,
                  min_group: 2,
                  max_group: 3,
                },
              },
            ],
            mob_levels: [30, 120],
            boss_mask: [1],
            dungeon_rooms: [],
          },
        },
      },
    },
  },
}

const plan = chain_state =>
  build_world_leg({
    seed_rows,
    mob_rows,
    seed_manifest,
    chain_state,
    target: TARGET,
  })

describe('reseed world plan — wrapped World + authored levels', () => {
  test('a wrapped World that already matches the seed produces ZERO drift (rerun converges)', () => {
    const { transactions, blockers } = plan({ [OBJ]: wrapped_world })
    expect(blockers).toEqual([])
    // Reading the root shell instead of the versioned payload makes every world look empty, so the planner
    // rewrites all of them and a second run drifts exactly as much as the first — non-convergent by construction.
    expect(transactions).toEqual([])
  })

  test('a wrapped World whose levels drifted re-emits set_mob_level, and only that', () => {
    const drifted = structuredClone(wrapped_world)
    drifted.fields.inner.fields.value.fields.mob_levels = [30, 7]
    const { transactions } = plan({ [OBJ]: drifted })
    expect(transactions.length).toBe(1)
    const fns = transactions[0].calls.map(call => call.function)
    expect(fns).toContain('set_mob_level')
  })

  test('a rewritten world re-emits the boss mask after the rows exist', () => {
    const { transactions } = plan({
      [OBJ]: { fields: { id: OBJ, inner: { fields: { value: { fields: {} } } } } },
    })
    const fns = transactions[0].calls.map(call => call.function)
    // clear_tables wipes the mask too, so it has to come back — and only after the rows it indexes
    expect(fns).toContain('set_boss_mask')
    expect(fns.lastIndexOf('add_mob_entry')).toBeLessThan(
      fns.indexOf('set_boss_mask'),
    )
    const mask = transactions[0].calls.find(
      call => call.function === 'set_boss_mask',
    )
    expect(mask.payload.rows).toEqual([1]) // mob_b is the boss row
  })

  test('a rewritten world carries every authored level through the rebuild', () => {
    // an EMPTY world: the planner must re-author the rows AND their levels, or the reseed erases them
    const { transactions } = plan({
      [OBJ]: { fields: { id: OBJ, inner: { fields: { value: { fields: {} } } } } },
    })
    expect(transactions.length).toBe(1)
    const calls = transactions[0].calls
    const level_calls = calls.filter(call => call.function === 'set_mob_level')
    expect(level_calls.length).toBe(2) // one per authored mob row
    // and the accounting must count them — an uncounted call overflows the PTB command budget
    expect(transactions[0].call_count).toBe(calls.length)
  })
})
