// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//
// THE REGISTRY SHARD REACHES THE TRANSACTION. The fight registry is sharded: `init` shares one per shard and
// every door asserts it got the one its SCOPE maps to, so a PTB built against the wrong shard aborts on chain.
//
// This suite drives the REAL SDK builders — no `spyOn(sdk_fight, ...)` anywhere. That is the whole point: the
// frontend seam shipped un-threaded once and 4101 green tests said nothing, because every suite that touches
// these actions mocks the builder and asserts the ARGUMENTS it was handed. Arguments prove intent; only the
// built transaction proves the shard. Here we mock transport (sdk handle, kiosk read, signing) and let the
// builder run for real, then read the shard id back out of the transaction's own inputs.
//
// The load-bearing case is the DUNGEON one: a room fight derives from the CREATOR's RunPass, not the run's
// world, so for every party member but the creator the two ids differ — and `world_id` is sitting right there,
// which is exactly what a pattern-match would pass.
import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { fight_shard_index } from '@aresrpg/sdk/deployment/aresrpg'

import { install_browser_globals } from '../test_helpers/browser_globals.js'
import { reset_expedition_sdk_mock, set_expedition_sdk_mock } from '../test_helpers/expedition_sdk_mock.js'

import { rebind_world_character, reset_world_binding } from './session_gate.js'
// `get_sdk` is mocked PROCESS-WIDE by this seam (bun has no unmock API), so every file must arm it in
// beforeEach and clear it after — an unarmed file inherits whatever the previous one left behind.

// The action graph registers the browser wallet at module load, so its modules import DYNAMICALLY — after the
// host surface exists (the same order every suite in this directory uses).
const restore_browser_globals = install_browser_globals()

const dungeon_actions = await import('./dungeon_actions.js')
const kiosk_resolve = await import('./kiosk_resolve.js')
const { use_auth } = await import('../auth')

afterAll(restore_browser_globals)

const pad = (tag) => `0x${tag.padStart(64, '0')}`
const CHARACTER = pad('c0')
const FIGHT = pad('f16d7')
// Chosen so the two ids land on DIFFERENT shards — the assertion is meaningless if they collide.
const WORLD = pad('a0') // last byte 0xa0 → shard 0
const CREATOR_PASS = pad('b7') // last byte 0xb7 → shard 7
const HANDLE = { kiosk_id: pad('c1'), personal_kiosk_cap_id: pad('c2') }

const SHARDS = Array.from({ length: 16 }, (_, i) => ({
  id: pad(`5a4d${i.toString(16)}`),
  initial_shared_version: '1',
}))

// A complete-enough id set: `aresrpg_deployment` refuses on a partial one, which is the behaviour we want kept.
const IDS = {
  PACKAGE_ID: pad('a0e1'),
  LATEST_PACKAGE_ID: pad('a0e2'),
  ENGINE_PACKAGE_ID: pad('e0e1'),
  ENGINE_LATEST_PACKAGE_ID: pad('e0e2'),
  ENGINE_VERSION: pad('e0e3'),
  VERSION: pad('a0e4'),
  GAME_CONFIG: pad('a0e5'),
  CREATION: pad('a0e6'),
  CATALOG: pad('a0e7'),
  POOL_REGISTRY: pad('a0e8'),
  ITEM_POLICY: pad('a0e9'),
  CHARACTER_POLICY: pad('a0ea'),
  DUNGEON_PACKAGE_ID: pad('d0e1'), // the dungeon settle leg targets it — an unset id builds "undefined::…"
  FIGHT_REGISTRY_SHARDS: SHARDS,
}

const expected_shard = (scope) => SHARDS[fight_shard_index(scope)].id

/** Every object id the built transaction actually carries, whatever input shape it took. */
function input_ids(tx) {
  // `getData()` runs the SDK's own schema over the built inputs — a throw here is the transaction being
  // malformed, which is itself worth failing on, so surface it rather than swallowing it into a miss.
  return tx.getData().inputs.flatMap((input) => {
    const id =
      input.Object?.SharedObject?.objectId ??
      input.Object?.ImmOrOwnedObject?.objectId ??
      input.UnresolvedObject?.objectId
    return id ? [id] : []
  })
}

let spies = []
let signed = null

beforeEach(() => {
  signed = null
  set_expedition_sdk_mock(async () => ({ grpc_client: {} }))
  use_auth.setState({ address: pad('ee') })
  rebind_world_character(CHARACTER, WORLD)
  spies = [
    spyOn(dungeon_actions, 'ctx_of').mockReturnValue({
      // localnet has no baked shared-version map, so refs fall back to unresolved inputs — the shard PICK is
      // still fully exercised, and it is the picked id this suite is about.
      network: 'localnet',
      ids: { aresrpg: IDS },
    }),
    spyOn(kiosk_resolve, 'kiosk_for_character').mockResolvedValue(HANDLE),
    spyOn(dungeon_actions, 'sign').mockImplementation(async (tx) => {
      signed = tx
      return { digest: pad('d1'), effects: {} }
    }),
  ]
})

afterEach(() => {
  for (const spy of spies) spy.mockRestore()
  reset_expedition_sdk_mock()
  reset_world_binding()
})

describe('the registry shard a fight maps to reaches the built transaction', () => {
  test('a WORLD join addresses the shard of the character bound world', async () => {
    await dungeon_actions.join_world_fight({ fight_id: FIGHT, character_id: CHARACTER })
    expect(signed).toBeTruthy()
    expect(input_ids(signed)).toContain(expected_shard(WORLD))
  })

  test('a world join with NO world binding refuses before signing, by name', async () => {
    reset_world_binding()
    await expect(dungeon_actions.join_world_fight({ fight_id: FIGHT, character_id: CHARACTER })).rejects.toThrow(
      /fight_scope_id/
    )
    expect(signed).toBeNull()
  })

  test("a DUNGEON settle addresses the CREATOR pass's shard, never the run world's", async () => {
    await dungeon_actions.settle_and_open({
      fight_id: FIGHT,
      fight_scope_id: CREATOR_PASS, // the Fight's own world field — a member's own pass would be wrong too
      run_pass_id: pad('b9'),
      world_id: WORLD, // still needed by settle_run, and NOT the registry scope
      character_id: CHARACTER,
    })
    const ids = input_ids(signed)
    expect(ids).toContain(expected_shard(CREATOR_PASS))
    expect(ids).not.toContain(expected_shard(WORLD))
  })

  test('a WORLD settle addresses the world shard', async () => {
    await dungeon_actions.settle_and_open({
      fight_id: FIGHT,
      fight_scope_id: WORLD,
      run_pass_id: null,
      world_id: WORLD,
      character_id: CHARACTER,
    })
    expect(input_ids(signed)).toContain(expected_shard(WORLD))
  })

  test('a settle with no scope refuses before signing, by name', async () => {
    await expect(
      dungeon_actions.settle_and_open({
        fight_id: FIGHT,
        fight_scope_id: null,
        world_id: WORLD,
        character_id: CHARACTER,
      })
    ).rejects.toThrow(/fight_scope_id/)
    expect(signed).toBeNull()
  })
})
