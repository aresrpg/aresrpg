// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { fromBase64 } from '@mysten/sui/utils'
import { ZkLoginPublicIdentifier } from '@mysten/sui/zklogin'

import { agent_pairing_message, parse_agent_pairing_request } from '../src/agent_pairing.ts'
import { create_agent_multisig } from '../src/agent_multisig.ts'

/** Disposable pairing bootstrap. Keep this object in the client process.
 * No key export, persistence, provider launch, transactions, or recovery is provided.
 * Never hand real assets to this disposable identity: process exit loses its agent key. */
export const bootstrap_disposable_agent = async (input: unknown) => {
  const request = parse_agent_pairing_request(input)
  const key = new Ed25519Keypair()
  const proof = await key.signPersonalMessage(agent_pairing_message(request))
  return Object.freeze({
    response: Object.freeze({
      signer_mode: 'disposable' as const,
      agent_public_key: key.getPublicKey().toBase64(),
      signature: proof.signature,
    }),
    signer: create_agent_multisig({
      agent_public_key: key.getPublicKey(),
      zklogin_public_identifier: ZkLoginPublicIdentifier.fromBytes(fromBase64(request.zklogin_public_identifier)),
      sign_personal_message: (message) => key.signPersonalMessage(message),
    }),
  })
}

/** Adapter for the existing bounded foreground kit; the environment contains a public file path only. */
export const create_signer = async () => {
  const path = process.env.ARESRPG_PAIRING_REQUEST
  if (!path) throw new Error('PAIRING_REQUEST_PATH_REQUIRED')
  const request = parse_agent_pairing_request(await Bun.file(path).json())
  const client = await bootstrap_disposable_agent(request)
  console.log(JSON.stringify({ type: 'pairing_response', response: client.response }))
  return client.signer
}
