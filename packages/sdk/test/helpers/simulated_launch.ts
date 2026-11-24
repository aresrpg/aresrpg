// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { LIQUIDITY_LOCK_ADDRESS, type CurrencyLaunch } from '../../src/kares_launch.ts'

import { id } from './transport.ts'

/** The chain's account of a correct launch: pool shared, liquidity at the lock address, team share kept. */
export const simulated_launch = (terms: CurrencyLaunch, treasury: string) => {
  const token = terms.publication.liquidity_token_type
  return {
    Transaction: {
      objectTypes: {
        [id(30)]: `${terms.aftermath.dao_fee_types}::pool::DaoFeePool<${token}>`,
        [id(31)]: `${terms.aftermath.dao_fee_types}::pool::OwnerCap<${token}>`,
        [id(32)]: `0x2::coin::Coin<${token}>`,
      },
      effects: {
        status: { success: true },
        changedObjects: [
          { objectId: id(30), outputOwner: { Shared: { initialSharedVersion: '90' } } },
          { objectId: id(31), outputOwner: { AddressOwner: treasury } },
          { objectId: id(32), outputOwner: { AddressOwner: LIQUIDITY_LOCK_ADDRESS } },
        ],
      },
      balanceChanges: [
        { coinType: '0x2::sui::SUI', address: treasury, amount: String(-(terms.seed_sui + 40_000_000n)) },
        { coinType: terms.publication.coin_type, address: treasury, amount: '50000000000000000' },
        { coinType: token, address: LIQUIDITY_LOCK_ADDRESS, amount: '7000000' },
      ],
    },
  }
}
