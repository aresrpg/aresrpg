// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { ClientPacket } from '@aresrpg/protocol'
import { toBase64 } from '@mysten/sui/utils'

/** Shared browser/agent challenge boundary. Socket lifecycle remains the caller's job. */
export const create_login_response = async (
  signer: Readonly<{
    sign_personal_message: (message: Uint8Array) => Promise<Readonly<{ bytes: string; signature: string }>>
  }>,
  challenge: string
): Promise<Extract<ClientPacket, { type: 'packet/signature_response' }>> => {
  const message = new TextEncoder().encode(`aresrpg::${challenge}`)
  const expected = toBase64(message)
  const proof = await signer.sign_personal_message(message)
  if (proof.bytes !== expected || typeof proof.signature !== 'string' || proof.signature.length === 0)
    throw new Error('Signer returned a different message or empty signature')
  return Object.freeze({ type: 'packet/signature_response', bytes: proof.bytes, signature: proof.signature })
}
