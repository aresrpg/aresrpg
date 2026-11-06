// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { toZkLoginPublicIdentifier } from '@mysten/sui/zklogin'
import { Transaction } from '@mysten/sui/transactions'
import { fromBase64 } from '@mysten/sui/utils'

import { bootstrap_setup_link } from '../examples/agent_setup.ts'
import { prepare_agent_pairing } from '../src/agent_signer.ts'

// Publicly known synthetic fixture key, in memory only; never a user credential or funded identity.
const member = () => {
  const key = Ed25519Keypair.fromSecretKey(new Uint8Array(32).fill(9))
  return {
    storage: 'persistent' as const,
    public_key: key.getPublicKey(),
    sign_personal_message: (bytes: Uint8Array) => key.signPersonalMessage(bytes),
    sign_transaction: (bytes: Uint8Array) => key.signTransaction(bytes),
  }
}
const google = toZkLoginPublicIdentifier(1n, 'https://accounts.google.com', { legacyAddress: false })
const request = {
  version: 1,
  nonce: '11111111-1111-4111-8111-111111111111',
  network: 'mainnet',
  owner: google.toSuiAddress(),
  zklogin_public_identifier: google.toBase64(),
}

test('injected identity survives a fresh adapter without generating or storing a key', async () => {
  const first = await prepare_agent_pairing(request, member())
  const second = await prepare_agent_pairing(request, member())
  expect(first.signer.address).toBe(second.signer.address)
  expect(first.response.agent_public_key).toBe(member().public_key.toBase64())
})
test('injected transaction signature is verified and wrapped for the same multisig', async () => {
  const { signer } = await prepare_agent_pairing(request, member())
  const tx = new Transaction()
  tx.setSender(signer.address)
  tx.setGasPrice(1)
  tx.setGasBudget(1000000)
  tx.setGasPayment([{ objectId: `0x${'3'.repeat(64)}`, version: '1', digest: '11111111111111111111111111111111' }])
  const signed = await signer.sign_transaction(tx)
  expect(await signer.public_key.verifyTransaction(fromBase64(signed.bytes as string), signed.signature)).toBe(true)
})
test('a different pairing key cannot be substituted by an injected provider', async () => {
  const wrong = Ed25519Keypair.fromSecretKey(new Uint8Array(32).fill(8))
  await expect(
    prepare_agent_pairing(request, { ...member(), sign_personal_message: (bytes) => wrong.signPersonalMessage(bytes) })
  ).rejects.toThrow()
})

test('server setup can use the injected host signer without key generation or copyback', async () => {
  const client = await prepare_agent_pairing(request, member())
  let posted = false
  const signer = await bootstrap_setup_link(
    `http://localhost:9800/api/agent-setup?id=${request.nonce}#${'a'.repeat(43)}`,
    {
      bootstrap: async () => client,
      fetch: (async (_url, init) => {
        if (init?.method !== 'POST') return Response.json(request)
        posted = true
        expect(JSON.parse(String(init.body))).toEqual(client.response)
        return Response.json({
          address: client.signer.address,
          multisig_public_key: client.signer.public_key.toBase64(),
          signer_mode: client.response.signer_mode,
        })
      }) as typeof fetch,
    }
  )
  expect(posted).toBe(true)
  expect(signer.address).toBe(client.signer.address)
  expect('sign_transaction' in signer).toBe(true)
})
