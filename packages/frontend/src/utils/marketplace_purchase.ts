// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Pure marketplace affordability model. The wallet debit is seller ask + the universal royalty, while the
// shared house gas reserve stays untouched. UI controls and the write-store edge consume this same verdict.

import { aresrpg_id } from '@aresrpg/sdk/deployment/aresrpg'

import { DEMO_NETWORK } from '../chain/deployment'

import { GAS_RESERVE_MIST } from './sui_mist'

const royalty_min_stamp = aresrpg_id(DEMO_NETWORK, 'ITEM_ROYALTY_MIN_MIST')
export const MARKETPLACE_ROYALTY_MIN_MIST = royalty_min_stamp ? BigInt(royalty_min_stamp) : null

export type MarketplacePurchaseBalanceState = 'unknown' | 'insufficient_balance' | 'ready'

// The live universal policy is 1000bp with a stamped floor. royalty_rule::fee_amount takes the higher of
// percentage and floor; this is the exact value the marketplace builder splits from the wallet before gas.
export function marketplace_purchase_total_mist(
  ask_mist: bigint,
  royalty_min_mist: bigint,
  royalty_bp = 1000n
): { royalty_mist: bigint; total_mist: bigint } {
  const percentage = (ask_mist * royalty_bp) / 10_000n
  const royalty_mist = percentage > royalty_min_mist ? percentage : royalty_min_mist
  return { royalty_mist, total_mist: ask_mist + royalty_mist }
}

export function marketplace_purchase_required_mist(
  ask_mist: bigint,
  royalty_min_mist: bigint | null = MARKETPLACE_ROYALTY_MIN_MIST
): bigint | null {
  if (royalty_min_mist == null) return null
  return marketplace_purchase_total_mist(ask_mist, royalty_min_mist).total_mist + GAS_RESERVE_MIST
}

export function marketplace_purchase_balance_state(
  balance_mist: bigint | null,
  ask_mist: bigint,
  royalty_min_mist: bigint | null = MARKETPLACE_ROYALTY_MIN_MIST
): MarketplacePurchaseBalanceState {
  const required_mist = marketplace_purchase_required_mist(ask_mist, royalty_min_mist)
  if (balance_mist == null || required_mist == null) return 'unknown'
  return balance_mist < required_mist ? 'insufficient_balance' : 'ready'
}
