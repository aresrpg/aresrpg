// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { parse_agent_pairing_request } from '@aresrpg/sdk/agent-pairing'
import { fromBase64, toBase64 } from '@mysten/sui/utils'
import { verifyPersonalMessageSignature } from '@mysten/sui/verify'

import type { OwnerChallenge } from './model.ts'

export type OwnerVerifier = (challenge: OwnerChallenge, signature: string) => Promise<void>
export const validate_owner = (owner: string, identifier: string) => {
  parse_agent_pairing_request({
    version: 1,
    nonce: '00000000-0000-4000-8000-000000000000',
    network: 'mainnet',
    owner,
    zklogin_public_identifier: identifier,
  })
}
export const create_owner_verifier =
  (client: NonNullable<Parameters<typeof verifyPersonalMessageSignature>[2]>['client']): OwnerVerifier =>
  async (challenge, signature) => {
    validate_owner(challenge.owner, challenge.zklogin_public_identifier)
    if (fromBase64(signature)[0] !== 5) throw new Error('google_login_required')
    const key = await verifyPersonalMessageSignature(new TextEncoder().encode(challenge.message), signature, {
      client,
      address: challenge.owner,
    })
    if (key.flag() !== 5 || toBase64(key.toRawBytes()) !== challenge.zklogin_public_identifier)
      throw new Error('owner_identity_mismatch')
  }
