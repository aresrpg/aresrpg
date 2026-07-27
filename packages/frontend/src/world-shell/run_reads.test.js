// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// DUNGEON META off a WRAPPED World (#1289): `dungeon_rooms` / `dungeon_key_template` are fields of the
// version-wrapped `WorldInner`, not of the `World` shell. Reading them off the shell does not fail — it yields
// no rooms and no key, and dungeon_run_store then refuses entry with `dungeons.no_key` (PR #1315 review
// finding 6). The envelope here is built with the SDK's OWN field derivation, never a hand-copied address.
import { describe, test, expect } from 'bun:test'
import { world_inner_field_id, WORLD_VERSION } from '@aresrpg/sdk/game'

import { load_world_meta } from './run_reads.js'

const WORLD_ID = `0x${'11'.repeat(32)}`
const VERSIONED_ID = `0x${'22'.repeat(32)}`
const KEY_TEMPLATE = `0x${'33'.repeat(32)}`
const MOB_A = `0x${'44'.repeat(32)}`
const MOB_B = `0x${'55'.repeat(32)}`

/** A chain serving a WRAPPED world: the shell names its Versioned; the payload sits at the derived field id. */
const wrapped_sdk = ({ version = WORLD_VERSION } = {}) => {
  const field_id = world_inner_field_id(VERSIONED_ID, version)
  const objects = {
    [WORLD_ID]: { id: WORLD_ID, inner: { id: VERSIONED_ID, version: String(version) } },
    [field_id]: {
      id: field_id,
      name: String(version),
      value: {
        seed: '1',
        biome: 'glacial',
        dungeon_key_template: { vec: [KEY_TEMPLATE] },
        dungeon_rooms: [{ mobs: [MOB_A, MOB_A] }, { mobs: [MOB_B] }],
        mobs: [],
        resources: [],
      },
    },
    [MOB_A]: { id: MOB_A, name: 'Chicklet', min_level: 3, element: 1 },
    [MOB_B]: { id: MOB_B, name: 'Bandit', min_level: 9, element: 2 },
  }
  return {
    grpc_client: {
      core: {
        getObject: async ({ objectId }) => ({
          object: objects[objectId] ? { json: objects[objectId], version: '7' } : null,
        }),
      },
    },
  }
}

describe('load_world_meta — dungeon meta lives in the wrapped payload', () => {
  test('reads the room rosters and the key template off the inner', async () => {
    const meta = await load_world_meta(wrapped_sdk(), WORLD_ID)
    // THE BUG: read off the shell these are [] and null, and dungeon entry is refused for want of a key.
    expect(meta.rooms).toEqual([[MOB_A, MOB_A], [MOB_B]])
    expect(meta.key_template).toBe(KEY_TEMPLATE)
    // the per-mob identity leg still resolves each DISTINCT template (unwrapped shared objects)
    expect(meta.mob_names[MOB_A]).toBe('Chicklet')
    expect(meta.mob_levels[MOB_B]).toBe(9)
    expect(meta.mob_elements[MOB_A]).toBe(1)
  })

  test('throws when the world payload cannot be read — never silently roomless', async () => {
    const sdk = {
      grpc_client: {
        core: {
          getObject: async ({ objectId }) => ({
            // the shell reads, its payload does not: an empty-but-present meta would refuse dungeon entry
            // while looking like a world that simply has no dungeon.
            object:
              objectId === WORLD_ID
                ? { json: { id: WORLD_ID, inner: { id: VERSIONED_ID, version: '1' } }, version: '7' }
                : null,
          }),
        },
      },
    }
    expect(load_world_meta(sdk, WORLD_ID)).rejects.toThrow(/World not found on-chain/)
  })
})
