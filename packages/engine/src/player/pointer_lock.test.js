// PointerLockControls — release-provenance regression test (this session). The world canvas's double-click
// sticky lock (packages/frontend/src/game/embed_voxel_cursor_lock.js) can put THIS SAME element into pointer
// lock without ever calling requestPointerLock() from inside this module. Before this fix, on_mouseup exited
// ANY active lock unconditionally on every left-button release — so releasing an ordinary gameplay click
// while that external lock was up would silently kick the pointer back out. The fix: only the drag that
// itself requested the current lock may release it on mouseup. Same fake-DOM idiom as
// embed_voxel_fight_camera.test.js (bun has no real DOM).

import { describe, expect, it } from 'bun:test'

import { PointerLockControls } from './pointer_lock.js'

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

/** A fake canvas element + its ownerDocument (bun has no real DOM/Pointer Lock API). */
function make_element() {
  const doc = /** @type {any} */ ({ ...fake_target(), pointerLockElement: null })
  const el = /** @type {any} */ ({ ...fake_target(), ownerDocument: doc })
  let lock_calls = 0
  let exit_calls = 0
  el.requestPointerLock = () => {
    lock_calls += 1 // real browsers confirm asynchronously — tests dispatch pointerlockchange manually
  }
  doc.exitPointerLock = () => {
    exit_calls += 1
    doc.pointerLockElement = null
    doc.dispatch('pointerlockchange')
  }
  return { el, doc, calls: () => ({ lock_calls, exit_calls }) }
}

/** @returns {any} a fresh fake `window`, installed as globalThis.window for PointerLockControls' own
 *  `window.addEventListener` calls; returned already `any`-typed so a test can `.dispatch(...)` on it without
 *  fighting the DOM lib's Window type (this package's tsconfig has checkJs on). */
function fresh_window() {
  const w = /** @type {any} */ (fake_target())
  globalThis.window = w
  return w
}

const mouse = (/** @type {Record<string, any>} */ overrides = {}) => ({
  button: 0,
  clientX: 0,
  clientY: 0,
  movementX: 0,
  movementY: 0,
  ...overrides,
})

describe('PointerLockControls — release-provenance gate', () => {
  it('original hold-drag flow is unchanged: past-threshold drag locks, mousemove rotates, release exits', () => {
    const win = fresh_window()
    const { el, doc, calls } = make_element()
    const rotations = /** @type {number[][]} */ ([])
    const controls = PointerLockControls({ on_rotate: (dx, dy) => rotations.push([dx, dy]) })
    controls.attach(el)

    el.dispatch('mousedown', mouse({ clientX: 0, clientY: 0 }))
    win.dispatch('mousemove', mouse({ clientX: 20, clientY: 0 })) // past the 6px threshold
    expect(calls().lock_calls).toBe(1)

    doc.pointerLockElement = el // the browser confirms
    doc.dispatch('pointerlockchange')
    win.dispatch('mousemove', mouse({ movementX: 5, movementY: -2 }))
    expect(rotations).toEqual([[5, -2]])

    win.dispatch('mouseup', mouse())
    expect(calls().exit_calls).toBe(1) // this drag's own lock — release exits it (unchanged behavior)
  })

  it('a lock engaged by an external caller still free-feeds rotate, but an ordinary click release never exits it', () => {
    const win = fresh_window()
    const { el, doc, calls } = make_element()
    const rotations = /** @type {number[][]} */ ([])
    const controls = PointerLockControls({ on_rotate: (dx, dy) => rotations.push([dx, dy]) })
    controls.attach(el)

    // an EXTERNAL caller locks the same element (the world canvas's dblclick sticky toggle) — this
    // module never called requestPointerLock for it.
    doc.pointerLockElement = el
    doc.dispatch('pointerlockchange')
    expect(calls().lock_calls).toBe(0) // proves this module did not request it

    win.dispatch('mousemove', mouse({ movementX: 7, movementY: 3 }))
    expect(rotations).toEqual([[7, 3]]) // still free-feeds rotation — the input-source swap the feature relies on

    // a plain gameplay click: press + release, zero movement — must NOT release the externally-owned lock
    el.dispatch('mousedown', mouse({ clientX: 100, clientY: 100 }))
    win.dispatch('mouseup', mouse({ clientX: 100, clientY: 100 }))
    expect(calls().exit_calls).toBe(0)
    expect(doc.pointerLockElement).toBe(el) // still locked — the sticky toggle owns its own exit
  })
})
