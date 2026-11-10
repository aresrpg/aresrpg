// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { AgentPairingIdentity } from '@aresrpg/protocol'
import type { SuiGrpcClient } from '@mysten/sui/grpc'

import type { Sdk } from './client.ts'
import type { KioskCapLoader } from './kiosk_runner.ts'
import { owner_agent_identity, parse_agent_pairing_request } from './agent_pairing.ts'
import { agent_transfer_actions, type AgentTransferIntent } from './agent_transfer_actions.ts'
import { read_agent_equipment, same_agent_equipment } from './agent_equipment.ts'

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
    check_offer: async (intent) => {
      if (intent.recipient !== recipient()) throw new Error('The paired recipient changed.')
      const equipment = await read_agent_equipment(context.client, sdk.game_type_package!, intent.character_id)
      if (!same_agent_equipment(equipment, intent.unequip ?? []))
        throw new Error('Equipment changed. Refresh before signing.')
    },
  })
  return Object.freeze({
    sender: actions.sender,
    synchronize: actions.synchronize,
    fits: actions.fits,
    quote: async (intent: AgentTransferIntent) => {
      if (intent.kind !== 'asset_offer' && intent.kind !== 'offer')
        throw new Error('Select a deposit of items, coins or a character.')
      return actions.quote(intent)
    },
    prepare: async (intent: AgentTransferIntent) => {
      if (intent.kind !== 'asset_offer' && intent.kind !== 'offer')
        throw new Error('Select a deposit of items, coins or a character.')
      return actions.prepare(intent)
    },
  })
}
