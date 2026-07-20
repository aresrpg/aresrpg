// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// TOUCH_LOOK — the canvas gesture → look/pinch accumulator wiring (M-04). Verifies the pointer bookkeeping
// against a fake canvas (bun:test has no DOM): one finger sums look px deltas, two fingers convert spread
// change into pinch deltas, the is_active() gate silences everything mid-fight/typing, and non-touch pointers
// (mouse/stylus) are ignored so the desktop path is untouched. The sensitivity + the cam.rotate/cam.dolly
// apply live in embed_voxel_player.js's feed() — NOT here — so this file only asserts the raw accumulation.

import { beforeEach, describe, expect, it } from 'bun:test'

import { consume_look, consume_pinch, reset, set_armed, set_text_focused } from './touch_input.js'
import { create_touch_look } from './touch_look.js'

/** Minimal EventTarget stand-in: records listeners, dispatches plain event objects with preventDefault. */
function make_canvas() {
  const handlers = /** @type {Record<string, Function[]>} */ ({})
  return {
    getBoundingClientRect() {
      return { left: 0, top: 0, width: 800, height: 600 }
    },
    setPointerCapture() {},
    releasePointerCapture() {},
    addEventListener(/** @type {string} */ type, /** @type {Function} */ fn) {
      ;(handlers[type] ||= []).push(fn)
    },
    removeEventListener(/** @type {string} */ type, /** @type {Function} */ fn) {
      handlers[type] = (handlers[type] || []).filter((h) => h !== fn)
    },
    /** dispatch a synthetic pointer event (pointerType defaults to 'touch'). */
    emit(/** @type {string} */ type, /** @type {any} */ ev) {
      for (const h of handlers[type] || []) h({ pointerType: 'touch', preventDefault() {}, ...ev })
    },
    /** count of live listeners for a type — proves dispose() detaches. */
    count(/** @type {string} */ type) {
      return (handlers[type] || []).length
    },
  }
}

beforeEach(() => {
  reset()
  set_armed(true) // the scheme is live for most tests; the gate test flips it off explicitly
  set_text_focused(false)
})

describe('one-finger look drag → look accumulator', () => {
  it('sums per-move px deltas from the pointer-down origin', () => {
    const canvas = make_canvas()
    create_touch_look(canvas)
    canvas.emit('pointerdown', { pointerId: 1, clientX: 500, clientY: 100 })
    canvas.emit('pointermove', { pointerId: 1, clientX: 510, clientY: 95 }) // +10, -5
    canvas.emit('pointermove', { pointerId: 1, clientX: 508, clientY: 100 }) // -2, +5
    expect(consume_look()).toEqual({ dx: 8, dy: 0 })
  })

  it('rejects a drag that starts on the left half reserved for movement', () => {
    const canvas = make_canvas()
    create_touch_look(canvas)
    canvas.emit('pointerdown', { pointerId: 1, clientX: 399, clientY: 100 })
    canvas.emit('pointermove', { pointerId: 1, clientX: 450, clientY: 100 })
    expect(consume_look()).toEqual({ dx: 0, dy: 0 })
  })

  it.each([
    ['button', 'button'],
    ['panel', '[role="dialog"]'],
  ])('rejects a right-half drag when a %s owns the pointer path', (_label, matched) => {
    const canvas = make_canvas()
    create_touch_look(canvas)
    const ui_node = { matches: (selector) => selector.includes(matched) }
    canvas.emit('pointerdown', {
      pointerId: 1,
      clientX: 500,
      clientY: 100,
      composedPath: () => [ui_node],
    })
    canvas.emit('pointermove', { pointerId: 1, clientX: 550, clientY: 100 })
    expect(consume_look()).toEqual({ dx: 0, dy: 0 })
  })

  it('ignores a move for an untracked pointer (down happened off-canvas / while inactive)', () => {
    const canvas = make_canvas()
    create_touch_look(canvas)
    canvas.emit('pointermove', { pointerId: 9, clientX: 50, clientY: 50 })
    expect(consume_look()).toEqual({ dx: 0, dy: 0 })
  })
})

describe('two-finger pinch → pinch accumulator', () => {
  it('accumulates the CHANGE in finger spread (spread apart = positive)', () => {
    const canvas = make_canvas()
    create_touch_look(canvas)
    canvas.emit('pointerdown', { pointerId: 1, clientX: 500, clientY: 0 })
    canvas.emit('pointerdown', { pointerId: 2, clientX: 600, clientY: 0 }) // baseline spread = 100
    canvas.emit('pointermove', { pointerId: 2, clientX: 640, clientY: 0 }) // spread 100 → 140 = +40
    expect(consume_pinch()).toBeCloseTo(40, 6)
  })

  it('emits nothing on the second touchdown itself (baseline frame is delta-free)', () => {
    const canvas = make_canvas()
    create_touch_look(canvas)
    canvas.emit('pointerdown', { pointerId: 1, clientX: 500, clientY: 0 })
    canvas.emit('pointerdown', { pointerId: 2, clientX: 600, clientY: 0 })
    expect(consume_pinch()).toBe(0)
    expect(consume_look()).toEqual({ dx: 0, dy: 0 }) // a pinch never leaks into look
  })

  it('lifting one finger ends the pinch; the survivor drives look again cleanly', () => {
    const canvas = make_canvas()
    create_touch_look(canvas)
    canvas.emit('pointerdown', { pointerId: 1, clientX: 500, clientY: 0 })
    canvas.emit('pointerdown', { pointerId: 2, clientX: 600, clientY: 0 })
    canvas.emit('pointerup', { pointerId: 2, clientX: 600, clientY: 0 })
    consume_pinch() // drain whatever the pinch produced
    canvas.emit('pointermove', { pointerId: 1, clientX: 515, clientY: 0 }) // +15 look, no pinch
    expect(consume_look()).toEqual({ dx: 15, dy: 0 })
    expect(consume_pinch()).toBe(0)
  })
})

describe('gating (single source of truth: touch_input.is_active)', () => {
  it('a pointerdown while disarmed accumulates nothing', () => {
    set_armed(false)
    const canvas = make_canvas()
    create_touch_look(canvas)
    canvas.emit('pointerdown', { pointerId: 1, clientX: 500, clientY: 0 })
    canvas.emit('pointermove', { pointerId: 1, clientX: 550, clientY: 0 })
    expect(consume_look()).toEqual({ dx: 0, dy: 0 })
  })

  it('a pointerdown while a text field is focused accumulates nothing (D154)', () => {
    set_text_focused(true)
    const canvas = make_canvas()
    create_touch_look(canvas)
    canvas.emit('pointerdown', { pointerId: 1, clientX: 500, clientY: 0 })
    canvas.emit('pointermove', { pointerId: 1, clientX: 550, clientY: 0 })
    expect(consume_look()).toEqual({ dx: 0, dy: 0 })
  })

  it('a non-touch pointer (mouse/stylus) is ignored — desktop path untouched', () => {
    const canvas = make_canvas()
    create_touch_look(canvas)
    canvas.emit('pointerdown', { pointerId: 1, pointerType: 'mouse', clientX: 500, clientY: 0 })
    canvas.emit('pointermove', { pointerId: 1, pointerType: 'mouse', clientX: 550, clientY: 0 })
    expect(consume_look()).toEqual({ dx: 0, dy: 0 })
  })

  it('drops an in-flight drag when the active gate closes', () => {
    const canvas = make_canvas()
    create_touch_look(canvas)
    canvas.emit('pointerdown', { pointerId: 1, clientX: 500, clientY: 0 })
    set_armed(false)
    set_armed(true)
    canvas.emit('pointermove', { pointerId: 1, clientX: 550, clientY: 0 })
    expect(consume_look()).toEqual({ dx: 0, dy: 0 })
  })
})

describe('dispose', () => {
  it('detaches every listener', () => {
    const canvas = make_canvas()
    const look = create_touch_look(canvas)
    expect(canvas.count('pointerdown')).toBe(1)
    look.dispose()
    expect(canvas.count('pointerdown')).toBe(0)
    expect(canvas.count('pointermove')).toBe(0)
    expect(canvas.count('pointerup')).toBe(0)
    expect(canvas.count('pointercancel')).toBe(0)
  })
})
