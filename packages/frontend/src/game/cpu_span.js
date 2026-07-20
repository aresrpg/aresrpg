// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Opt-in bridge from frontend-owned animation callbacks to the engine CPU probe. The disabled path returns the
// original callback by identity: no clock reads, events, wrapper allocation, observer, or timer in the hot loop.

/** @returns {string} */
const current_search = () => (typeof location === 'undefined' ? '' : location.search)

/** @param {string} system @param {number} start_ms @param {number} end_ms */
const emit_span = (system, start_ms, end_ms) => {
  const target = /** @type {{__ares_cpu_span?: (system:string,start_ms:number,end_ms:number)=>void}} */ (globalThis)
  target.__ares_cpu_span?.(system, start_ms, end_ms)
}

/**
 * Return `callback` unchanged unless the exact `?cpu=1` opt-in is present. Enabled wrappers close their span in
 * `finally`, so an exception remains attributable and propagates with byte-identical control flow.
 * @template {(...args:any[])=>any} T
 * @param {'scene'|'render'} system
 * @param {T} callback
 * @param {{search?:string,now?:()=>number,emit?:(system:string,start_ms:number,end_ms:number)=>void}} [options]
 * @returns {T}
 */
export function instrument_cpu_callback(system, callback, options = {}) {
  const search = options.search ?? current_search()
  if (new URLSearchParams(search).get('cpu') !== '1') return callback
  const now = options.now ?? (() => performance.now())
  const emit = options.emit ?? emit_span
  return /** @type {T} */ (
    /** @type {unknown} */ (
      (...args) => {
        const start_ms = now()
        try {
          return callback(...args)
        } finally {
          emit(system, start_ms, now())
        }
      }
    )
  )
}
