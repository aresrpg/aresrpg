// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
export const configuration = (env: Readonly<Record<string, string | undefined>>) => {
  const required = (key: string, pattern = /\S/): string => {
    const value = env[key]
    if (!value || !pattern.test(value)) throw new Error(`Missing or invalid ${key}`)
    return value
  }
  const channel = required('DISCORD_CHANNEL_ID', /^\d+$/)
  const network = required('SUI_NETWORK', /^(mainnet|testnet)$/) as 'mainnet' | 'testnet'
  const lineage = required('PACKAGE_ORIGINAL', /^0x[0-9a-f]{64}$/)
  return {
    token: required('DISCORD_BOT_TOKEN'),
    channel,
    network,
    lineage,
    redis_url: required('GRAPH_URL', /^rediss?:\/\//),
    rpc_url: required('SUI_RPC_URL', /^https?:\/\//),
    scope: `${network}:${lineage}:${channel}`,
  }
}
