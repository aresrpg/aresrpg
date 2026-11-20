// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

/** An unverified claimed identity grants no capacity. A reservation follows its upgrade,
 * transport and verifier until all unverified work ends, even if its socket closes first.
 * One visitor holds at most `per_visitor` of the pod's `limit` (audit SERVER-1); a request
 * without a visitor came from inside the cluster and meets only the pod limit. */
export const create_pending_admission = (limit = 64, per_visitor = 4) => {
  let pending = 0
  const held = new Map<string, number>()
  const hold = (visitor: string | null, delta: number): void => {
    if (visitor === null) return
    const count = (held.get(visitor) ?? 0) + delta
    if (count > 0) held.set(visitor, count)
    else held.delete(visitor)
  }
  return {
    size: () => pending,
    reserve: (visitor: string | null = null): (() => void) | null => {
      if (pending >= limit || (visitor !== null && (held.get(visitor) ?? 0) >= per_visitor)) return null
      pending += 1
      hold(visitor, 1)
      let released = false
      return () => {
        if (released) return
        released = true
        pending -= 1
        hold(visitor, -1)
      }
    },
  }
}
