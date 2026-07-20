// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// TOUCH_INPUT — the state singleton's contract: the [-1,1] movement invariant (diagonals preserved, NO
// dead zone — that's M-03's stick), the accumulate→consume→zeroed drain semantics for look/pinch, and
// the armed × text_focused gate. Singleton state persists across tests, so beforeEach re-zeros it.

import { beforeEach, describe, expect, it } from 'bun:test'

import {
  add_look,
  add_pinch,
  consume_look,
  consume_mount_toggle,
  consume_pinch,
  is_active,
  read_movement,
  reset,
  set_armed,
  set_jump,
  set_mount_toggle,
  set_move,
  set_text_focused,
  subscribe_active,
} from './touch_input.js'

beforeEach(() => {
  reset() // zeroes movement / look / pinch / jump
  set_armed(false) // gate flags are lifecycle, not transient — reset leaves them; clear them here
  set_text_focused(false)
})

describe('set_move — [-1,1] per-axis invariant (state, NOT stick math)', () => {
  it('passes in-range values through unchanged', () => {
    set_move(0.5, -0.3)
    expect(read_movement()).toEqual({ forward: 0.5, strafe: -0.3, jump: false })
  })

  it('PRESERVES a full diagonal (1,1) — the engine normalizes direction (controller.js:179-182), so shrinking here would be a wrong 2nd home', () => {
    set_move(1, 1)
    const m = read_movement()
    expect(m.forward).toBe(1)
    expect(m.strafe).toBe(1)
  })

  it('preserves a partial diagonal', () => {
    set_move(0.7, 0.7)
    expect(read_movement()).toEqual({ forward: 0.7, strafe: 0.7, jump: false })
  })

  it('clamps over-range magnitudes to [-1,1] per axis', () => {
    set_move(1.5, -2)
    expect(read_movement()).toMatchObject({ forward: 1, strafe: -1 })
    set_move(2, 0.5)
    expect(read_movement()).toMatchObject({ forward: 1, strafe: 0.5 })
  })

  it('collapses non-finite input to 0 (a bad stick calc can never poison set_input)', () => {
    set_move(NaN, Infinity)
    expect(read_movement()).toMatchObject({ forward: 0, strafe: 0 })
  })

  it('does NOT apply a dead zone — a small value survives (dead zone lives in M-03 touch_stick.js)', () => {
    set_move(0.05, 0)
    expect(read_movement().forward).toBe(0.05)
  })
})

describe('set_jump', () => {
  it('coerces to a boolean flag on read_movement', () => {
    set_jump(true)
    expect(read_movement().jump).toBe(true)
    set_jump(0)
    expect(read_movement().jump).toBe(false)
  })
})

describe('look-delta drain — accumulate → consume → zeroed', () => {
  it('sums events between frames, then zeroes on consume', () => {
    add_look(3, -2)
    add_look(1, 5)
    expect(consume_look()).toEqual({ dx: 4, dy: 3 })
    // second drain with no new input → zeroed
    expect(consume_look()).toEqual({ dx: 0, dy: 0 })
  })

  it('ignores non-finite components', () => {
    add_look(NaN, 2)
    expect(consume_look()).toEqual({ dx: 0, dy: 2 })
  })
})

describe('pinch-delta drain', () => {
  it('accumulates then zeroes on consume', () => {
    add_pinch(0.1)
    add_pinch(0.2)
    expect(consume_pinch()).toBeCloseTo(0.3, 10)
    expect(consume_pinch()).toBe(0)
  })

  it('ignores non-finite deltas', () => {
    add_pinch(NaN)
    add_pinch(0.4)
    expect(consume_pinch()).toBeCloseTo(0.4, 10)
  })
})

describe('is_active — armed AND not text-focused', () => {
  it('false when disarmed', () => {
    expect(is_active()).toBe(false)
  })

  it('true once armed', () => {
    set_armed(true)
    expect(is_active()).toBe(true)
  })

  it('suppressed while a text surface is focused (D154 gate), restored on blur', () => {
    set_armed(true)
    set_text_focused(true)
    expect(is_active()).toBe(false)
    set_text_focused(false)
    expect(is_active()).toBe(true)
  })
})

describe('reset — clears transient input only', () => {
  it('zeroes movement / jump / look / pinch', () => {
    set_move(1, -1)
    set_jump(true)
    add_look(9, 9)
    add_pinch(5)
    reset()
    expect(read_movement()).toEqual({ forward: 0, strafe: 0, jump: false })
    expect(consume_look()).toEqual({ dx: 0, dy: 0 })
    expect(consume_pinch()).toBe(0)
  })

  it('does NOT touch the armed gate (lifecycle, not transient)', () => {
    set_armed(true)
    reset()
    expect(is_active()).toBe(true) // still armed, text not focused
  })
})

describe('mount toggle — one-shot drain (M-04 right-cluster MOUNT button)', () => {
  it('queues on set, drains once, then reads false', () => {
    expect(consume_mount_toggle()).toBe(false)
    set_mount_toggle()
    expect(consume_mount_toggle()).toBe(true)
    expect(consume_mount_toggle()).toBe(false) // single-shot: the frame loop fires toggle_mount exactly once
  })

  it('reset() drops a queued toggle (a disarm never carries one into the next arm)', () => {
    set_mount_toggle()
    reset()
    expect(consume_mount_toggle()).toBe(false)
  })
})

describe('subscribe_active — the overlay mount gate (M-04)', () => {
  it('notifies only on an is_active() TRANSITION, not on every set_armed', () => {
    let hits = 0
    const off = subscribe_active(() => (hits += 1))
    set_armed(true) // false → true : one notify
    set_armed(true) // no change : silent
    set_armed(true) // no change : silent
    expect(hits).toBe(1)
    set_armed(false) // true → false : one notify
    expect(hits).toBe(2)
    off()
  })

  it('text focus flips is_active() and notifies (chat opens over a live overlay)', () => {
    set_armed(true)
    let hits = 0
    const off = subscribe_active(() => (hits += 1))
    set_text_focused(true) // active true → false
    expect(is_active()).toBe(false)
    set_text_focused(false) // → true again
    expect(is_active()).toBe(true)
    expect(hits).toBe(2)
    off()
  })

  it('resets transient input on EVERY transition (no ghost stick when a fight/chat opens under a held thumb)', () => {
    set_armed(true)
    set_move(1, -1)
    set_jump(true)
    add_look(9, 9)
    set_armed(false) // disarm mid-hold → the module drops the held vector
    expect(read_movement()).toEqual({ forward: 0, strafe: 0, jump: false })
    expect(consume_look()).toEqual({ dx: 0, dy: 0 })
  })

  it('unsubscribe stops delivery', () => {
    let hits = 0
    const off = subscribe_active(() => (hits += 1))
    off()
    set_armed(true)
    expect(hits).toBe(0)
  })
})
