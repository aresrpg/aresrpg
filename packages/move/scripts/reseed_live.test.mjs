// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// RESEED LIVE — the PTB composer must be able to build every call the PLANNER can queue.
///
/// The planner and the composer are two halves of one contract, and nothing tied them together: the planner
/// learned to emit `set_mob_level` / `set_boss_mask` (they are wiped by `clear_tables`, so a reseed that never
/// re-emits them erases authored state), while the composer's whitelist still accepted only the three adders and
/// threw `unknown world authoring call` for anything else. Every drifted world with mobs would have died during
/// transaction CONSTRUCTION. The throw itself is correct and stays — it fires before signing, so no partial
/// clear can land — but it must only fire for a call the planner genuinely cannot produce.
import { describe, expect, test } from 'bun:test'

import { build_transaction } from './reseed_live.mjs'

const TARGET = '0x' + '9'.repeat(64)
const WORLD = '0x' + 'w'.replace('w', '1').repeat(64)
const TEMPLATE = '0x' + 'a'.repeat(64)

const context = {
  aresrpg_admin: '0x' + '2'.repeat(64),
  aresrpg_version: '0x' + '3'.repeat(64),
}

const world_call = (fn, payload) => ({
  leg: 'worlds',
  target: TARGET,
  object_id: WORLD,
  function: fn,
  payload,
})

const targets = tx =>
  tx
    .getData()
    .commands.map(command =>
      command.$kind === 'MoveCall'
        ? `${command.MoveCall.module}::${command.MoveCall.function}`
        : command.$kind,
    )

describe('reseed live composer — every planner-emittable world call composes', () => {
  test('the full re-author sequence composes, setters included', () => {
    const plan = {
      calls: [
        world_call('clear_tables', {}),
        world_call('add_mob_entry', {
          template_id: TEMPLATE,
          rate_bp: 100,
          min_group: 2,
          max_group: 3,
        }),
        world_call('set_mob_level', { template_id: TEMPLATE, level: 77 }),
        world_call('set_boss_mask', { rows: [0] }),
      ],
    }
    const tx = build_transaction(plan, context)
    expect(targets(tx)).toEqual([
      'world::clear_tables',
      'world::add_mob_entry',
      'world::set_mob_level',
      'world::set_boss_mask',
    ])
  })

  test('an empty boss mask still composes — clearing the mask is a meaningful state', () => {
    const tx = build_transaction(
      { calls: [world_call('set_boss_mask', { rows: [] })] },
      context,
    )
    expect(targets(tx)).toEqual(['world::set_boss_mask'])
  })

  test('a call the planner cannot emit still throws BEFORE any signing', () => {
    expect(() =>
      build_transaction({ calls: [world_call('drop_the_world', {})] }, context),
    ).toThrow(/unknown world authoring call/)
  })
})

// ── the LIVE fetch must resolve the Versioned payload, or every world reads empty ───────────────────────────
import { fetch_world_state } from './reseed_live.mjs'
import { bcs } from '@mysten/sui/bcs'
import { deriveDynamicFieldID as derive_dynamic_field_id } from '@mysten/sui/utils'

const WORLD_ID = '0x' + '5'.repeat(64)
const VERSIONED_ID = '0x' + '6'.repeat(64)
const WORLD_VERSION = 1

/// `Versioned` keeps its payload in a dynamic field on its OWN id, keyed by the u64 version — never inline. A
/// fetch that stops at the outer shell sees no tables at all, so every world looks empty, every run rewrites
/// everything, and the required post-run dry-run can never converge.
const child_id = derive_dynamic_field_id(
  VERSIONED_ID,
  'u64',
  bcs.u64().serialize(WORLD_VERSION).toBytes(),
)

const fake_client = {
  async getObjects({ objectIds }) {
    return {
      objects: objectIds.map(id => {
        if (id === WORLD_ID)
          return {
            json: {
              id: WORLD_ID,
              inner: { id: VERSIONED_ID, version: String(WORLD_VERSION) },
            },
          }
        if (id === child_id)
          return { json: { value: { mobs: [{ template_id: TEMPLATE }], mob_levels: [42] } } }
        return { json: null }
      }),
    }
  },
}

describe('reseed live fetch — the Versioned payload is resolved, not the shell', () => {
  test('a wrapped World yields its inner tables', async () => {
    const state = await fetch_world_state(fake_client, [WORLD_ID])
    const payload = state[WORLD_ID].inner.value
    expect(payload.mob_levels).toEqual([42])
    expect(payload.mobs.length).toBe(1)
  })
})

// ── the two halves together: the LIVE fetch shape must converge in the PLANNER ──────────────────────────────
import { build_world_leg } from './reseed_world_plan.mjs'

describe('reseed convergence — the fetched payload feeds the planner with zero drift', () => {
  const MOB = '0x' + 'd'.repeat(64)
  const converged_client = {
    async getObjects({ objectIds }) {
      return {
        objects: objectIds.map(id => {
          if (id === WORLD_ID)
            return {
              json: {
                id: WORLD_ID,
                inner: { id: VERSIONED_ID, version: String(WORLD_VERSION) },
              },
            }
          if (id === child_id)
            return {
              json: {
                value: {
                  resources: [],
                  mobs: [
                    {
                      template_id: MOB,
                      rate_bp: 100,
                      min_group: 2,
                      max_group: 3,
                    },
                  ],
                  mob_levels: [30],
                  boss_mask: [],
                  dungeon_rooms: [],
                },
              },
            }
          return { json: null }
        }),
      }
    },
  }

  test('a world already matching the seed plans NOTHING (the rerun the ceremony requires)', async () => {
    const chain_state = await fetch_world_state(converged_client, [WORLD_ID])
    const leg = build_world_leg({
      seed_rows: [
        { id: 'w', resources: [], mobGroups: [{ mob: 'm', rate: 0.01 }], dungeonRooms: [] },
      ],
      mob_rows: [{ key: 'm', role: 'normal', maxLevel: 30 }],
      seed_manifest: { worlds: [{ wid: 'w', id: WORLD_ID }], mobs: { m: { id: MOB, role: 'normal' } } },
      chain_state,
      target: TARGET,
    })
    expect(leg.blockers).toEqual([])
    expect(leg.transactions).toEqual([])
  })
})
