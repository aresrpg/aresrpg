// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'

import { verify_wallet_message } from '../src/auth.ts'

test('campaign signatures bind both the wallet and exact intent', async () => {
  const signer = Ed25519Keypair.fromSecretKey(new Uint8Array(32).fill(7))
  const foreign = Ed25519Keypair.fromSecretKey(new Uint8Array(32).fill(8))
  const message = JSON.stringify({
    domain: 'https://aresrpg.world',
    action: 'submit_posts',
    nonce: 'one-use',
    posts: ['1'],
  })
  const { signature } = await signer.signPersonalMessage(new TextEncoder().encode(message))
  expect(await verify_wallet_message(message, signature, signer.toSuiAddress())).toBe(true)
  expect(await verify_wallet_message(message, signature, foreign.toSuiAddress())).toBe(false)
  await expect(verify_wallet_message(`${message}changed`, signature, signer.toSuiAddress())).rejects.toThrow()
})
