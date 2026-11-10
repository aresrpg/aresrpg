// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { AgentPairingIdentity, HostedOwnerStatus } from '@aresrpg/protocol'

import type { AuthSession } from '../auth.ts'
import type { SessionState } from '../modules/session.ts'
import type { AppInput } from '../store.ts'

export type OwnerConnection = Readonly<{
  generation: number
  phase: 'idle' | 'checking' | 'ready' | 'failed'
  response: HostedOwnerStatus | null
}>
export const initial_owner_connection = (): OwnerConnection => ({ generation: 0, phase: 'idle', response: null })
export type OwnerConnectionInput = Readonly<
  | { type: 'agent/connection_refresh' }
  | { type: 'agent/connection_cancel' }
  | {
      type: 'agent/connection_result'
      wallet: AuthSession
      generation: number
      response: HostedOwnerStatus | null
      pairing: AgentPairingIdentity | null
    }
>

/** The client verifies owner/status/proof; this reducer owns their lifetime and the inventory target. */
export const fold_owner_connection = (session: SessionState, input: AppInput): SessionState => {
  const current = session.agent_connection
  switch (input.type) {
    case 'agent/connection_refresh':
      if (!session.wallet || current.phase === 'checking') return session
      return { ...session, agent_connection: { ...current, generation: current.generation + 1, phase: 'checking' } }
    case 'agent/connection_cancel':
      return {
        ...session,
        agent_pairing_candidate: null,
        inventory_pairing: null,
        agent_connection: { ...initial_owner_connection(), generation: current.generation + 1, phase: 'failed' },
      }
    case 'agent/connection_result':
      if (
        ![input.wallet === session.wallet, input.generation === current.generation, current.phase === 'checking'].every(
          Boolean
        )
      )
        return session
      return {
        ...session,
        agent_pairing_candidate: null,
        inventory_pairing: input.pairing,
        agent_connection: { ...current, phase: input.response ? 'ready' : 'failed', response: input.response },
      }
    default:
      return session
  }
}

/** Connection display requires both current owner authorization and the matching fresh custody proof. */
export const owner_connected = (session: SessionState): boolean => {
  const { response } = session.agent_connection
  const pairing = session.inventory_pairing
  if (!response || response.status !== 'connected' || !response.bot || !pairing) return false
  return [
    pairing.signer_mode === 'host-persistent',
    pairing.address === response.bot.address,
    pairing.multisig_public_key === response.bot.multisig_public_key,
  ].every(Boolean)
}
