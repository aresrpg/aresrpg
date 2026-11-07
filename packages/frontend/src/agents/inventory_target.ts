// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { AgentPairingIdentity } from '@aresrpg/protocol'

import type { AuthSession } from '../auth.ts'
import type { SessionState } from '../modules/session.ts'
import type { AppInput } from '../store.ts'

export type AgentInventoryInput = Readonly<{
  type: 'agent/inventory_target'
  wallet: AuthSession
  pairing: AgentPairingIdentity | null
}>

/** Explicit full-address verification selects this session's inventory, not a provider or observation. */
export const fold_agent_inventory_target = (session: SessionState, input: AppInput): SessionState => {
  if (input.type !== 'agent/inventory_target' || input.wallet !== session.wallet) return session
  return { ...session, inventory_pairing: input.pairing && Object.freeze({ ...input.pairing }) }
}
