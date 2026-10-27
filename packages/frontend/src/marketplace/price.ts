// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { basis_points, marketplace_royalty_bps } from '@aresrpg/immutable'
import { ROYALTY_FLOOR_MIST } from '@aresrpg/sdk/marketplace'
import { GAS_BUDGET_MIST } from '@aresrpg/sdk/gas-budget'

export const buyer_total = (ask: bigint): bigint => {
  const royalty = (ask * BigInt(marketplace_royalty_bps)) / BigInt(basis_points)
  return ask + (royalty > ROYALTY_FLOOR_MIST ? royalty : ROYALTY_FLOOR_MIST)
}

export const market_needs_funding = (price: string, balance: bigint | null): boolean =>
  balance !== null && balance < buyer_total(BigInt(price)) + GAS_BUDGET_MIST
