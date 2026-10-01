// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

export const SOLANA_RPC_PATH = '/api/solana'

// Balance, preparation and confirmation reads used by LI.FI's Solana provider and toolkit.
export const SOLANA_RPC_READ_METHODS: readonly string[] = Object.freeze([
  'getSlot',
  'getBalance',
  'getTokenAccountsByOwner',
  'getAccountInfo',
  'getMultipleAccounts',
  'getLatestBlockhash',
  'getSignatureStatuses',
  'isBlockhashValid',
  'getFeeForMessage',
  'getRecentPrioritizationFees',
  'getMinimumBalanceForRentExemption',
  'simulateTransaction',
])
