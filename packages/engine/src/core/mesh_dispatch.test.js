import { describe, expect, test } from 'bun:test'

import { create_chunk_record } from '../chunks/format.js'
import { coord_key } from '../chunks/store.js'

import { create_mesh_dispatcher } from './mesh_dispatch.js'

/** @typedef {[number, number, number]} ChunkCoord */

/**
 * @param {object} [options]
 * @param {boolean} [options.slice_results]
 * @param {number} [options.integration_cost_ms]
 * @param {() => number} [options.now]
 */
function create_harness({ slice_results = true, integration_cost_ms = 0, now: clock_now } = {}) {
  let clock = 0
  const coords = /** @type {ChunkCoord[]} */ ([
    [0, 0, 0],
    [1, 0, 0],
    [3, 0, 0],
  ])
  const records = new Map(coords.map(([cx, cy, cz]) => [coord_key(cx, cy, cz), create_chunk_record(cx, cy, cz)]))
  const phase = new Map(coords.map(([cx, cy, cz]) => [coord_key(cx, cy, cz), 'mesh']))
  /** @type {Array<{payload: any, resolve: (result: unknown) => void}>} */
  const jobs = []
  /** @type {ChunkCoord[]} */
  const integrated = []
  /** @type {number[]} */
  const timings = []
  const now = clock_now ?? (() => clock)
  const store = {
    get(/** @type {number} */ cx, /** @type {number} */ cy, /** @type {number} */ cz) {
      return records.get(coord_key(cx, cy, cz))
    },
    get_resident(/** @type {number} */ cx, /** @type {number} */ cy, /** @type {number} */ cz) {
      return records.get(coord_key(cx, cy, cz))
    },
  }
  const mesh_pool = {
    submit(/** @type {string} */ _type, /** @type {any} */ payload) {
      return new Promise((resolve) => jobs.push({ payload, resolve }))
    },
  }
  const dispatcher = create_mesh_dispatcher({
    mesh_pool: /** @type {any} */ (mesh_pool),
    store,
    phase,
    render_fins: false,
    max_in_flight: 8,
    integrate(coord, key) {
      integrated.push(coord)
      phase.set(key, 'live')
      clock += integration_cost_ms
    },
    requeue() {},
    priority(coord, center) {
      const dx = coord[0] - center[0]
      const dy = coord[1] - center[1]
      const dz = coord[2] - center[2]
      return dx * dx + dy * dy + dz * dz
    },
    slice_results,
    on_integration: (elapsed_ms) => timings.push(elapsed_ms),
    now,
  })

  return {
    coords,
    dispatcher,
    integrated,
    timings,
    jobs,
    resolve_reverse() {
      const pending = jobs.splice(0, jobs.length)
      for (let i = pending.length - 1; i >= 0; i -= 1) {
        const job = pending[i]
        job.resolve({ quad_buffer: new Uint32Array(0), quad_count: 0 })
      }
    },
  }
}

describe('mesh worker reply integration slice', () => {
  test('admits one giant result, carries the rest, and retains nearest-first priority', async () => {
    const harness = create_harness({ integration_cost_ms: 4 })
    harness.dispatcher.dispatch([...harness.coords], [0, 0, 0], 8, 99)
    harness.resolve_reverse() // far reply arrives first; current-camera priority must still win
    await Promise.resolve()

    expect(harness.dispatcher.in_flight()).toBe(3)
    expect(harness.dispatcher.drain_results([0, 0, 0])).toBe(4)
    expect(harness.integrated).toEqual([[0, 0, 0]])
    expect(harness.dispatcher.in_flight()).toBe(2)

    expect(harness.dispatcher.drain_results([0, 0, 0])).toBe(4)
    expect(harness.integrated).toEqual([
      [0, 0, 0],
      [1, 0, 0],
    ])
    expect(harness.dispatcher.in_flight()).toBe(1)
    expect(harness.timings).toEqual([4, 4])
  })

  test('drops a reply forgotten after arrival and clears its pending count', async () => {
    const harness = create_harness()
    harness.dispatcher.dispatch([harness.coords[0]], [0, 0, 0], 1, 99)
    harness.resolve_reverse()
    await Promise.resolve()

    harness.dispatcher.forget(coord_key(0, 0, 0))
    expect(harness.dispatcher.drain_results([0, 0, 0])).toBe(0)
    expect(harness.integrated).toEqual([])
    expect(harness.dispatcher.in_flight()).toBe(0)
  })

  test('empty drain does not touch the clock', () => {
    let clock_reads = 0
    const harness = create_harness({
      now: () => {
        clock_reads += 1
        return 0
      },
    })
    expect(harness.dispatcher.drain_results([0, 0, 0])).toBe(0)
    expect(clock_reads).toBe(0)
  })

  test('disabled slice preserves immediate unsliced reply integration', async () => {
    const harness = create_harness({ slice_results: false, integration_cost_ms: 4 })
    harness.dispatcher.dispatch([...harness.coords], [0, 0, 0], 8, 99)
    harness.resolve_reverse()
    await Promise.resolve()

    expect(harness.integrated).toEqual([
      [3, 0, 0],
      [1, 0, 0],
      [0, 0, 0],
    ])
    expect(harness.dispatcher.in_flight()).toBe(0)
    expect(harness.dispatcher.drain_results([0, 0, 0])).toBe(0)
    expect(harness.timings).toEqual([4, 4, 4])
  })
})
