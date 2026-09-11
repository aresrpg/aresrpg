// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'
import { EnokiKeypair } from '@mysten/enoki'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'

// Synthetic identity metadata, not a valid ZK proof. These checks exercise Enoki's
// address reconstruction before signing, not proof verification or BCS decoding.
// Pin both seed=1 Google addresses observed with Sui 2.29.0 before upgrading.
const addresses = [
  '0xd41c7cbc0cbccb9e7ab701373f3b5f082cc0024098f2ab561ff342107b91491f',
  '0xbe183ecded8d416e768672f3e161e0093bcbce4cdeea3342e719b65ec94e8e16',
] as const
const proof = {
  addressSeed: '1',
  issBase64Details: {
    value: Buffer.from('"iss":"https://accounts.google.com",').toString('base64url'),
    indexMod4: 0,
  },
  headerBase64: '',
  proofPoints: { a: [], b: [], c: [] },
}

for (const address of addresses) {
  test(`Enoki reconstructs the existing leading-zero-seed account ${address}`, () => {
    for (const max_epoch of [100, 200]) {
      const keypair = new EnokiKeypair({
        address,
        proof,
        maxEpoch: max_epoch,
        ephemeralKeypair: new Ed25519Keypair(),
      })
      expect(keypair.getPublicKey().toSuiAddress()).toBe(address)
      expect(keypair.getPublicKey().verifyAddress(address)).toBe(true)
    }
  })
}

test('Enoki refuses an account address that cannot be reconstructed from the supplied identity', () => {
  const create = (address: string, address_seed = '1') =>
    new EnokiKeypair({
      address,
      proof: { ...proof, addressSeed: address_seed },
      maxEpoch: 100,
      ephemeralKeypair: new Ed25519Keypair(),
    })
  expect(() => create(`0x${'ab'.repeat(32)}`)).toThrow('Proof does not match address')
  expect(() => create(addresses[0], '2')).toThrow('Proof does not match address')
  expect(() => create(addresses[1], '2')).toThrow('Proof does not match address')
})
