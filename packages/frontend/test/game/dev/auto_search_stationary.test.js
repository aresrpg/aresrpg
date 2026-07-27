// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Regression #1154: a stationary search still owns auto-run, so manual input reaches the reducer door.

import { expect, test } from 'bun:test'

import { create_auto_run, subscribe_auto_run_cancelled } from '../../../src/game/auto_run.js'
import { blank_auto_search, reduce_auto_search } from '../../../src/game/dev/auto_search.js'

test('manual takeover during the stationary search window disarms auto-search', () => {
  let clock = 0
  let position = [0, 0, 0]
  let search_state = {
    ...blank_auto_search(),
    armed: true,
    phase: 'search',
    target: { zx: 1, zy: 1, x: 30, z: 0 },
  }
  const unsubscribe = subscribe_auto_run_cancelled((reason) => {
    search_state = reduce_auto_search(search_state, { type: 'interrupted', reason }, clock)
  })
  const auto_run = create_auto_run({
    get_pos: () => position,
    trigger_interact: () => false,
    notify_blocked: () => {},
    now: () => clock,
  })

  try {
    auto_run.start({ type: 'point', position: { x: 30, z: 0 } })
    auto_run.update(1 / 60)
    position = [30, 0, 0]
    clock += 16
    auto_run.update(1 / 60)
    clock += 16
    auto_run.update(1 / 60)

    // A movement key, touch move, Escape, or manual map marker calls this default player cancellation.
    auto_run.cancel()

    expect(search_state.armed).toBe(false)
    expect(search_state.phase).toBe('idle')
    expect(search_state.command.kind).toBe('halt')
  } finally {
    unsubscribe()
  }
})
