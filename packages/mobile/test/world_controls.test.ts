// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { observe_world_controls } from '../../frontend/src/game/core/world_input.ts'
import { initial_app_state, reduce_app_state } from '../../frontend/src/store.ts'

const settings = { quality: 'low', music_enabled: false, render_distance: null } as const

test('overlay input cannot move the world, and non-finite axes never reach the device', () => {
  let state = initial_app_state(settings)
  const listeners = new Map<string, (input: never) => void>()
  const movements: unknown[] = []
  observe_world_controls({
    events: { on: (name: string, listener: (input: never) => void) => listeners.set(name, listener) } as never,
    get_state: () => state,
    read_world: () => ({
      set_jump: () => {},
      set_movement: (value) => {
        movements.push(value)
      },
    }),
  })
  const move = (forward: number): void => listeners.get('engine/movement')!({ forward, strafe: 0 } as never)
  move(Number.NaN)
  expect(movements).toEqual([])
  state = reduce_app_state(state, { type: 'page/open', page: 'settings' })
  move(1)
  expect(movements).toEqual([])
  state = reduce_app_state(state, { type: 'page/open', page: 'world' })
  move(1)
  move(0)
  expect(movements).toEqual([
    { forward: 1, strafe: 0 },
    { forward: 0, strafe: 0 },
  ])
})

test('management overlays retain rendering while suspending manual world input', async () => {
  const { sync_world_activity } = await import('../../frontend/src/modules/engine_activity.ts')
  const initial = initial_app_state(settings)
  const panel = reduce_app_state(initial, { type: 'page/open', page: 'settings' })
  const activity: boolean[] = []
  const input: boolean[] = []
  const world = {
    set_active: (value: boolean) => {
      activity.push(value)
    },
    set_interactive: (value: boolean) => {
      input.push(value)
    },
    set_action_lock: () => {},
  }
  sync_world_activity(world, panel)
  expect(activity).toEqual([true])
  expect(input).toEqual([false])
})
