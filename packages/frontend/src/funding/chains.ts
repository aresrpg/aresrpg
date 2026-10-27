// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import {
  mainnet,
  base,
  arbitrum,
  optimism,
  polygon,
  bsc,
  avalanche,
  gnosis,
  berachain,
  aurora,
  scroll,
  plasma,
  monad,
  xLayer,
} from 'viem/chains'
import type { Chain } from 'viem'

// 1Click catalogue names mapped to the canonical EIP-155 chain definitions.
export const EVM_CHAINS: Readonly<Record<string, Chain>> = {
  eth: mainnet,
  base,
  arb: arbitrum,
  op: optimism,
  pol: polygon,
  bsc,
  avax: avalanche,
  gnosis,
  bera: berachain,
  aurora,
  scroll,
  plasma,
  monad,
  xlayer: xLayer,
}

const NON_EVM_CHAINS: Readonly<Record<string, string>> = { sol: 'Solana', sui: 'Sui' }
export const chain_name = (blockchain: string): string =>
  EVM_CHAINS[blockchain]?.name ?? NON_EVM_CHAINS[blockchain] ?? blockchain
