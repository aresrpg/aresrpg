// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, expect, it } from 'bun:test'

import { destroy_scene_and_leave_lobby } from './scene_lifecycle.js'

describe('destroy_scene_and_leave_lobby', () => {
  it('does not load the lobby chunk on the cold-login path', () => {
    let loads = 0
    const released = destroy_scene_and_leave_lobby(
      null,
      () => true,
      undefined,
      async () => {
        loads += 1
        return { leave_lobby() {} }
      }
    )

    expect(released).toBe(false)
    expect(loads).toBe(0)
  })

  it('destroys synchronously and leaves the old stream after the chunk resolves', async () => {
    let destroys = 0
    let leaves = 0
    let resolve_lobby
    const courier = new Promise((resolve) => {
      resolve_lobby = resolve
    })

    const released = destroy_scene_and_leave_lobby(
      { destroy: () => (destroys += 1) },
      () => true,
      undefined,
      () => courier
    )
    expect(released).toBe(true)
    expect(destroys).toBe(1)
    expect(leaves).toBe(0)

    resolve_lobby({ leave_lobby: () => (leaves += 1) })
    await courier
    await Promise.resolve()
    expect(leaves).toBe(1)
  })

  it('does not let a stale import resolution leave a newer scene stream', async () => {
    let leaves = 0
    let current = true
    const pending = Promise.resolve({ leave_lobby: () => (leaves += 1) })

    destroy_scene_and_leave_lobby(
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
