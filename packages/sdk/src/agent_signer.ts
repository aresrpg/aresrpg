// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { messageWithIntent, toSerializedSignature, type PublicKey } from '@mysten/sui/cryptography'
import { bcs } from '@mysten/sui/bcs'
import { Ed25519PublicKey } from '@mysten/sui/keypairs/ed25519'
import { blake2b } from '@noble/hashes/blake2.js'
import { fromBase64, toBase64 } from '@mysten/sui/utils'
import { ZkLoginPublicIdentifier } from '@mysten/sui/zklogin'

import { agent_pairing_message, parse_agent_pairing_request, verify_agent_pairing } from './agent_pairing.ts'
import { create_agent_multisig } from './agent_multisig.ts'
import { create_agent_transaction_signer } from './agent_transactions.ts'

/** Host-owned credentials. Provisioning and approval belong to the assistant environment.
 * This interface never exports a secret, creates a key, or implies that storage is durable. */
export type AgentMemberSigner = Readonly<{
  storage: 'persistent'
  public_key: PublicKey
  sign_personal_message: (bytes: Uint8Array) => Promise<Readonly<{ bytes: string; signature: string }>>
  sign_transaction: (bytes: Uint8Array) => Promise<Readonly<{ bytes: string; signature: string }>>
}>

export const prepare_agent_pairing = async (input: unknown, member: AgentMemberSigner) => {
  if (member.storage !== 'persistent') throw new Error('PERSISTENT_SIGNER_REQUIRED')
  const request = parse_agent_pairing_request(input)
  const message = agent_pairing_message(request, 'host-persistent')
  const proof = await member.sign_personal_message(message.slice())
  if (toBase64(fromBase64(proof.bytes)) !== toBase64(message)) throw new Error('PAIRING_BYTES_MISMATCH')
  const response = Object.freeze({
    signer_mode: 'host-persistent' as const,
    agent_public_key: member.public_key.toBase64(),
    signature: proof.signature,
  })
  await verify_agent_pairing(request, response)
  const identity = create_agent_multisig({
    agent_public_key: member.public_key,
    zklogin_public_identifier: ZkLoginPublicIdentifier.fromBytes(fromBase64(request.zklogin_public_identifier)),
    sign_personal_message: member.sign_personal_message,
  })
  return Object.freeze({
    response,
    signer: Object.freeze({
      ...identity,
      sign_transaction: create_agent_transaction_signer(identity, member.sign_transaction),
    }),
  })
}

/** Provider signs the supplied Sui intent digest as an ordinary Ed25519 RAW message, not a prehash variant. */
export const create_managed_agent_signer = ({
  public_key: raw_key,
  sign_digest,
}: Readonly<{
  public_key: Uint8Array
  sign_digest: (digest: Uint8Array) => Promise<Uint8Array>
}>): AgentMemberSigner => {
  const public_key = new Ed25519PublicKey(raw_key.slice())
  const sign = async (bytes: Uint8Array, intent: 'PersonalMessage' | 'TransactionData') => {
    const snapshot = bytes.slice()
    const message = intent === 'PersonalMessage' ? bcs.vector(bcs.u8()).serialize(snapshot).toBytes() : snapshot
    const digest = blake2b(messageWithIntent(intent, message), { dkLen: 32 })
    const signature = await sign_digest(digest.slice())
    if (!(await public_key.verify(digest, signature))) throw new Error('Managed signer returned an invalid signature')
    return {
      bytes: toBase64(snapshot),
      signature: toSerializedSignature({ signatureScheme: 'ED25519', signature, publicKey: public_key }),
    }
  }
  return Object.freeze({
    storage: 'persistent',
    public_key,
    sign_personal_message: (bytes: Uint8Array) => sign(bytes, 'PersonalMessage'),
    sign_transaction: (bytes: Uint8Array) => sign(bytes, 'TransactionData'),
  })
}
