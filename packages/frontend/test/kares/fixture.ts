// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { KARES_SUPPLY, KARES_UNIT } from '@aresrpg/sdk/kares-economics'

import { initial_wallet_state } from '../../src/wallet/model.ts'
import { initial_finance, type FinanceSession, type FinanceSnapshot, type FinanceState } from '../../src/kares/model.ts'

/** Synthetic presentation inputs, never a wire-decoder or chain-execution fixture. */
export const finance_snapshot = (): FinanceSnapshot => ({
  network: 'testnet',
  address: '0xparticipant',
  clock_ms: 150n,
  combat_pot: {
    authorized: '0x1::fight_rewards::BossVictory',
    id: '0xcombat',
    version: '1',
    balance: 0n,
    quota: 20_000n,
    spent: 0n,
  },
  total_supply: KARES_SUPPLY,
  community: {
    id: '0xcommunity',
    version: '1',
    started_ms: 0n,
    remaining: 110_000_000n * KARES_UNIT,
    claimable: 0n,
    treasury: '0xtreasury',
  },
  pool: {
    id: '0xpool',
    version: '1',
    active: true,
    total_staked: 100n * KARES_UNIT,
    active_ms: 100n,
    initial_remaining: 200_000n * KARES_UNIT,
    kares_rewards: 0n,
    sui_rewards: 0n,
    daily_kares: 5_000_000_000n,
    daily_sui: 2_500_000_000n,
  },
  positions: [
    {
      id: '0xstake-one',
      version: '1',
      amount: 10n * KARES_UNIT,
      pending_kares: KARES_UNIT,
      pending_sui: 2n * KARES_UNIT,
    },
    {
      id: '0xstake-two',
      version: '1',
      amount: 20n * KARES_UNIT,
      pending_kares: 3n * KARES_UNIT,
      pending_sui: 4n * KARES_UNIT,
    },
  ],
})

export const finance_session = (): FinanceSession => ({
  address: '0xparticipant',
  kares: {} as never,
})
export const finance_state = (snapshot = finance_snapshot()): FinanceState => ({
  ...initial_finance(snapshot.address),
  snapshot,
  balances: { kares_balance: 7n * KARES_UNIT, sui_balance: 9n * KARES_UNIT },
})

export const wallet_view = (address: string | null = null) => ({
  state: {
    ...initial_wallet_state(),
    accounts: address ? [{ address, wallet_name: 'Test wallet' }] : [],
    session: address ? { address, wallet_name: 'Test wallet', disconnect: async () => undefined } : null,
  },
  dispatch: () => undefined,
})
