// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
export type AgentSignerMode = 'disposable' | 'host-persistent'
export type AgentPairingIdentity = Readonly<{
  address: string
  multisig_public_key: string
  signer_mode: AgentSignerMode
}>
export const AGENT_SETUP_PATH = '/api/agent-setup'
export type AgentSetupRequest =
  | Readonly<{ action: 'begin'; public_identifier: string }>
  | Readonly<{ action: 'status' | 'cancel'; pairing_id: string }>
export type AgentSetupResult =
  | Readonly<{ action: 'begin'; pairing_id: string; token: string }>
  | Readonly<{ action: 'status'; identity: AgentPairingIdentity | null }>
  | Readonly<{ action: 'cancel' }>
  | Readonly<{ action: 'error'; error: 'unavailable' | 'rate_limited' }>
export const valid_agent_setup_request = (value: unknown): value is AgentSetupRequest => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const request = value as Record<string, unknown>
  if (Object.keys(request).length !== 2) return false
  if (request.action === 'begin') return typeof request.public_identifier === 'string'
  return (request.action === 'status' || request.action === 'cancel') && typeof request.pairing_id === 'string'
}

export type AgentObservation = Readonly<{
  pairing: AgentPairingIdentity
  public_identifier: string
  character_id: string | null
}>
export const valid_agent_observation = (value: unknown): value is AgentObservation => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const row = value as Record<string, unknown>
  const pairing = row.pairing as Record<string, unknown> | null
  return (
    typeof row.public_identifier === 'string' &&
    (row.character_id === null || /^0x[0-9a-f]{64}$/.test(String(row.character_id))) &&
    !!pairing &&
    typeof pairing.multisig_public_key === 'string' &&
    /^0x[0-9a-f]{64}$/.test(String(pairing.address)) &&
    (pairing.signer_mode === 'disposable' || pairing.signer_mode === 'host-persistent')
  )
}
