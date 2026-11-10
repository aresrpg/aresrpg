// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { AgentPairingIdentity, HostedOwnerStatus, HostedBotDescriptor } from '@aresrpg/protocol'

import type { AuthSession } from '../auth.ts'
import type { SessionState } from '../modules/session.ts'
import type { AppInput } from '../store.ts'

import { refreshed_inventory_target } from './inventory_target.ts'

export type OwnerConnection = Readonly<{
  generation: number
  phase: 'idle' | 'checking' | 'ready' | 'failed' | 'unavailable' | 'returning'
  response: HostedOwnerStatus | null
  pairing: AgentPairingIdentity | null
}>
export const initial_owner_connection = (): OwnerConnection => ({
  generation: 0,
  phase: 'idle',
  response: null,
  pairing: null,
})
export type OwnerConnectionInput = Readonly<
  | { type: 'agent/connection_refresh' }
  | { type: 'agent/connection_cancel' }
  | { type: 'agent/return_running'; wallet: AuthSession; active: boolean }
  | { type: 'agent/return_updated'; wallet: AuthSession; bot: HostedBotDescriptor }
  | {
      type: 'agent/connection_result'
      wallet: AuthSession
      generation: number
      response: HostedOwnerStatus | null
      pairing: AgentPairingIdentity | null
      failure: 'unavailable' | 'failed' | null
    }
>

/** All asynchronous owner inputs share one wallet lifetime; verification also carries its request generation. */
const accepts_owner_input = (session: SessionState, input: AppInput) => {
  if ('wallet' in input && input.wallet !== session.wallet) return false
  if (input.type !== 'agent/connection_result') return true
  return input.generation === session.agent_connection.generation && session.agent_connection.phase === 'checking'
}

/** The client verifies owner/status/proof; this reducer owns their lifetime and the inventory target. */
export const fold_owner_connection = (session: SessionState, input: AppInput): SessionState => {
  if (!accepts_owner_input(session, input)) return session
  const current = session.agent_connection
  switch (input.type) {
    case 'agent/return_running':
      return { ...session, agent_connection: { ...current, phase: input.active ? 'returning' : 'ready' } }
    case 'agent/return_updated':
      return {
        ...session,
        inventory_pairing: {
          address: input.bot.address,
          multisig_public_key: input.bot.multisig_public_key,
          signer_mode: 'disposable',
        },
        agent_connection: {
          generation: current.generation + 1,
          phase: current.phase === 'returning' ? 'returning' : 'ready',
          pairing: null,
          response: {
            owner: input.wallet.address,
            status: 'disconnected',
            bot: input.bot,
            recovery_bots: [],
            expires_at: null,
          },
        },
      }
    case 'agent/connection_refresh':
      if (!session.wallet || ['checking', 'returning'].includes(current.phase)) return session
      return { ...session, agent_connection: { ...current, generation: current.generation + 1, phase: 'checking' } }
    case 'agent/connection_cancel':
      return {
        ...session,
        agent_pairing_candidate: null,
        inventory_pairing: null,
        agent_connection: { ...initial_owner_connection(), generation: current.generation + 1, phase: 'failed' },
      }
    case 'agent/connection_result':
      return {
        ...session,
        agent_pairing_candidate: null,
        inventory_pairing: refreshed_inventory_target(session.inventory_pairing, input.pairing),
        agent_connection: {
          ...current,
          phase: input.failure ?? 'ready',
          response: input.response,
          pairing: input.pairing,
        },
      }
    default:
      return session
  }
}

/** Connection display requires both current owner authorization and the matching fresh custody proof. */
export const owner_connected = (session: SessionState): boolean => {
  const { response, pairing } = session.agent_connection
  if (!response || response.status !== 'connected' || !response.bot || !pairing) return false
  return [
    response.owner === session.wallet?.address,
    Number(response.expires_at) > Date.now(),
    pairing.signer_mode === 'host-persistent',
    pairing.address === response.bot.address,
    pairing.multisig_public_key === response.bot.multisig_public_key,
  ].every(Boolean)
}
