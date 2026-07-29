// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #1636 — the live "RangeError: Maximum call stack size exceeded" during normal play. #1615 made re-entrant
// inputs APPLY instead of being discarded; it folded each queued input from inside the notification that
// admitted it, so the stack grew one frame set per re-entrant input. In the browser (subscriber frames on every
// level) the tab died. The drain is now the outermost call's LOOP: depth is O(1) in the number of re-entrant
// inputs, and a subscriber that never converges hits the cap and throws by name instead of walking off the stack.

import { describe, expect, test } from 'bun:test'

import { create_fight_store } from '../src/store.js'

const FIGHT = '0xdrain'

/** Stack depth measured INSIDE the notification — the only place the recursion was observable. */
const stack_depth = () => new Error().stack.split('\n').length

/**
 * A subscriber that dispatches one input per notification, `budget` times, mirroring the app's feedback edges
 * (the projection mirror → dungeon store → busy mirror → the door again).
 */
const feed_on_notify = (store, budget) => {
  let left = budget
  let max_depth = 0
  let folded = 0
  const unsubscribe = store.subscribe(() => {
    max_depth = Math.max(max_depth, stack_depth())
    if (left <= 0) return
    left -= 1
    folded += 1
    store.getState().input({ type: 'error', message: `feedback ${left}` })
  })
  return { unsubscribe, depth: () => max_depth, folded: () => folded }
}

describe('the store drains re-entrant inputs iteratively (#1636)', () => {
  test('stack depth does not grow with the number of re-entrant inputs', () => {
    Error.stackTraceLimit = Infinity
    const shallow = create_fight_store()
    shallow.getState().input({ type: 'init', fight_id: FIGHT }, 1)
    const few = feed_on_notify(shallow, 10)
    shallow.getState().input({ type: 'error', message: 'start' }, 2)
    few.unsubscribe()

    const deep = create_fight_store()
    deep.getState().input({ type: 'init', fight_id: FIGHT }, 1)
    const many = feed_on_notify(deep, 400)
    deep.getState().input({ type: 'error', message: 'start' }, 2)
    many.unsubscribe()

    // every fed input was applied — the #1615 guarantee (re-entrant inputs are APPLIED, never discarded)
    expect(few.folded()).toBe(10)
    expect(many.folded()).toBe(400)
    expect(deep.getState().error).toBe('feedback 0')
    // …and 40x the re-entrant inputs cost no extra stack. Before the fix this grew ~4 frames per input.
    expect(many.depth() - few.depth()).toBeLessThan(20)
  })

  test('a subscriber that never converges throws by name instead of blowing the stack', () => {
    const store = create_fight_store()
    store.getState().input({ type: 'init', fight_id: FIGHT }, 1)
    const unsubscribe = store.subscribe(() => {
      store.getState().input({ type: 'error', message: `forever ${Math.random()}` })
    })
    let thrown = null
    try {
      store.getState().input({ type: 'error', message: 'start' }, 2)
    } catch (error) {
      thrown = error
    }
    unsubscribe()
    expect(thrown).toBeInstanceOf(Error)
    expect(thrown?.name).not.toBe('RangeError')
    expect(thrown?.message).toContain('re-entrant inputs folded during ONE input')
    expect(thrown?.message).toContain('error') // the feeding subscriber's input kind, named
    // the storm leaves no backlog: the next input folds normally
    expect(() => store.getState().input({ type: 'error', message: 'after' }, 3)).not.toThrow()
    expect(store.getState().error).toBe('after')
  })
})
