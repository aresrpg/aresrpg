// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
export type BoundedMemo<K, V> = Readonly<{ get: (key: K, create: () => V) => V }>

/** Batched FIFO memo: hits stay cheap without paying an iterator allocation on every advancing miss. */
export const create_bounded_memo = <K, V>(capacity: number): BoundedMemo<K, V> => {
  const values = new Map<K, V>()
  return Object.freeze({
    get: (key: K, create: () => V): V => {
      if (values.has(key)) return values.get(key) as V
      if (values.size >= capacity) {
        const oldest = values.keys()
        const count = Math.max(1, Math.floor(capacity / 4))
        for (let removed = 0; removed < count; removed += 1) {
          const entry = oldest.next()
          if (entry.done) break
          values.delete(entry.value)
        }
      }
      const value = create()
      values.set(key, value)
      return value
    },
  })
}
