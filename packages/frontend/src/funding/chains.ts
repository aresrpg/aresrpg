// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

// LI.FI mainnet chain/token identifiers, verified against /v1/chains on 2026-09-26.
export const FUNDING_SUI_CHAIN = 9270000000000000
export const FUNDING_SOLANA_CHAIN = 1151111081099710
export const FUNDING_SUI_TOKEN = `0x${'2'.padStart(64, '0')}::sui::SUI`
export const FUNDING_SOURCE_CHAINS = [1, 10, 56, 137, 42161, 8453, 43114, FUNDING_SOLANA_CHAIN] as const
