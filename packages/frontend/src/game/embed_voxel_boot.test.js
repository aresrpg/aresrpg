// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { create_boot_veil } from './embed_voxel_boot.js'

const real_document = globalThis.document
const real_set_timeout = globalThis.setTimeout
const real_clear_timeout = globalThis.clearTimeout
const real_set_interval = globalThis.setInterval
const real_clear_interval = globalThis.clearInterval

/** @type {Array<() => void>} */
let intervals

beforeEach(() => {
  intervals = []
  globalThis.document = /** @type {any} */ ({
    createElement: () => ({ style: {}, remove() {} }),
  })
  globalThis.setTimeout = /** @type {any} */ (() => 1)
  globalThis.clearTimeout = /** @type {any} */ (() => {})
  globalThis.setInterval = /** @type {any} */ ((fn) => {
    intervals.push(fn)
    return intervals.length
  })
  globalThis.clearInterval = /** @type {any} */ (() => {})
})

afterEach(() => {
  globalThis.document = real_document
  globalThis.setTimeout = real_set_timeout
  globalThis.clearTimeout = real_clear_timeout
  globalThis.setInterval = real_set_interval
  globalThis.clearInterval = real_clear_interval
})

describe('boot veil feet-column gate', () => {
  test('the resolved spawn column clears before any focus_ready event', () => {
    /** @type {[number, number, number]} */
    let spawn = [3.5, 138, 4.5]
    /** @type {[number, number] | null} */
    let sampled = null
    const engine = {
      on() {},
      get_stats: () => ({ resident_chunks: 12, fps: 0 }),
      is_column_resident: (x, z) => {
        sampled = [x, z]
        return x === 8 && z === 0
      },
      set_time_of_day() {},
    }
    const veil = create_boot_veil({
      engine,
      container: { appendChild() {} },
      spectate: false,
      world_spawn: () => spawn,
    })
    expect(veil.ready()).toBe(false)
    expect(sampled).toEqual([3, 4])

    spawn = [8.5, 138, 0.5]
    intervals[0]() // the 250 ms pull belt; no load_progress/focus_ready event fired
    expect(sampled).toEqual([8, 0])
    expect(veil.ready()).toBe(true)
  })
})
