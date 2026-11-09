// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'

import { create_managed_agent_signer } from '../src/agent_signer.ts'

// Public deterministic fixture only, never a provisioned or funded wallet.
const key = Ed25519Keypair.fromSecretKey(new Uint8Array(32).fill(9))
test('managed RAW Ed25519 signatures equal Mysten transaction and personal intents', async () => {
  const inputs: Uint8Array[] = []
  const signer = create_managed_agent_signer({
    public_key: key.getPublicKey().toRawBytes(),
    sign_digest: async (bytes) => {
      inputs.push(bytes.slice())
      return key.sign(bytes)
    },
  })
  const message = new Uint8Array([1, 2, 3])
  expect(await signer.sign_personal_message(message)).toEqual(await key.signPersonalMessage(message))
  expect(await signer.sign_transaction(message)).toEqual(await key.signTransaction(message))
  expect(inputs.map((value) => value.length)).toEqual([32, 32])
  expect(inputs[0]).not.toEqual(inputs[1])
})
test('managed provider cannot substitute a different key', async () => {
  const signer = create_managed_agent_signer({
    public_key: key.getPublicKey().toRawBytes(),
    sign_digest: async () => new Uint8Array(64),
  })
  await expect(signer.sign_transaction(new Uint8Array([1]))).rejects.toThrow('invalid signature')
})
