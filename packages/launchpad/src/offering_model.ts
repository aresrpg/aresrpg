// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { KARES_ALLOCATION, KARES_UNIT, KARES_LAUNCH_AVAILABLE } from '@aresrpg/sdk/kares-economics'
import { offering_phase, type FinanceSnapshot } from '@aresrpg/frontend/finance'

/** Preview the actual per-position floors; summing deposits before rounding can overstate claims. */
export const offering_preview = (snapshot: FinanceSnapshot) => {
  const { offering, contributions } = snapshot
  const deposited = offering.total_contributed
  const accepted = deposited < offering.max_raise ? deposited : offering.max_raise
  const phase = offering_phase(snapshot)
  const refundable = phase === 'refundable'
  const minimum_met = deposited >= offering.min_raise
  const allocation_ready = minimum_met && !refundable
  const entitled = contributions.reduce(
    (total, position) => {
      const refund = refundable
        ? position.amount
        : deposited > 0n
          ? (position.amount * (deposited - accepted)) / deposited
          : 0n
      const tokens = allocation_ready && deposited > 0n ? (position.amount * KARES_ALLOCATION.offering) / deposited : 0n
      return {
        contribution: total.contribution + position.amount,
        refund: total.refund + refund,
        tokens: total.tokens + tokens,
      }
    },
    { contribution: 0n, refund: 0n, tokens: 0n }
  )
  const price_status: 'refunded' | 'unavailable' | 'final' | 'preview' = refundable
    ? 'refunded'
    : !minimum_met
      ? 'unavailable'
      : phase === 'successful'
        ? 'final'
        : 'preview'
  return {
    price_status,
    phase,
    deposited,
    accepted,
    ...entitled,
    net_contribution: entitled.contribution - entitled.refund,
    price: !allocation_ready ? null : (accepted * KARES_UNIT) / KARES_ALLOCATION.offering,
    launch_market_cap: !allocation_ready ? null : (accepted * KARES_LAUNCH_AVAILABLE) / KARES_ALLOCATION.offering,
    minimum_met,
    allocation_ready,
    oversubscribed: deposited > offering.max_raise,
    progress: Number((accepted * 10_000n) / offering.max_raise) / 100,
    minimum_marker: Number((offering.min_raise * 10_000n) / offering.max_raise) / 100,
    subscription_hundredths: (deposited * 100n) / offering.max_raise,
  }
}

export const subscription_ratio = (hundredths: bigint): string =>
  `${hundredths / 100n}.${(hundredths % 100n).toString().padStart(2, '0')}×`
