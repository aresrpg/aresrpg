// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { Claim } from '@aresrpg/protocol'

/** Slots one budget of the door reserves: at most `limit` per pod, of which one visitor holds at
 * most `per_visitor`; a request without a visitor came from inside the cluster and
 * meets only the pod limit. Two budgets use it: unverified proofs (`pending`, held until all
 * unverified work ends, even if the socket closes first) and live views (non-seat sockets, held
 * from upgrade to close). */
export const create_admission_slots = (limit = 64, per_visitor = 4) => {
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

/** Live non-seat (open and signed) sockets one visitor address may hold. A carrier puts many phones
 *  behind one IPv4 address, so this is a flood guard; MAX_VIEWERS per pod is the real bound. */
export const VIEWS_PER_VISITOR = 64

/** What an admitted upgrade holds: proof work until verification, a view slot until close. */
export type UpgradeHold = Readonly<{ release_pending: () => void; release_view: () => void }>
const NOTHING = (): void => {}

/** Reserve one upgrade's budgets or refuse it whole. Every non-seat socket takes a view slot under
 * its visitor; every claimed address takes proof work; the seat is counted at promotion (MAX_PLAYERS). */
export const hold_upgrade = (
  stage: Claim['stage'],
  visitor: string | null,
  {
    pending,
    views,
  }: Readonly<{
    pending: ReturnType<typeof create_admission_slots>
    views: ReturnType<typeof create_admission_slots>
  }>
): UpgradeHold | null => {
  const release_view = stage === 'seated' ? NOTHING : views.reserve(visitor)
  if (!release_view) return null
  const release_pending = stage === 'open' ? NOTHING : pending.reserve(visitor)
  if (release_pending) return { release_pending, release_view }
  release_view()
  return null
}
