// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { AuthSession } from '../auth.ts'

import type { WalletSession } from './model.ts'

export type FundingAsset = Readonly<{
  asset_id: string
  blockchain: string
  symbol: string
  decimals: number
  contract?: string
  price: number | null
}>

export type SourcePayment = Readonly<{
  asset: FundingAsset
  recipient: string
  amount: bigint
}>

export type FundingBalance = FundingAsset & Readonly<{ balance: bigint }>
export type FundingBalances = Readonly<{ assets: readonly FundingBalance[]; failed: boolean }>

export type CryptoWalletSession = WalletSession &
  Readonly<{
    family: 'evm' | 'solana'
    is_transaction_idle: () => boolean
    balance: (asset: FundingAsset) => Promise<bigint>
    balances: (assets: readonly FundingAsset[], signal: Readonly<AbortSignal>) => Promise<FundingBalances>
    send: (payment: SourcePayment, submitting: () => void) => Promise<string>
  }>

export type ExternalSession = AuthSession | CryptoWalletSession

/** Sui-only features derive their capability from the one selected external wallet. */
export const sui_session = (session: ExternalSession | null): AuthSession | null =>
  session && !('family' in session) ? session : null

export const crypto_session = (session: ExternalSession | null): CryptoWalletSession | null =>
  session && 'family' in session ? session : null
