// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// A mount-GLB cache with two explicit states: pending work and resolved render data. Keeping these separate is
// what lets fast travel make a hard promise: its warm-only spawn edge may consume only resolved data, never
// start or wait on a cold fetch. Failed work is evicted and remains retryable; an outage is never cached as
// permanent truth.

/**
 * @template T
 * @param {(url:string) => Promise<T>} load
 * @returns {{
 *   preload: (url:string) => Promise<T>,
 *   read: (url:string) => T | null,
 *   for_spawn: (url:string, options?:{ warm_only?:boolean }) => Promise<T>
 * }}
 */
export function create_mount_glb_cache(load) {
  /** @type {Map<string, Promise<T>>} */
  const pending = new Map()
  /** @type {Map<string, T>} */
  const resolved = new Map()

  const preload = (/** @type {string} */ url) => {
    const ready = resolved.get(url)
    if (ready) return Promise.resolve(ready)
    const current = pending.get(url)
    if (current) return current

    const started = load(url)
      .then((asset) => {
        pending.delete(url)
        resolved.set(url, asset)
        return asset
      })
      .catch((error) => {
        pending.delete(url)
        throw error
      })
    pending.set(url, started)
    return started
  }

  const read = (/** @type {string} */ url) => resolved.get(url) ?? null

  const for_spawn = (/** @type {string} */ url, { warm_only = false } = {}) => {
    const ready = read(url)
    if (ready) return Promise.resolve(ready)
    if (warm_only) return Promise.reject(new Error(`mount GLB was not preloaded: ${url}`))
    const current = pending.get(url)
    if (current) return current
    return preload(url)
  }

  return { preload, read, for_spawn }
}
