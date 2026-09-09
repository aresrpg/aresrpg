// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { DEFAULT_NETWORK } from '@aresrpg/sdk/pins'

export const resolve_launch_env = (source: Readonly<Record<string, string | undefined>>) => {
  const network = source.VITE_NETWORK ?? DEFAULT_NETWORK
  if (network !== 'testnet' && network !== 'mainnet') throw new Error(`Unsupported launch network: ${network}`)
  const sui_rpc_url = source.VITE_SUI_RPC_URL ?? `https://fullnode.${network}.sui.io:443`
  const url = new URL(sui_rpc_url)
  if (url.protocol !== 'https:') throw new Error('The launchpad requires an HTTPS Sui endpoint')
  return Object.freeze({
    network,
    sui_rpc_url,
    testnet_game_url: 'https://aresrpg.world/',
    discord_url: 'https://discord.gg/aresrpg',
  })
}

const vite_env = (import.meta as ImportMeta & { readonly env?: Record<string, string | undefined> }).env ?? {}
export const env = resolve_launch_env(vite_env)
