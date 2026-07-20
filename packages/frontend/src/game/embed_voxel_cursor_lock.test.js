// DOUBLE-CLICK CURSOR LOCK — unit proof (this session): dblclick toggles native Pointer Lock on the world
// canvas, `pointerlockchange` is the SOLE source of truth for lock state (never a parallel boolean — an
// Esc/tab-switch/dev-tools force-exit must fire on_change(false) exactly like our own exit), and the
// fight-mode gate blocks the toggle entirely mid-fight. Same fake-DOM idiom as
// embed_voxel_fight_camera.test.js (bun has no real DOM/Pointer Lock API).

import { describe, expect, it, mock } from 'bun:test'

import { create_cursor_lock_toggle } from './embed_voxel_cursor_lock.js'

/** A minimal fake EventTarget (same idiom as embed_voxel_fight_camera.test.js's fake_target()). */
function fake_target() {
  const listeners = /** @type {Map<string, Set<(e: any) => void>>} */ (new Map())
  return {
    addEventListener(/** @type {string} */ type, /** @type {(e: any) => void} */ fn) {
      if (!listeners.has(type)) listeners.set(type, new Set())
      listeners.get(type)?.add(fn)
    },
    removeEventListener(/** @type {string} */ type, /** @type {(e: any) => void} */ fn) {
      listeners.get(type)?.delete(fn)
    },
    dispatch(/** @type {string} */ type, /** @type {any} */ evt = {}) {
      for (const fn of listeners.get(type) ?? []) fn(evt)
    },
  }
}

/** A fake canvas + its ownerDocument. requestPointerLock/exitPointerLock are mocked and DELIBERATELY do not
 *  mutate pointerLockElement themselves (real browsers confirm asynchronously via pointerlockchange) — each
 *  test flips pointerLockElement + dispatches 'pointerlockchange' itself to control the confirmation timing. */
function make_canvas() {
  const doc = /** @type {any} */ ({ ...fake_target(), pointerLockElement: null })
  const canvas = /** @type {any} */ ({ ...fake_target(), ownerDocument: doc })
  canvas.requestPointerLock = mock(() => undefined)
  doc.exitPointerLock = mock(() => undefined)
  return { canvas, doc }
}

describe('create_cursor_lock_toggle', () => {
  it('dblclick while unlocked requests pointer lock; the confirming pointerlockchange fires on_change(true)', () => {
    const { canvas, doc } = make_canvas()
    const changes = /** @type {boolean[]} */ ([])
    create_cursor_lock_toggle({ canvas, is_fight: () => false, on_change: v => changes.push(v) })

    canvas.dispatch('dblclick')
    expect(canvas.requestPointerLock).toHaveBeenCalledTimes(1)
    expect(changes).toEqual([]) // not yet — awaiting the browser's confirmation

    doc.pointerLockElement = canvas // the browser confirms
    doc.dispatch('pointerlockchange')
    expect(changes).toEqual([true])
  })

  it('a 2nd dblclick while locked exits pointer lock; the confirming change fires on_change(false)', () => {
    const { canvas, doc } = make_canvas()
    const changes = /** @type {boolean[]} */ ([])
    create_cursor_lock_toggle({ canvas, is_fight: () => false, on_change: v => changes.push(v) })

    canvas.dispatch('dblclick')
    doc.pointerLockElement = canvas
    doc.dispatch('pointerlockchange')
    expect(changes).toEqual([true])

    canvas.dispatch('dblclick')
    expect(doc.exitPointerLock).toHaveBeenCalledTimes(1)
    doc.pointerLockElement = null
    doc.dispatch('pointerlockchange')
    expect(changes).toEqual([true, false])
  })

  it('the fight-mode gate blocks the dblclick entirely — no request, no exit, no toast', () => {
    const { canvas, doc } = make_canvas()
    const changes = /** @type {boolean[]} */ ([])
    create_cursor_lock_toggle({ canvas, is_fight: () => true, on_change: v => changes.push(v) })

    canvas.dispatch('dblclick')
    expect(canvas.requestPointerLock).not.toHaveBeenCalled()
    expect(doc.exitPointerLock).not.toHaveBeenCalled()
    expect(changes).toEqual([])
  })

  it('pointerlockchange is the single source of truth: a force-exit with NO 2nd dblclick (Esc/tab-switch/dev-tools) still fires on_change(false)', () => {
    const { canvas, doc } = make_canvas()
    const changes = /** @type {boolean[]} */ ([])
    create_cursor_lock_toggle({ canvas, is_fight: () => false, on_change: v => changes.push(v) })

    canvas.dispatch('dblclick')
    doc.pointerLockElement = canvas
    doc.dispatch('pointerlockchange')
    expect(changes).toEqual([true])

    // the browser force-drops the lock on its own — never routes through our exitPointerLock call
    doc.pointerLockElement = null
    doc.dispatch('pointerlockchange')
    expect(changes).toEqual([true, false])
  })

  it('an unrelated pointerlockchange (never requested, never engaged) never fires on_change', () => {
    const { canvas, doc } = make_canvas()
    const changes = /** @type {boolean[]} */ ([])
    create_cursor_lock_toggle({ canvas, is_fight: () => false, on_change: v => changes.push(v) })

    doc.pointerLockElement = /** @type {any} */ ({}) // some other element got locked
    doc.dispatch('pointerlockchange')
    expect(changes).toEqual([])
  })

  it('dispose() while engaged releases the lock and detaches listeners (no further changes)', () => {
    const { canvas, doc } = make_canvas()
    const changes = /** @type {boolean[]} */ ([])
    const toggle = create_cursor_lock_toggle({ canvas, is_fight: () => false, on_change: v => changes.push(v) })

    canvas.dispatch('dblclick')
    doc.pointerLockElement = canvas
    doc.dispatch('pointerlockchange')
    expect(changes).toEqual([true])

    toggle.dispose()
    expect(doc.exitPointerLock).toHaveBeenCalledTimes(1)

    doc.pointerLockElement = null
    doc.dispatch('pointerlockchange')
    canvas.dispatch('dblclick')
    expect(changes).toEqual([true]) // listeners detached — nothing further recorded
  })
})
