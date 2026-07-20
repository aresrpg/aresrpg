// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Position-trace tap — records tactical entity world trajectories at a throttled rate, so the driven
// oracle can assert entities are at the RIGHT PLACE THROUGHOUT a move, not just at its endpoints —
// every glb position gets logged every frame, so movements are checked at every intermediate frame,
// not just at rest (the outcome-only suite let snap-then-run pass). DEFAULT OFF, flag-gated — dormant in prod at
// one boolean per tick, zero allocations (the caller skips the whole capture unless enabled).
//
// Split by responsibility: `create_pos_trace` is the PURE core (throttle + ring cap, injectable now/sink
// → unit-tested headless); `install_pos_trace` is the effectful EDGE that reads the flag and hangs the
// sink + reset on `window` (the same bench-hook idiom as renderer.js's `window.__motion_blur`).

const DEFAULT_HZ = 15 // samples/second — enough to catch mid-walk position, far below the 60fps frame rate
const DEFAULT_CAP = 20000 // ring size — a bounded array, never an unbounded leak across a long session

/**
 * The reused flag idiom (renderer.js `ares_flag`): a `__ARES_*` global — set by the Playwright bench via
 * addInitScript BEFORE app boot — OR a `?postrace=1` URL convenience. Off-sentinels (undefined/0/false/'0')
 * read as OFF so an explicit `=0` disable and the absent case behave identically.
 * @returns {boolean}
 */
export function pos_trace_enabled() {
  const g = /** @type {any} */ (typeof globalThis !== 'undefined' ? globalThis : {}).__ARES_POS_TRACE_ON
  if (g !== undefined && g !== 0 && g !== false && g !== '0') return true
  return typeof location !== 'undefined' && new URLSearchParams(location.search).get('postrace') === '1'
}

/**
 * @typedef {object} PosSample
 * @property {string} id entity id
 * @property {{ x: number, y: number } | null} cell current logical board cell (null if unknown)
 * @property {number} x world position
 * @property {number} y world position
 * @property {number} z world position
 */

/**
 * Creates a throttled trajectory recorder. Pure over its injected `now` + `sink`, so the throttle and the
 * ring cap are unit-testable without a clock or a DOM. Appends `{ t, id, cell, x, y, z }` records into the
 * sink array, dropping the OLDEST once it would exceed `cap`.
 *
 * @param {object} [opts]
 * @param {boolean} [opts.enabled] gate — a disabled recorder writes nothing (the prod default)
 * @param {any[]} [opts.sink] the backing array to append into (defaults to a fresh array)
 * @param {number} [opts.hz] sample rate ceiling (Hz)
 * @param {number} [opts.cap] max retained records (ring size)
 * @param {() => number} [opts.now] monotonic clock in ms (injected for tests; `performance.now` by default)
 */
export function create_pos_trace({
  enabled = false,
  sink = [],
  hz = DEFAULT_HZ,
  cap = DEFAULT_CAP,
  now = () => performance.now(),
} = {}) {
  const interval_ms = 1000 / hz
  let last = -Infinity
  return {
    enabled,
    buffer: sink,
    /**
     * Records this frame's samples IF the throttle interval has elapsed. `collect` is a thunk invoked
     * ONLY when a sample is due, so the projection cost is paid at the throttled rate, never per frame.
     * @param {() => Iterable<PosSample>} collect
     */
    record(collect) {
      if (!enabled) return
      const t = now()
      if (t - last < interval_ms) return
      last = t
      for (const s of collect()) sink.push({ t, id: s.id, cell: s.cell, x: s.x, y: s.y, z: s.z })
      if (sink.length > cap) sink.splice(0, sink.length - cap) // ring: evict the oldest overflow in one pass
    },
    /** Clears the buffer IN PLACE (a held sink reference stays valid) and re-arms the throttle — the
     *  per-turn scoping hook the spec calls via window.__ARES_POS_TRACE_RESET(). */
    reset() {
      sink.length = 0
      last = -Infinity
    },
  }
}

/**
 * The effectful edge: reads the flag and, when enabled, exposes the sink at `window.__ARES_POS_TRACE`
 * (reused across board instances so a bench can hold the reference) plus `window.__ARES_POS_TRACE_RESET()`.
 * Disabled ⇒ returns an inert recorder and touches NO globals (zero prod footprint beyond this one call).
 * @param {Parameters<typeof create_pos_trace>[0]} [opts] test override — `enabled` forces the gate
 * @returns {ReturnType<typeof create_pos_trace>}
 */
export function install_pos_trace(opts = {}) {
  const enabled = opts.enabled ?? pos_trace_enabled()
  if (!enabled) return create_pos_trace({ ...opts, enabled: false })
  const w = /** @type {any} */ (typeof window !== 'undefined' ? window : globalThis)
  const sink = Array.isArray(w.__ARES_POS_TRACE) ? w.__ARES_POS_TRACE : (w.__ARES_POS_TRACE = [])
  const trace = create_pos_trace({ ...opts, enabled: true, sink })
  w.__ARES_POS_TRACE_RESET = () => trace.reset()
  return trace
}
