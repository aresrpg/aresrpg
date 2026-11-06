// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { parseSerializedSignature, type PublicKey } from '@mysten/sui/cryptography'
import { MultiSigPublicKey } from '@mysten/sui/multisig'
import { fromBase64, toBase64 } from '@mysten/sui/utils'
import { publicKeyFromRawBytes, verifyPersonalMessageSignature } from '@mysten/sui/verify'
import { ZkLoginPublicIdentifier } from '@mysten/sui/zklogin'

type PersonalMessageProof = Readonly<{ bytes: string; signature: string }>
type AgentMultisigOptions = Readonly<{
  agent_public_key: PublicKey
  zklogin_public_identifier: ZkLoginPublicIdentifier
  sign_personal_message: (message: Uint8Array) => Promise<PersonalMessageProof>
}>

/** Agent-only personal-message signing for a fixed agent-first, 1-of-2 identity.
 * The Google member is a stable identifier, never its ephemeral session key.
 * No transaction signing or secret custody is provided by this adapter. */
export const create_agent_identity = (options: Omit<AgentMultisigOptions, 'sign_personal_message'>) => {
  const flag = options.agent_public_key.flag()
  if (![0, 1, 2].includes(flag)) throw new Error('Agent must use an ordinary keypair public key.')
  const scheme = (['ED25519', 'Secp256k1', 'Secp256r1'] as const)[flag]!
  const agent = publicKeyFromRawBytes(scheme, options.agent_public_key.toRawBytes().slice())
  const google = ZkLoginPublicIdentifier.fromBytes(options.zklogin_public_identifier.toRawBytes().slice(), {
    legacyAddress: false,
  })
  const public_key = MultiSigPublicKey.fromPublicKeys({
    threshold: 1,
    publicKeys: [
      { publicKey: agent, weight: 1 },
      { publicKey: google, weight: 1 },
    ],
  })
  return Object.freeze({ address: public_key.toSuiAddress(), public_key })
}

/** Add the ordinary member's personal-message signer to a public identity. */
export const create_agent_multisig = (options: AgentMultisigOptions) => {
  const identity = create_agent_identity(options)
  const { public_key } = identity
  const agent = public_key.getPublicKeys()[0]!.publicKey
  const scheme = (['ED25519', 'Secp256k1', 'Secp256r1'] as const)[agent.flag()]!
  const sign = options.sign_personal_message
  return Object.freeze({
    ...identity,
    sign_personal_message: async (message: Uint8Array): Promise<PersonalMessageProof> => {
      const original = message.slice()
      const { bytes, signature } = await sign(original.slice())
      if (toBase64(fromBase64(bytes)) !== toBase64(original))
        throw new Error('Agent signer returned different personal-message bytes.')
      if (fromBase64(signature)[0] === 5)
        throw new Error('zkLogin partial signatures are unsupported by this agent adapter.')
      const parsed = parseSerializedSignature(signature)
      if (
        parsed.signatureScheme !== scheme ||
        !('publicKey' in parsed) ||
        toBase64(parsed.publicKey) !== agent.toBase64()
      )
        throw new Error('Personal-message signature must belong to the configured agent member.')
      await verifyPersonalMessageSignature(original, signature, { address: agent.toSuiAddress() })
      return Object.freeze({ bytes: toBase64(original), signature: public_key.combinePartialSignatures([signature]) })
    },
  })
}
