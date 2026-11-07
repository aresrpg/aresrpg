// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { AgentPairingIdentity } from '@aresrpg/protocol'
import type { SuiGrpcClient } from '@mysten/sui/grpc'

import type { Sdk } from './client.ts'
import type { KioskCapLoader } from './kiosk_runner.ts'
import { owner_agent_identity, parse_agent_pairing_request } from './agent_pairing.ts'
import { agent_transfer_actions, type AgentTransferIntent } from './agent_transfer_actions.ts'

/** The ordinary wallet may deposit only into its canonical, freshly verified persistent pairing.
 * Resolve again for every prepare and confirm; restored public metadata is recovery-only. */
export const agent_deposit_actions = (
  sdk: Sdk,
  context: Readonly<{ address: string; client: SuiGrpcClient; kiosk_cap: KioskCapLoader; read_request: () => unknown }>,
  pairing: AgentPairingIdentity
) => {
  const identity = Object.freeze({ ...pairing })
  const recipient = (): string => {
    if (identity.signer_mode !== 'host-persistent') throw new Error('A verified persistent agent signer is required.')
    const request = parse_agent_pairing_request(context.read_request())
    if (request.owner !== context.address || request.network !== sdk.network)
      throw new Error('The paired Google wallet changed. Verify the agent again.')
    return owner_agent_identity(identity, request).address
  }
  recipient()
  const actions = agent_transfer_actions(sdk, {
    address: context.address,
    kiosk_cap: context.kiosk_cap,
    assets: { client: context.client, recipient },
  })
  return Object.freeze({
    sender: actions.sender,
    prepare: async (intent: AgentTransferIntent) => {
      if (intent.kind !== 'asset_offer') throw new Error('Select a deposit of items or coins.')
      return actions.prepare(intent)
    },
  })
}
