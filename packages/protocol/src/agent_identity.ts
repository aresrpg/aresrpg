// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
export type AgentSignerMode = 'disposable' | 'host-persistent'
export type AgentPairingIdentity = Readonly<{
  address: string
  multisig_public_key: string
  signer_mode: AgentSignerMode
}>
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
