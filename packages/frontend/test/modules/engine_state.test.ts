// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import { initial_engine_state, receive_engine_status, receive_frame_rate } from '../../src/modules/engine_state.ts'

test('frame rate uses actual submissions and a retired scene cannot clear its replacement', () => {
  const menu = receive_frame_rate(initial_engine_state(), {
    type: 'engine/frames',
    source: 'menu',
    sample: { frames: 30, elapsed_ms: 500 },
  })
  expect(menu.frame_rate?.fps).toBe(60)
  const game = receive_frame_rate(menu, {
    type: 'engine/frames',
    source: 'game',
    sample: { frames: 15, elapsed_ms: 500 },
  })
  expect(game.frame_rate?.fps).toBe(30)
  expect(receive_frame_rate(game, { type: 'engine/frames', source: 'menu', sample: null })).toBe(game)
  expect(
    receive_frame_rate(game, {
      type: 'engine/frames',
      source: 'menu',
      sample: { frames: 0, elapsed_ms: 500 },
    })
  ).toBe(game)
  expect(receive_frame_rate(game, { type: 'engine/frames', source: 'game', sample: null }).frame_rate).toBeNull()
})

test('render status preserves its FPS sample but clears a previous failure', () => {
  const previous = {
    ...initial_engine_state(),
    issue: { code: 'graphics_unavailable' as const },
    frame_rate: { source: 'game', fps: 60 },
  }
  const next = receive_engine_status(previous, { state: 'ready', backend: 'webgpu' })
  expect(next.issue).toBeUndefined()
  expect(next.frame_rate).toEqual(previous.frame_rate)
})
