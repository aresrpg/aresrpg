// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { AgentPairingIdentity } from '@aresrpg/protocol'

import type { AuthSession } from '../auth.ts'
import type { SessionState } from '../modules/session.ts'
import type { AppInput } from '../store.ts'

import { same_inventory_pairing } from './inventory_state.ts'

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

/** Fresh proof can restore this account's authority without replacing an explicitly selected recovery account. */
export const refreshed_inventory_target = (
  current: AgentPairingIdentity | null,
  incoming: AgentPairingIdentity | null
) => {
  if (
    current?.signer_mode === 'disposable' &&
    !same_inventory_pairing(current, incoming && { ...incoming, signer_mode: 'disposable' })
  )
    return current
  return same_inventory_pairing(current, incoming) ? current : incoming
}
