// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import release from '../deployment/release.json' with { type: 'json' }

/**
 * @param {'testnet' | 'mainnet'} network
 * @param {'HSUI' | 'AFSUI'} symbol
 */
function release_token(network, symbol) {
  const token = release.networks[network].external_coin_types[symbol]
  if (!token?.type)
    throw new Error(
      `[supported_tokens] ${symbol} is not configured for ${network}`,
    )
  return {
    address: token.type,
    decimal: token.decimal,
    iconUrl: token.icon_url,
    symbol: token.symbol,
  }
}

export const HSUI = {
  mainnet: release_token('mainnet', 'HSUI'),
  testnet: release_token('testnet', 'HSUI'),
}
const AFSUI = {
  mainnet: release_token('mainnet', 'AFSUI'),
  testnet: release_token('testnet', 'AFSUI'),
}

export const SUPPORTED_TOKENS = network => ({
  [HSUI[network].address]: HSUI[network],
  [AFSUI[network].address]: AFSUI[network],
})
