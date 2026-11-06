// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import type { Wallet, WalletAccount } from '@mysten/wallet-standard'
import { toZkLoginPublicIdentifier } from '@mysten/sui/zklogin'

import { create_wallet_binding } from '../src/wallet_standard.ts'
import { bootstrap_disposable_agent } from '../examples/agent_bootstrap.ts'
import { verify_agent_pairing } from '../src/agent_pairing.ts'

const wallet = (enoki = true) =>
  ({
    features: {
      'standard:events': { on: () => () => undefined },
      ...(enoki
        ? {
            'enoki:getSession': {
              getSession: () => {
                throw new Error('Secret session access forbidden')
              },
            },
          }
        : {}),
      'sui:signPersonalMessage': {
        signPersonalMessage: () => {
          throw new Error('Wallet signing forbidden')
        },
      },
      'sui:signTransaction': {
        signTransaction: () => {
          throw new Error('Transaction signing forbidden')
        },
      },
    },
  }) as unknown as Wallet

for (const legacy_address of [false, true]) {
  test(`public wallet bridge pairs without signing or session secrets (legacy=${legacy_address})`, async () => {
    const google = toZkLoginPublicIdentifier(1n, 'https://accounts.google.com', { legacyAddress: legacy_address })
    const bytes = google.toRawBytes().slice()
    const account = {
      address: google.toSuiAddress(),
      publicKey: bytes,
      chains: ['sui:mainnet'],
      features: [],
    } as WalletAccount
    const binding = create_wallet_binding(wallet(), account, 'mainnet')
    bytes.fill(0)
    const request = binding.read_agent_pairing_request(crypto.randomUUID())!
    expect(request.owner).toBe(google.toSuiAddress())
    expect(request.network).toBe('mainnet')
    expect(request.zklogin_public_identifier).toBe(google.toBase64())
    const agent = await bootstrap_disposable_agent(request)
    expect((await verify_agent_pairing(request, agent.response)).address).toBe(agent.signer.address)
    binding.dispose()
    expect(() => binding.read_agent_pairing_request(crypto.randomUUID())).toThrow('disconnected')
  })
}

test('ordinary wallet has no Google pairing request and invalid metadata fails without signing', () => {
  const account = {
    address: `0x${'0'.repeat(64)}`,
    publicKey: new Uint8Array(32),
    chains: ['sui:mainnet'],
    features: [],
  } as WalletAccount
  const ordinary = create_wallet_binding(wallet(false), account, 'mainnet')
  expect(ordinary.read_agent_pairing_request(crypto.randomUUID())).toBeNull()
  ordinary.dispose()
  const invalid = create_wallet_binding(wallet(), account, 'mainnet')
  expect(() => invalid.read_agent_pairing_request(crypto.randomUUID())).toThrow()
  invalid.dispose()
})

test('a non-mainnet wallet session cannot produce a mainnet pairing request', () => {
  const google = toZkLoginPublicIdentifier(1n, 'https://accounts.google.com', { legacyAddress: false })
  const account = {
    address: google.toSuiAddress(),
    publicKey: google.toRawBytes(),
    chains: ['sui:testnet'],
    features: [],
  } as WalletAccount
  const binding = create_wallet_binding(wallet(), account, 'testnet')
  expect(() => binding.read_agent_pairing_request(crypto.randomUUID())).toThrow('INVALID_PAIRING_REQUEST')
  binding.dispose()
})
