// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #1762 — the room and courier are sibling scene transports. Courier construction/import/teardown can never
// suppress or release the room, and room teardown can never close the courier.

import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

import '../../src/test_helpers/expedition_sdk_mock.js'
import { reset_trystero_mock, trystero_room_configs, trystero_rooms } from '../../src/test_helpers/trystero_mock.js'

// Register the shared Trystero recorder before linking either production transport.
const { join_room, leave_room } = await import('../../src/p2p/lobby-room.js')
const { join_courier, leave_courier } = await import('../../src/courier/world.js')
const { start_scene_courier } = await import('../../src/world-shell/scene_lifecycle.js')
const { presence_store } = await import('../../src/world-shell/presence_adapter.js')

const WORLD = `0x${'a'.repeat(64)}`
const CHARACTER = `0x${'1'.repeat(64)}`
const ADDRESS = `0x${'b'.repeat(64)}`

class FakeEventSource {
  constructor(url) {
    this.url = url
    this.readyState = 0
    this.closed = false
    this.listeners = new Map()
  }
  addEventListener(type, listener) {
    this.listeners.set(type, listener)
  }
  close() {
    this.closed = true
    this.readyState = 2
  }
}

const scene_identity = {
  world_id: WORLD,
  character_id: CHARACTER,
  address: ADDRESS,
  initial_cell: { x: 12, y: 34 },
}

beforeEach(() => {
  leave_courier()
  leave_room()
  reset_trystero_mock()
  delete globalThis.EventSource
})

afterEach(() => {
  leave_courier()
  leave_room()
  delete globalThis.EventSource
})

describe('room/courier sibling lifecycle', () => {
  it('still joins the room when the courier EventSource constructor throws synchronously', async () => {
    const constructor_error = new Error('courier constructor exploded')
    const errors = []
    globalThis.EventSource = class {
      constructor() {
        throw constructor_error
      }
    }

    join_room(WORLD, CHARACTER, scene_identity.initial_cell)
    await start_scene_courier(
      scene_identity,
      (error) => errors.push(error),
      async () => ({ join_courier })
    )

    expect(trystero_room_configs).toHaveLength(1)
    expect(presence_store.getState().my_cell).toMatchObject(scene_identity.initial_cell)
    expect(errors).toEqual([constructor_error])
  })

  it('keeps the joined room untouched when the courier import/init rejects', async () => {
    const import_error = new Error('courier chunk rejected')
    const errors = []

    join_room(WORLD, CHARACTER, scene_identity.initial_cell)
    await start_scene_courier(
      scene_identity,
      (error) => errors.push(error),
      () => Promise.reject(import_error)
    )

    expect(trystero_room_configs).toHaveLength(1)
    expect(errors).toEqual([import_error])
  })

  it('tears room and courier down independently in both directions', () => {
    let source
    globalThis.EventSource = class extends FakeEventSource {
      constructor(url) {
        super(url)
        source = this
      }
    }

    join_room(WORLD, CHARACTER)
    join_courier(WORLD, CHARACTER, ADDRESS)
    leave_room()
    expect(source.closed).toBe(false)

    join_room(WORLD, CHARACTER)
    let room_leaves = 0
    trystero_rooms.at(-1).leave = () => {
      room_leaves += 1
      return Promise.resolve()
    }
    leave_courier()
    expect(room_leaves).toBe(0)
  })
})
