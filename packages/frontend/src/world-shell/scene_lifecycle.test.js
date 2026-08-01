// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, expect, it } from 'bun:test'

import { destroy_scene_and_leave_room } from './scene_lifecycle.js'

describe('destroy_scene_and_leave_room', () => {
  it('does not load the transport chunk on the cold-login path', () => {
    let loads = 0
    const released = destroy_scene_and_leave_room(
      null,
      () => true,
      undefined,
      async () => {
        loads += 1
        return { leave_room() {} }
      }
    )

    expect(released).toBe(false)
    expect(loads).toBe(0)
  })

  it('destroys synchronously and leaves the old stream after the chunk resolves', async () => {
    let destroys = 0
    let leaves = 0
    let resolve_transport
    const transport = new Promise((resolve) => {
      resolve_transport = resolve
    })

    const released = destroy_scene_and_leave_room(
      { destroy: () => (destroys += 1) },
      () => true,
      undefined,
      () => transport
    )
    expect(released).toBe(true)
    expect(destroys).toBe(1)
    expect(leaves).toBe(0)

    resolve_transport({ leave_room: () => (leaves += 1) })
    await transport
    await Promise.resolve()
    expect(leaves).toBe(1)
  })

  it('does not let a stale import resolution leave a newer scene stream', async () => {
    let leaves = 0
    let current = true
    const pending = Promise.resolve({ leave_room: () => (leaves += 1) })

    destroy_scene_and_leave_room(
      { destroy() {} },
      () => current,
      undefined,
      () => pending
    )
    current = false
    await pending
    await Promise.resolve()

    expect(leaves).toBe(0)
  })
})
