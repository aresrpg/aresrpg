// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The server's one Sui read client. Player state still arrives through the indexer stream;
// direct reads are limited to transport admission and the shared indexer-health heartbeat.

import { SuiGrpcClient } from '@mysten/sui/grpc'

import { SUI_NETWORK, SUI_RPC_URL } from './env.ts'

export const sui_client = new SuiGrpcClient({
  network: SUI_NETWORK as 'testnet' | 'mainnet',
  baseUrl: SUI_RPC_URL,
})

export const latest_checkpoint = async (): Promise<number> => {
  const { response } = await sui_client.ledgerService.getServiceInfo({})
  const checkpoint = response.checkpointHeight
  if (checkpoint === undefined || checkpoint > BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error('fullnode returned no safe checkpoint height')
  return Number(checkpoint)
}
