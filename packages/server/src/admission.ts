// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

/** An unverified claimed identity grants no capacity. A reservation follows its upgrade,
 * transport and verifier until all unverified work ends, even if its socket closes first. */
export const create_pending_admission = (limit = 64) => {
  let pending = 0
  return {
    size: () => pending,
    reserve: (): (() => void) | null => {
      if (pending >= limit) return null
      pending += 1
      let released = false
      return () => {
        if (released) return
        released = true
        pending -= 1
      }
    },
  }
}
