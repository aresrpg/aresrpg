// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { AgentPairingIdentity, AgentSignerMode } from '@aresrpg/protocol'
import { MultiSigPublicKey } from '@mysten/sui/multisig'
import { Ed25519PublicKey } from '@mysten/sui/keypairs/ed25519'
import { fromBase64, toBase64 } from '@mysten/sui/utils'
import { verifyPersonalMessageSignature } from '@mysten/sui/verify'
import { ZkLoginPublicIdentifier } from '@mysten/sui/zklogin'

import { create_agent_identity } from './agent_multisig.ts'

export type AgentPairingRequest = Readonly<{
  version: 1
  nonce: string
  network: 'mainnet'
  owner: string
  zklogin_public_identifier: string
}>
export type AgentPairingResponse = Readonly<{
  agent_public_key: string
  signature: string
  signer_mode: AgentSignerMode
}>
const fields = ['version', 'nonce', 'network', 'owner', 'zklogin_public_identifier']

/** Public metadata only. The caller owns the current, single-use pairing request. */
export const parse_agent_pairing_request = (input: unknown): AgentPairingRequest => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('INVALID_PAIRING_REQUEST')
  const value = input as Record<string, unknown>
  const checks = [
    Object.keys(value).length === fields.length,
    Object.keys(value).every((key) => fields.includes(key)),
    value.version === 1,
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(String(value.nonce)),
    value.network === 'mainnet',
    /^0x[0-9a-f]{64}$/.test(String(value.owner)),
    typeof value.zklogin_public_identifier === 'string',
  ]
  if (!checks.every(Boolean)) throw new Error('INVALID_PAIRING_REQUEST')
  const request = value as AgentPairingRequest
  const bytes = fromBase64(request.zklogin_public_identifier)
  const issuer = new TextDecoder().decode(bytes.slice(1, 1 + bytes[0]!))
  if (issuer !== 'https://accounts.google.com' || bytes.length !== 1 + bytes[0]! + 32)
    throw new Error('INVALID_GOOGLE_IDENTIFIER')
  const google = ZkLoginPublicIdentifier.fromBytes(bytes, { address: request.owner })
  if (toBase64(google.toRawBytes()) !== request.zklogin_public_identifier) throw new Error('INVALID_PAIRING_IDENTIFIER')
  return Object.freeze({
    version: 1,
    nonce: request.nonce,
    network: request.network,
    owner: request.owner,
    zklogin_public_identifier: request.zklogin_public_identifier,
  })
}

const signer_mode_of = (mode: unknown): AgentSignerMode => {
  if (mode !== 'disposable' && mode !== 'host-persistent') throw new Error('INVALID_SIGNER_MODE')
  return mode
}

export const agent_pairing_message = (input: unknown, signer_mode: AgentSignerMode = 'disposable'): Uint8Array =>
  new TextEncoder().encode(
    `AresRPG agent pairing v1\nPublic-key association only; no asset transfer or transaction authority is granted by this message.\n${JSON.stringify(parse_agent_pairing_request(input))}\nSigner mode: ${signer_mode_of(signer_mode)}`
  )

/** Verify against the browser's pending request, never a request supplied by the response.
 * After success, discard that pending request. This proves agent key possession, not Google login. */
export const verify_agent_pairing = async (request: unknown, response: AgentPairingResponse) => {
  const parsed = parse_agent_pairing_request(request)
  const agent = new Ed25519PublicKey(fromBase64(response.agent_public_key))
  if (agent.toBase64() !== response.agent_public_key) throw new Error('INVALID_AGENT_PUBLIC_KEY')
  await verifyPersonalMessageSignature(
    agent_pairing_message(parsed, signer_mode_of(response.signer_mode)),
    response.signature,
    { address: agent.toSuiAddress() }
  )
  const identity = create_agent_identity({
    agent_public_key: agent,
    zklogin_public_identifier: ZkLoginPublicIdentifier.fromBytes(fromBase64(parsed.zklogin_public_identifier)),
  })
  return Object.freeze({
    address: identity.address,
    multisig_public_key: identity.public_key.toBase64(),
    signer_mode: response.signer_mode,
  })
}

/** Reconstruct the canonical identity and bind its Google member to the CURRENT wallet.
 * An exchange address or arbitrary multisig key alone never authorizes this signer. */
export const owner_agent_identity = (pairing: AgentPairingIdentity, request: unknown) => {
  const parsed = parse_agent_pairing_request(request)
  const supplied = new MultiSigPublicKey(fromBase64(pairing.multisig_public_key))
  const agent = supplied.getPublicKeys()[0]?.publicKey
  if (!agent) throw new Error('Agent member is missing.')
  const identity = create_agent_identity({
    agent_public_key: agent,
    zklogin_public_identifier: ZkLoginPublicIdentifier.fromBytes(fromBase64(parsed.zklogin_public_identifier)),
  })
  if (identity.address !== pairing.address || identity.public_key.toBase64() !== pairing.multisig_public_key)
    throw new Error('This Google wallet is not the paired recovery member.')
  return identity
}
