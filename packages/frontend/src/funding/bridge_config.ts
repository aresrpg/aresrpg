// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { ChainType, type WidgetConfig } from '@lifi/widget'

import type { Locale } from '../i18n/locale.ts'

import { SOLANA_RPC_PATH } from './solana_rpc_contract.ts'

// LI.FI mainnet chain/token identifiers, verified against /v1/chains on 2026-09-26.
export const FUNDING_SUI_CHAIN = 9270000000000000
export const FUNDING_SOLANA_CHAIN = 1151111081099710
export const FUNDING_SUI_TOKEN = `0x${'2'.padStart(64, '0')}::sui::SUI`
export const FUNDING_SOURCE_CHAINS = [1, 10, 56, 137, 42161, 8453, 43114, FUNDING_SOLANA_CHAIN] as const

export const bridge_config = (address: string, locale: Locale, origin: string): WidgetConfig => {
  if (!/^0x[0-9a-f]{64}$/iu.test(address)) throw new Error('Invalid funding address')
  const rpc_url = new URL(SOLANA_RPC_PATH, origin).href
  return {
    integrator: 'aresrpg',
    keyPrefix: `aresrpg-funding-${address.toLowerCase()}`,
    appearance: 'dark',
    variant: 'compact',
    buildUrl: false,
    sdkConfig: {
      routeOptions: { allowSwitchChain: false },
      rpcUrls: {
        [FUNDING_SOLANA_CHAIN]: {
          read: [rpc_url],
          write: ['https://solana-rpc.publicnode.com'],
        },
      },
    },
    toChain: FUNDING_SUI_CHAIN,
    toToken: FUNDING_SUI_TOKEN,
    toAddress: { address, chainType: ChainType.MVM },
    disabledUI: { toAddress: true, toToken: true },
    requiredUI: { toAddress: true },
    hiddenUI: { reverseTokensButton: true, language: true, appearance: true },
    chains: { from: { allow: [...FUNDING_SOURCE_CHAINS] }, to: { allow: [FUNDING_SUI_CHAIN] } },
    tokens: { to: { allow: [{ chainId: FUNDING_SUI_CHAIN, address: FUNDING_SUI_TOKEN }] } },
    languages: { default: locale === 'ru' ? 'en' : locale },
    walletConfig: { forceInternalWalletManagement: true },
    theme: {
      shape: { borderRadius: 4 },
      typography: { fontFamily: '"JetBrains Mono", monospace' },
      container: { width: '100%', maxWidth: 480, border: 0, margin: '0 auto' },
    },
  }
}
