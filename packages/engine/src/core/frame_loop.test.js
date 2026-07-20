import { describe, expect, test } from 'bun:test'

import { create_frame_loop } from './frame_loop.js'

function create_visibility_document(initial_hidden = false) {
  const listeners = /** @type {Set<()=>void>} */ (new Set())
  return {
    hidden: initial_hidden,
    visibilityState: initial_hidden ? 'hidden' : 'visible',
    addEventListener(/** @type {string} */ _event, /** @type {()=>void} */ callback) {
      listeners.add(callback)
    },
    removeEventListener(/** @type {string} */ _event, /** @type {()=>void} */ callback) {
      listeners.delete(callback)
    },
    set_hidden(/** @type {boolean} */ hidden) {
      this.hidden = hidden
      this.visibilityState = hidden ? 'hidden' : 'visible'
      for (const callback of listeners) callback()
    },
    listener_count: () => listeners.size,
  }
}

function create_frame_driver() {
  const frames = /** @type {Map<number,FrameRequestCallback>} */ (new Map())
  let next_id = 1
  return {
    request(/** @type {FrameRequestCallback} */ callback) {
      const id = next_id++
      frames.set(id, callback)
      return id
    },
    cancel(/** @type {number} */ id) {
      frames.delete(id)
    },
    run(/** @type {number} */ at) {
      const next = frames.entries().next().value
      if (!next) throw new Error('no pending frame')
      const [id, callback] = next
      frames.delete(id)
      callback(at)
    },
    pending: () => frames.size,
  }
}

describe('frame loop CPU lifecycle', () => {
  test('does no render work while hidden and resumes from a fresh clock', () => {
    const visibility_document = create_visibility_document()
    const driver = create_frame_driver()
    let clock = 0
    /** @type {number[]} */
    const rendered_deltas = []
    const loop = create_frame_loop({
      on_sim_step: () => {},
      on_render: (_alpha, dt) => rendered_deltas.push(dt),
      visibility_document,
      now: () => clock,
      request_frame: (callback) => driver.request(callback),
      cancel_frame: (id) => driver.cancel(id),
    })

    loop.start()
    expect(driver.pending()).toBe(1)
    expect(visibility_document.listener_count()).toBe(1)
    driver.run(16)
    expect(rendered_deltas).toEqual([0.016])

    visibility_document.set_hidden(true)
    expect(driver.pending()).toBe(0)
    clock = 5_000
    visibility_document.set_hidden(false)
    expect(driver.pending()).toBe(1)
    driver.run(5_016)
    expect(rendered_deltas).toEqual([0.016, 0.016])

    loop.stop()
    expect(driver.pending()).toBe(0)
    expect(visibility_document.listener_count()).toBe(0)
  })

  test('does not schedule an initial frame while the document is hidden', () => {
    const visibility_document = create_visibility_document(true)
    const driver = create_frame_driver()
    const loop = create_frame_loop({
      on_sim_step: () => {},
      on_render: () => {},
      visibility_document,
      now: () => 0,
      request_frame: (callback) => driver.request(callback),
      cancel_frame: (id) => driver.cancel(id),
    })
    loop.start()
    expect(driver.pending()).toBe(0)
    loop.stop()
  })

  test('updates one stable stats snapshot only after frames arrive', () => {
    const driver = create_frame_driver()
    const loop = create_frame_loop({
      on_sim_step: () => {},
      on_render: () => {},
      visibility_document: null,
      now: () => 0,
      request_frame: (callback) => driver.request(callback),
      cancel_frame: (id) => driver.cancel(id),
    })
    const before = loop.get_frame_stats()
    expect(before.fps).toBe(0)
    loop.start()
    driver.run(20)
    const after = loop.get_frame_stats()
    expect(after).toBe(before)
    expect(after.fps).toBe(50)
    expect(loop.get_frame_stats()).toBe(after)
    loop.stop()
  })
})
