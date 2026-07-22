// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// RED-FIRST regression (fresh-character "could not verify your position" — QUEUE row 2): a JUST-JOINED
// character's on-chain checkpoint is proven by the join tx's OWN WorldJoined event the instant it confirms,
// but world_checkpoint.js's boot-spawn cache used to learn that fact ONLY through a SEPARATE chain-direct DF
// re-read (resolve_checkpoint_spawn) that can still be resolving/lagging behind the very write it observes —
// the "kiosk not indexed" bug family, here for the checkpoint DF. A lagging re-read that reports "no checkpoint
// yet" used to unconditionally overwrite the cache with null, ERASING an already-seeded receipt-proven fact —
// so the engine's boot_spawn (and therefore the [F] search's position argument) fell back to the WORLD_SPAWN
// guess, which the on-chain `checkpoint::verify_travel` then rejected as ETravelTooFar ("could not verify your
// position"). Drives the REAL module (no mocked internals of world_checkpoint.js itself) — only its chain-edge
// dependencies (read_checkpoint, get_sdk, get_world) are doubled so the test runs offline.

import { afterEach, beforeEach, expect, mock, test } from 'bun:test'

import { reset_expedition_sdk_mock, set_expedition_sdk_mock } from '../test_helpers/expedition_sdk_mock.js'

// mock.module is PROCESS-GLOBAL (bun) — registered once, before world_checkpoint.js (and its dependents) load.
let read_checkpoint_impl = async () => null
mock.module('../chain/read_checkpoint.js', () => ({
  read_checkpoint: (...args) => read_checkpoint_impl(...args),
}))
// #123 (cross-file dangling-promise pollution, sibling class): chain/sdk's get_sdk is ALREADY mocked
// process-wide by test_helpers/expedition_sdk_mock.js — a SECOND direct `mock.module('../chain/sdk', ...)`
// here would compete for the same process-global registration (bun: no unmock API, last-loaded wins), and
// depending on full-suite file order could PERMANENTLY steal `get_sdk` out from under every other file's
// `set_expedition_sdk_mock()` call for the rest of the run (the #123 TypeError signature —
// `sdk.grpc_client.core.getObject` on an empty `{}` — is this exact shape leaking into items_sale_actions.test.js
// and fight_liveness.test.js). Route through the shared seam instead — armed in beforeEach/cleared in afterEach
// (not module-top-once) since reset_expedition_sdk_mock() must run between files and the mock has to be back
// in place before EACH of this file's own tests, not just its first.
const world_checkpoint_sdk = async () => ({ grpc_client: {} })
mock.module('@aresrpg/sdk/game', () => ({
  // No live World doc in this test — world_offsets/checkpoint_to_world fall back to DEFAULT_WORLD_OFFSET
  // (250_000 per axis), which is the exact behavior a transient world-doc read miss already tolerates.
  get_world: () => async () => null,
}))

set_expedition_sdk_mock(world_checkpoint_sdk) // armed before the module-under-test import below

const {
  resolve_checkpoint_spawn,
  read_checkpoint_spawn,
  seed_checkpoint_spawn,
  write_follow_checkpoint,
  _reset_for_test,
} = await import('./world_checkpoint.js')

const CHAR = 'char-fresh-1'
const WORLD = 'world-1'
// checkpoint_to_world with a null doc: chain_to_world(v, 250_000) = v - 250_000
const CHAIN_POS = { x: 100, z: 200 }
const EXPECTED_WORLD_POS = { x: 100 - 250_000, z: 200 - 250_000 }

beforeEach(() => {
  _reset_for_test()
  read_checkpoint_impl = async () => null // the chain-direct DF read finds nothing yet (indexer/RPC lag)
  set_expedition_sdk_mock(world_checkpoint_sdk) // re-arm — afterEach below clears it for whichever test/file is next
})

// #123: never leave this file's sdk mock configured for whichever test/file the shared process runs next.
afterEach(() => reset_expedition_sdk_mock())

test('a receipt-seeded position is readable synchronously before any chain re-read', async () => {
  expect(read_checkpoint_spawn(CHAR, WORLD)).toBeNull() // nothing seeded yet
  await seed_checkpoint_spawn(CHAR, WORLD, CHAIN_POS)
  expect(read_checkpoint_spawn(CHAR, WORLD)).toEqual(EXPECTED_WORLD_POS)
})

test('a follow arrival writes only the session checkpoint cache and returns the reducer receipt', async () => {
  const position = { x: 12.5, z: -8.5 }
  await expect(write_follow_checkpoint(CHAR, WORLD, position)).resolves.toEqual({
    character_id: CHAR,
    world_id: WORLD,
    position,
  })
  expect(read_checkpoint_spawn(CHAR, WORLD)).toEqual(position)
})

test('a lagging chain-direct read (still "no checkpoint") must NOT erase an already-seeded receipt-proven position', async () => {
  await seed_checkpoint_spawn(CHAR, WORLD, CHAIN_POS)
  expect(read_checkpoint_spawn(CHAR, WORLD)).toEqual(EXPECTED_WORLD_POS) // sanity: the seed landed

  // Simulates the exact race: GameWorldHost awaits resolve_checkpoint_spawn right after auto_join_world
  // publishes the binding — the chain-direct DF read can still race the write it's trying to observe.
  await resolve_checkpoint_spawn(CHAR, WORLD)

  // THE RED: today resolve_checkpoint_spawn's null branch unconditionally does `_cache.set(key, null)`,
  // wiping the receipt-proven fact back to null — the engine's boot_spawn (and the [F] search x/z it feeds)
  // would fall back to WORLD_SPAWN, which verify_travel then refuses as ETravelTooFar.
  expect(read_checkpoint_spawn(CHAR, WORLD)).toEqual(EXPECTED_WORLD_POS)
})

test('a chain-direct read that DOES confirm a checkpoint still adopts (chain truth wins when it actually answers)', async () => {
  await seed_checkpoint_spawn(CHAR, WORLD, CHAIN_POS)
  const moved = { x: 300, z: 400 }
  read_checkpoint_impl = async () => moved // a LATER search moved the checkpoint; the chain read now confirms it
  await resolve_checkpoint_spawn(CHAR, WORLD)
  expect(read_checkpoint_spawn(CHAR, WORLD)).toEqual({ x: moved.x - 250_000, z: moved.z - 250_000 })
})

test('with nothing ever seeded, a genuine miss still resolves to null (pre-first-join stays honest)', async () => {
  expect(read_checkpoint_spawn(CHAR, WORLD)).toBeNull()
  await resolve_checkpoint_spawn(CHAR, WORLD)
  expect(read_checkpoint_spawn(CHAR, WORLD)).toBeNull()
})
