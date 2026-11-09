// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { create_managed_agent_signer } from '@aresrpg/sdk/agent-signer'

import type { ManagedProvider } from '../../src/managed_signer.ts'

/** Publicly known SDK fixture seed, never funded; no Redis or external key service. */
export const managed_provider_fixture = (): ManagedProvider => {
  const key = Ed25519Keypair.fromSecretKey(new Uint8Array(32).fill(9))
  const reference = { key_id: 'fixture:signing:known-test-key', public_key: key.getPublicKey().toBase64() }
  return {
    prepare: async () => ({ key: reference, sealed: 'public-test-fixture' }),
    signer: (requested) => {
      if (requested.key_id !== reference.key_id || requested.public_key !== reference.public_key)
        throw new Error('FIXTURE_SIGNING_KEY_MISMATCH')
      return create_managed_agent_signer({
        public_key: key.getPublicKey().toRawBytes(),
        sign_digest: (bytes) => key.sign(bytes),
      })
    },
  }
}
