// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { AgentPairingIdentity } from '@aresrpg/protocol'

import type { AuthSession } from '../auth.ts'
import type { SessionState } from '../modules/session.ts'
import type { AppInput } from '../store.ts'

export type AgentInventoryInput = Readonly<
  | { type: 'agent/inventory_target'; wallet: AuthSession; pairing: AgentPairingIdentity | null }
  | { type: 'agent/pairing_verified'; wallet: AuthSession; pairing: AgentPairingIdentity }
>

/** Proof discovers an unconfirmed candidate; explicit comparison alone selects a transfer target. */
export const fold_agent_inventory_target = (session: SessionState, input: AppInput): SessionState => {
  if (input.type !== 'agent/inventory_target' && input.type !== 'agent/pairing_verified') return session
  if (input.wallet !== session.wallet) return session
  const pairing = input.pairing && Object.freeze({ ...input.pairing })
  if (input.type === 'agent/pairing_verified')
    return { ...session, agent_pairing_candidate: pairing, inventory_pairing: null }
  return {
    ...session,
    inventory_pairing: pairing,
    agent_pairing_candidate: pairing ? null : (session.inventory_pairing ?? session.agent_pairing_candidate),
  }
}
