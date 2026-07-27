// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//
// THE LATCH SHARD REACHES THE TRANSACTION. Fight liveness is a CHARACTER fact, so `fight_latch` is a sharded
// family keyed by the CHARACTER id — every latch door asserts it got the shard that character maps to, and a
// PTB built against any other one aborts on chain (`fight_latch::EWrongShard`).
//
// The scope-keyed `fight_registry` family is a DIFFERENT book: it parents the objects a create DERIVES. A join
// derives nothing and a settle only releases, so those PTBs carry the latch and NO registry at all — the absence
// below is the design's guarantee, not an accident, which is why it is asserted rather than assumed.
//
// This suite drives the REAL SDK builders — no `spyOn(sdk_fight, ...)` anywhere. That is the whole point: the
// frontend seam shipped un-threaded once and 4101 green tests said nothing, because every suite that touches
// these actions mocks the builder and asserts the ARGUMENTS it was handed. Arguments prove intent; only the
// built transaction proves the shard. Here we mock transport (sdk handle, kiosk read, signing) and let the
// builder run for real, then read the shard ids back out of the transaction's own inputs.
//
// The load-bearing case is the DUNGEON one: a room fight derives from the CREATOR's RunPass and runs inside a
// world, so `fight_scope_id` and `world_id` are both sitting right there — either is exactly what a pattern-match
// would reach for, and neither picks the latch.
import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { Transaction } from '@mysten/sui/transactions'
import { fight_latch_arg, fight_registry_arg, fight_shard_index } from '@aresrpg/sdk/deployment/aresrpg'

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
// The four ids in play map to FOUR DIFFERENT shard indexes (last byte % 16), so "it took the character's" can
// never be satisfied by accident: character 0xc5→5, other character 0xc9→9, world 0xa0→0, creator pass 0xb7→7.
const CHARACTER = pad('c5')
const OTHER_CHARACTER = pad('c9')
const FIGHT = pad('f16d7')
const WORLD = pad('a0')
const CREATOR_PASS = pad('b7')
const HANDLE = { kiosk_id: pad('c1'), personal_kiosk_cap_id: pad('c2') }

const SHARDS = Array.from({ length: 16 }, (_, i) => ({
  id: pad(`5a4d${i.toString(16)}`),
  initial_shared_version: '1',
}))

// The latch family is a SEPARATE set of shared objects — distinct ids even at an equal index, so a fight door
// that reaches for a latch can never be satisfied by a registry row (and vice versa).
const LATCH_SHARDS = Array.from({ length: 16 }, (_, i) => ({
  id: pad(`1a7c${i.toString(16)}`),
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
  FIGHT_LATCH_SHARDS: LATCH_SHARDS,
}

const CTX = { network: 'localnet', ids: { aresrpg: IDS } }

const expected_latch = (character) => LATCH_SHARDS[fight_shard_index(character)].id
const REGISTRY_IDS = new Set(SHARDS.map((shard) => shard.id))

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

/** The registry-family shards a transaction carries — `[]` is the claim every door below makes. */
const registry_shards_in = (tx) => input_ids(tx).filter((id) => REGISTRY_IDS.has(id))

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
      ...CTX,
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

describe('probe integrity: the shard readers see what they claim to see', () => {
  test('the registry-absence probe DOES catch a registry shard when one is present', () => {
    // Without this control every `toEqual([])` below would also pass against a typo'd id set. A transaction
    // carrying a real `fight_registry_arg` (what a CREATE builds) must light the detector up.
    const tx = new Transaction()
    fight_registry_arg(tx, 'localnet', IDS, WORLD, true)
    expect(registry_shards_in(tx)).toEqual([SHARDS[fight_shard_index(WORLD)].id])
  })

  test('the two families stay distinct objects at an equal index', () => {
    const tx = new Transaction()
    fight_latch_arg(tx, 'localnet', IDS, WORLD, true) // same index as the registry pick above, different object
    expect(input_ids(tx)).toEqual([expected_latch(WORLD)])
    expect(registry_shards_in(tx)).toEqual([])
  })
})

describe('the latch shard a CHARACTER maps to reaches the built transaction', () => {
  test('a WORLD join carries the joining character latch shard, and no registry at all', async () => {
    await dungeon_actions.join_world_fight({ fight_id: FIGHT, character_id: CHARACTER })
    expect(signed).toBeTruthy()
    expect(input_ids(signed)).toContain(expected_latch(CHARACTER))
    // A join derives nothing, so the registry has no business in this PTB — that is the redesign's guarantee.
    expect(registry_shards_in(signed)).toEqual([])
  })

  test('a world join with NO world binding refuses before signing, by name', async () => {
    reset_world_binding()
    await expect(dungeon_actions.join_world_fight({ fight_id: FIGHT, character_id: CHARACTER })).rejects.toThrow(
      /fight_scope_id/
    )
    expect(signed).toBeNull()
  })

  test('a DUNGEON settle carries the settling character latch shard, never the pass or world one', async () => {
    await dungeon_actions.settle_and_open({
      fight_id: FIGHT,
      fight_scope_id: CREATOR_PASS, // the Fight's own scope — the room derived from it, the latch never does
      run_pass_id: pad('b9'),
      world_id: WORLD, // still needed by settle_run, and still not a latch key
      character_id: CHARACTER,
    })
    const ids = input_ids(signed)
    expect(ids).toContain(expected_latch(CHARACTER))
    expect(ids).not.toContain(expected_latch(CREATOR_PASS))
    expect(ids).not.toContain(expected_latch(WORLD))
    expect(registry_shards_in(signed)).toEqual([])
  })

  test('a WORLD settle carries the settling character latch shard, never the world one', async () => {
    await dungeon_actions.settle_and_open({
      fight_id: FIGHT,
      fight_scope_id: WORLD,
      run_pass_id: null,
      world_id: WORLD,
      character_id: CHARACTER,
    })
    const ids = input_ids(signed)
    expect(ids).toContain(expected_latch(CHARACTER))
    expect(ids).not.toContain(expected_latch(WORLD))
    expect(registry_shards_in(signed)).toEqual([])
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

  test('two characters in the SAME world settle onto different latch shards', async () => {
    // The index follows the character id and nothing else: hold the world and the fight fixed, change only who
    // settles, and the picked shard must move. A scope-derived latch would hand both the same object.
    const settle_as = async (character_id) => {
      await dungeon_actions.settle_and_open({
        fight_id: FIGHT,
        fight_scope_id: WORLD,
        run_pass_id: null,
        world_id: WORLD,
        character_id,
      })
      return input_ids(signed)
    }
    const mine = await settle_as(CHARACTER)
    const theirs = await settle_as(OTHER_CHARACTER)
    expect(mine).toContain(expected_latch(CHARACTER))
    expect(theirs).toContain(expected_latch(OTHER_CHARACTER))
    expect(expected_latch(CHARACTER)).not.toBe(expected_latch(OTHER_CHARACTER))
    expect(theirs).not.toContain(expected_latch(CHARACTER))
  })
})
