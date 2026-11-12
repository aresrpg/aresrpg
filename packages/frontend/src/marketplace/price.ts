// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { buyer_total } from '@aresrpg/sdk/marketplace'
import { GAS_BUDGET_MIST } from '@aresrpg/sdk/gas-budget'
export { buyer_total } from '@aresrpg/sdk/marketplace'

export const market_needs_funding = (price: string, balance: bigint | null): boolean =>
  balance !== null && balance < buyer_total(BigInt(price)) + GAS_BUDGET_MIST
