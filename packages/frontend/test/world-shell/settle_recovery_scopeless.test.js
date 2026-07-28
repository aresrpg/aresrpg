// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//
// THE ANTI-BRICK LEAVES SETTLE A FIGHT ROW THAT CARRIES NO WORLD (#1396). The latch redesign moved fight
// liveness to the character-keyed `fight_latch` book, and `settle_and_take`/`settle_open_world` stopped taking a
// derivation scope at all — a settle only releases, so those PTBs carry the latch and no registry (the guarantee
// asserted in src/world-shell/fight_latch_shard.test.js). The frontend's scope threading outlived them and kept
// REFUSING on a missing scope, for a value no builder reads.
//
// That refusal sat on the un-brick path. Both recovery leaves source the scope from a /v1 fight doc's `world`
// field and both fall back to null when the row has none: `terminal.world ?? null` (leaf 1,
// auto_settle_terminal_fights) and `pending.world ?? null` (leaf 2, recover_character) — dungeon_settlement.js.
// A character stranded with an unopened terminal fight (the `fight_marker` clears ONLY through `results::open`)
// therefore got a throw instead of a settle, precisely where the player has no other door.
//
// Drives the REAL SDK builder — transport is mocked (sdk handle, kiosk read, signing) and the transaction is
// read back for its own inputs, the same discipline fight_latch_shard.test.js established: arguments prove
// intent, only the built transaction proves the settle had everything it needed without a scope.
import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { fight_latch_arg, fight_shard_index } from '@aresrpg/sdk/deployment/aresrpg'
import { Transaction } from '@mysten/sui/transactions'

import { install_browser_globals } from '../../src/test_helpers/browser_globals.js'
import { reset_expedition_sdk_mock, set_expedition_sdk_mock } from '../../src/test_helpers/expedition_sdk_mock.js'

// The action graph registers the browser wallet at module load, so its modules import DYNAMICALLY — after the
// host surface exists (the same order every suite that touches these actions uses).
const restore_browser_globals = install_browser_globals()

const dungeon_actions = await import('../../src/world-shell/dungeon_actions.js')
const kiosk_resolve = await import('../../src/world-shell/kiosk_resolve.js')
const { use_auth } = await import('../../src/auth')

afterAll(restore_browser_globals)

const pad = (tag) => `0x${tag.padStart(64, '0')}`
const CHARACTER = pad('c5')
const FIGHT = pad('f16d7')
const WORLD = pad('a0')
const HANDLE = { kiosk_id: pad('c1'), personal_kiosk_cap_id: pad('c2') }

const SHARDS = Array.from({ length: 16 }, (_, i) => ({ id: pad(`5a4d${i.toString(16)}`), initial_shared_version: '1' }))
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
  DUNGEON_PACKAGE_ID: pad('d0e1'),
  FIGHT_REGISTRY_SHARDS: SHARDS,
  FIGHT_LATCH_SHARDS: LATCH_SHARDS,
}

const CTX = { network: 'localnet', ids: { aresrpg: IDS } }
const expected_latch = (character) => LATCH_SHARDS[fight_shard_index(character)].id

/** Every object id the built transaction actually carries, whatever input shape it took. */
function input_ids(tx) {
  return tx.getData().inputs.flatMap((input) => {
    const id =
      input.Object?.SharedObject?.objectId ??
      input.Object?.ImmOrOwnedObject?.objectId ??
      input.UnresolvedObject?.objectId
    return id ? [id] : []
  })
}

// The row the recovery leaves read back from /v1: a genuinely terminal fight doc with NO `world` key at all —
// the shape that makes both leaves hand the settle a null scope. `world_id` below is derived the way they
// derive it, so this fixture cannot drift from the expression it stands for.
const SCOPELESS_ROW = { status: 'defeat', fight_id: FIGHT }

let spies = []
let signed = null

beforeEach(() => {
  signed = null
  set_expedition_sdk_mock(async () => ({ grpc_client: {} }))
  use_auth.setState({ address: pad('ee') })
  spies = [
    // localnet has no baked shared-version map, so refs fall back to unresolved inputs — the shard PICK is
    // still fully exercised, and it is the picked id this suite is about.
    spyOn(dungeon_actions, 'ctx_of').mockReturnValue({ ...CTX }),
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
})

describe('the recovery leaves un-brick a fight row that carries no world (#1396)', () => {
  test('probe integrity: the fixture row really has no world to derive a scope from', () => {
    expect(SCOPELESS_ROW.world ?? null).toBeNull()
    // And a latch is reachable for this character regardless — the settle is not missing anything real.
    const tx = new Transaction()
    fight_latch_arg(tx, 'localnet', IDS, CHARACTER, true)
    expect(input_ids(tx)).toEqual([expected_latch(CHARACTER)])
  })

  test('a scopeless terminal row SETTLES instead of refusing, and the built tx carries the character latch', async () => {
    await dungeon_actions.settle_and_open({
      fight_id: SCOPELESS_ROW.fight_id,
      run_pass_id: null, // both leaves reach this door with no run: leaf 1 excludes dungeon-bound fights outright
      world_id: SCOPELESS_ROW.world ?? null, // `terminal.world ?? null` / `pending.world ?? null` — null here
      character_id: CHARACTER,
    })
    expect(signed).toBeTruthy()
    // The settle had everything it needed: the character's own latch shard is in the transaction.
    expect(input_ids(signed)).toContain(expected_latch(CHARACTER))
  })

  test('a row that DOES carry a world settles the same way — the world is not what the settle rides', async () => {
    await dungeon_actions.settle_and_open({
      fight_id: FIGHT,
      run_pass_id: null,
      world_id: WORLD,
      character_id: CHARACTER,
    })
    expect(signed).toBeTruthy()
    const ids = input_ids(signed)
    expect(ids).toContain(expected_latch(CHARACTER))
    expect(ids).not.toContain(expected_latch(WORLD))
  })
})
