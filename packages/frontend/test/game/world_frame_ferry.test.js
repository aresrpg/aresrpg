// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #2180 — a same-world rebind resets the spawns reducer. The cached World doc must be folded again; remembering
// only the world id leaves offset_x/offset_z at the reset value of zero and makes auto-search consume a lie.

import { expect, test } from 'bun:test'
import { create_spawns_store } from '@aresrpg/world/spawns_zones'

import { fold_current_world_frame } from '../../src/game/world_frame_ferry.js'

const WORLD_ID = `0x${'a'.repeat(64)}`
const LIVE_WORLD_DOC = { bounds_x: 500_000, bounds_z: 500_000, zone_size: 32 }

test('#2180 — the live frame is restored after unbind then rebind to the same world', async () => {
  const store = create_spawns_store()
  const input = (message) => store.getState().input(message)
  const read_world_doc = async () => LIVE_WORLD_DOC
  const current_world_id = () => WORLD_ID

  input({ type: 'world_bound', world_id: WORLD_ID })
  await fold_current_world_frame(WORLD_ID, { current_world_id, read_world_doc, input })
  expect(store.getState()).toMatchObject({
    world_frame_ready: true,
    zone_size: 32,
    offset_x: 250_000,
    offset_z: 250_000,
  })

  input({ type: 'world_bound', world_id: null })
  input({ type: 'world_bound', world_id: WORLD_ID })
  expect(store.getState()).toMatchObject({ world_frame_ready: false, zone_size: 512, offset_x: 0, offset_z: 0 })

  await fold_current_world_frame(WORLD_ID, { current_world_id, read_world_doc, input })
  expect(store.getState()).toMatchObject({
    world_frame_ready: true,
    zone_size: 32,
    offset_x: 250_000,
    offset_z: 250_000,
  })
})
