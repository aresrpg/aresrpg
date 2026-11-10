// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import { Ed25519PublicKey } from '@mysten/sui/keypairs/ed25519'
import { Transaction } from '@mysten/sui/transactions'
import { toZkLoginPublicIdentifier } from '@mysten/sui/zklogin'

import { agent_deposit_actions } from '../src/agent_deposit.ts'
import { create_agent_identity } from '../src/agent_multisig.ts'

const google = toZkLoginPublicIdentifier(1n, 'https://accounts.google.com', { legacyAddress: false })
const identity = create_agent_identity({
  agent_public_key: new Ed25519PublicKey(new Uint8Array(32).fill(9)),
  zklogin_public_identifier: google,
})
const pairing = {
  address: identity.address,
  multisig_public_key: identity.public_key.toBase64(),
  signer_mode: 'host-persistent' as const,
}
const request = {
  version: 1,
  nonce: '11111111-1111-4111-8111-111111111111',
  network: 'mainnet',
  owner: google.toSuiAddress(),
  zklogin_public_identifier: google.toBase64(),
}
const intent = {
  kind: 'asset_offer' as const,
  recipient: pairing.address,
  items: [],
  sui_mist: '10',
  kares_mist: '0',
  reserve_mist: '20',
}
const fixture = () => {
  let current = request
  const transactions: Transaction[] = []
  const sdk = {
    network: 'mainnet',
    synchronize_transactions: async () => {},
    tx: () => new Transaction(),
    pins: {},
    get_owned_kiosks: async () => ({ kioskOwnerCaps: [], hasNextPage: false }),
    sui_client: { core: { getBalance: async () => ({ balance: { balance: 1000n } }) } },
    simulate: async (tx: Transaction) => {
      tx.setGasBudget(100)
      return {
        Transaction: {
          effects: {
            status: { success: true },
            gasUsed: { computationCost: '10', storageCost: '0', storageRebate: '0' },
          },
        },
      }
    },
    execute: async (tx: Transaction) => {
      transactions.push(tx)
      return { Transaction: { digest: 'deposit' } }
    },
  }
  const context = {
    address: request.owner,
    client: {} as never,
    kiosk_cap: async () => null,
    read_request: () => current,
  }
  return {
    sdk,
    context,
    transactions,
    set_request: (next: typeof request) => {
      current = next
    },
  }
}

test('deposit refuses restored signer metadata, foreign Google identity and arbitrary destination', async () => {
  const f = fixture()
  expect(() => agent_deposit_actions(f.sdk as never, f.context, { ...pairing, signer_mode: 'disposable' })).toThrow(
    'persistent'
  )
  expect(() => agent_deposit_actions(f.sdk as never, { ...f.context, address: pairing.address }, pairing)).toThrow(
    'wallet changed'
  )
  const actions = agent_deposit_actions(f.sdk as never, f.context, pairing)
  await expect(actions.prepare({ ...intent, recipient: request.owner })).rejects.toThrow('Google owner')
  await expect(actions.prepare({ kind: 'asset_collect', items: [] })).rejects.toThrow('Select a deposit')
  expect(f.transactions).toHaveLength(0)
})

test('coin deposit uses the ordinary owner as sender and submits exactly once without a claim', async () => {
  const f = fixture()
  const actions = agent_deposit_actions(f.sdk as never, f.context, pairing)
  const review = await actions.prepare(intent)
  expect(review.sender).toBe(request.owner)
  expect(f.transactions).toHaveLength(0)
  await review.confirm()
  expect(f.transactions).toHaveLength(1)
  expect(f.transactions[0]!.getData().sender).toBe(request.owner)
  expect(f.transactions[0]!.getData().commands.some((command) => command.TransferObjects)).toBe(true)
  expect(f.transactions[0]!.getData().commands.some((command) => command.MoveCall)).toBe(false)
  await expect(review.confirm()).rejects.toThrow('already submitted')
})

test('a changed Google wallet invalidates a prepared deposit before any execution', async () => {
  const f = fixture()
  const actions = agent_deposit_actions(f.sdk as never, f.context, pairing)
  const review = await actions.prepare(intent)
  const other = toZkLoginPublicIdentifier(2n, 'https://accounts.google.com', { legacyAddress: false })
  f.set_request({ ...request, owner: other.toSuiAddress(), zklogin_public_identifier: other.toBase64() })
  await expect(review.confirm()).rejects.toThrow('wallet changed')
  expect(f.transactions).toHaveLength(0)
  await expect(review.confirm()).rejects.toThrow('already submitted')
})

test('unconfigured KARES cannot produce a review or execute', async () => {
  const f = fixture()
  const actions = agent_deposit_actions(f.sdk as never, f.context, pairing)
  await expect(actions.prepare({ ...intent, sui_mist: '0', kares_mist: '10' })).rejects.toThrow('not configured')
  expect(f.transactions).toHaveLength(0)
})
