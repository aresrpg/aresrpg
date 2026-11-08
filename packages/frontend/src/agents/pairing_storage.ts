// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { AgentPairingIdentity } from '@aresrpg/protocol'
import { owner_agent_identity } from '@aresrpg/sdk/agent-recall'
import type { AgentPairingRequest } from '@aresrpg/sdk/agent-pairing'

import type { AuthStorage } from '../auth_storage.ts'

const key = (owner: string) => `aresrpg.agent-identities:${owner}`
export const read_agent_identities = (
  storage: AuthStorage | null,
  request: AgentPairingRequest
): readonly AgentPairingIdentity[] => {
  try {
    const stored: unknown = JSON.parse(storage?.getItem(key(request.owner)) ?? '[]')
    if (!Array.isArray(stored)) return []
    return stored.map((identity: AgentPairingIdentity) => {
      owner_agent_identity(identity, request)
      // Restored public metadata permits recovery, never a new persistent-signer assertion.
      return Object.freeze({
        address: identity.address,
        multisig_public_key: identity.multisig_public_key,
        signer_mode: 'disposable' as const,
      })
    })
  } catch (error) {
    console.warn('Saved agent public identities could not be validated.', error)
    return []
  }
}
export const remember_agent_identity = (
  storage: AuthStorage | null,
  request: AgentPairingRequest,
  identity: AgentPairingIdentity
): void => {
  owner_agent_identity(identity, request)
  if (!storage) throw new Error('Browser storage is required to retain your agent recovery identity.')
  const previous = read_agent_identities(storage, request).filter((row) => row.address !== identity.address)
  storage.setItem(
    key(request.owner),
    JSON.stringify(
      [...previous, identity].map((row) => ({
        address: row.address,
        multisig_public_key: row.multisig_public_key,
      }))
    )
  )
}

/** A fresh setup must save public recovery metadata before it can publish a connected candidate. */
export const complete_agent_pairing = (
  storage: AuthStorage | null,
  request: AgentPairingRequest | null,
  identity: AgentPairingIdentity
): 'storage' | 'disposable' | null => {
  owner_agent_identity(identity, request)
  if (identity.signer_mode !== 'host-persistent') return 'disposable'
  try {
    if (!request) throw new Error('Google identity unavailable')
    remember_agent_identity(storage, request, identity)
    if (!read_agent_identities(storage, request).some((row) => row.address === identity.address))
      throw new Error('Recovery identity was not retained')
    return null
  } catch (error) {
    console.error('Agent recovery identity could not be saved.', error)
    return 'storage'
  }
}
