// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { Wallet as WalletStandard } from '@mysten/wallet-standard'

// SINGLE HOME — "is this the sponsorable zkLogin (Enoki) identity?" The Enoki wallet registered by
// registerEnokiWallets (auth/index.ts) exposes the `enoki:getSession` feature; a wallet-standard
// browser-extension session (Sui Wallet, Suiet, …) does not. MONEY LAW: only a zkLogin identity is ever
// sponsor-eligible — a connected wallet self-pays every transaction — so this predicate is the one input
// every sponsor route keys off (gameplay sponsor-first, the gas-selection fallback, and create + join).
export const ENOKI_SESSION_FEATURE = 'enoki:getSession'

export const is_zklogin_wallet = (wallet: WalletStandard): boolean => ENOKI_SESSION_FEATURE in wallet.features
