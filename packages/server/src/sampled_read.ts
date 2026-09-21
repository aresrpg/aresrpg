// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

/** Lazy, bounded per-key samples. Viewers share pending work; rejected samples also respect the refresh limit. */
export const sampled_read = <Value>(
  read: (key: string, at_ms: number) => Promise<Value>,
  max_age_ms: number,
  now: () => number = Date.now
) => {
  const cache = new Map<string, { expires: number; value: Promise<Value> }>()
  return (key: string, at_ms = now()): Promise<Value> => {
    const cached = cache.get(key)
    if (cached && cached.expires > now()) return cached.value
    if (cache.size >= 512) cache.delete(cache.keys().next().value!)
    const entry = { expires: Number.POSITIVE_INFINITY, value: read(key, at_ms) }
    entry.value = entry.value.finally(() => {
      entry.expires = now() + max_age_ms
    })
    cache.set(key, entry)
    return entry.value
  }
}
