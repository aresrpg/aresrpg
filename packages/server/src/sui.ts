// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The server's one Sui read client. Player state still arrives through the indexer stream;
// direct reads cover transport admission, the indexer-health heartbeat, and cached SuiNS display names.

import { SuiGrpcClient } from '@mysten/sui/grpc'

import { SUI_NETWORK, SUI_RPC_URL } from './env.ts'
import type { ChainCheckpoint } from './indexing_health.ts'

export const sui_client = new SuiGrpcClient({
  network: SUI_NETWORK as 'testnet' | 'mainnet',
  baseUrl: SUI_RPC_URL,
})

export const latest_checkpoint = async (): Promise<ChainCheckpoint> => {
  const { response } = await sui_client.ledgerService.getServiceInfo({})
  const checkpoint = response.checkpointHeight
  if (checkpoint === undefined || checkpoint > BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error('fullnode returned no safe checkpoint height')
  const { timestamp } = response
  if (!timestamp) throw new Error('fullnode returned no checkpoint timestamp')
  const timestamp_ms = Number(timestamp.seconds) * 1_000 + Math.floor(timestamp.nanos / 1_000_000)
  if (!Number.isSafeInteger(timestamp_ms) || timestamp_ms <= 0)
    throw new Error('fullnode returned no safe checkpoint timestamp')
  return Object.freeze({ sequence_number: Number(checkpoint), timestamp_ms })
}
