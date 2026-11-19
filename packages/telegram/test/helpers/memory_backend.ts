// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { RecordBackend } from '../../src/secure_records.ts'

/** Disposable stand-in for the Redis backend: same compare-and-set and absolute-expiry semantics. */
export const memory_backend = (now: () => number = Date.now): RecordBackend => {
  const rows = new Map<string, Readonly<{ raw: string; expires_at: number | null }>>()
  const live = (id: string) => {
    const row = rows.get(id)
    return row && (row.expires_at === null || row.expires_at > now()) ? row.raw : null
  }
  return {
    get: async (ids) => ids.map(live),
    commit: async (expected, writes) => {
      if (expected.some(({ id, raw }) => live(id) !== raw)) return false
      for (const { id, raw, expires_at } of writes)
        if (raw === null) rows.delete(id)
        else rows.set(id, { raw, expires_at })
      return true
    },
    ids: async (prefix) => [...rows.keys()].filter((id) => id.startsWith(prefix) && live(id) !== null).toSorted(),
  }
}
