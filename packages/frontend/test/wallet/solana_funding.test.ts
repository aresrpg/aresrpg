// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'
import {
  address,
  createSolanaRpcFromTransport,
  getTransactionDecoder,
  getCompiledTransactionMessageDecoder,
  type RpcTransport,
} from '@solana/kit'
import type { BaseConnectedSolanaWallet } from '@privy-io/react-auth'

import { solana_balances, solana_send } from '../../src/wallet/solana_funding.ts'

import {
  SOLANA_SENDER,
  SOLANA_RECIPIENT,
  SOLANA_MINT,
  SOLANA_ACCOUNTS,
  solana_rpc_result,
} from './fixtures/solana_rpc.ts'

const decode = (bytes: Uint8Array) =>
  getCompiledTransactionMessageDecoder().decode(getTransactionDecoder().decode(bytes).messageBytes)
const fixture = (balance = 10_000_000_000) => {
  const transactions: Uint8Array[] = []
  const wallet = {
    address: SOLANA_SENDER,
    isConnected: async () => true,
    provider: {
      signAndSendTransaction: async ({ transaction, chain }: { transaction: Uint8Array; chain: string }) => {
        expect(chain).toBe('solana:mainnet')
        transactions.push(transaction)
        return { signature: new Uint8Array(64).fill(5) }
      },
    },
  } as unknown as BaseConnectedSolanaWallet
  const transport = async <TResponse>({ payload }: Parameters<RpcTransport>[0]): Promise<TResponse> => {
    const { id, method } = payload as { id: string; method: string }
    return { jsonrpc: '2.0', id, result: solana_rpc_result(method, balance) } as TResponse
  }
  const rpc = createSolanaRpcFromTransport(transport)
  return { wallet, rpc, transactions }
}

test('SOL transfers encode the exact quoted lamports in one source transaction', async () => {
  const { wallet, rpc, transactions } = fixture()
  await solana_send(
    wallet,
    {
      asset: { asset_id: 'sol', blockchain: 'sol', symbol: 'SOL', decimals: 9, price: 1 },
      recipient: SOLANA_RECIPIENT,
      amount: 123456n,
    },
    () => {},
    rpc
  )
  const message = decode(transactions[0])
  const [instruction] = message.instructions
  expect(Array.from(instruction.data!)).toEqual([2, 0, 0, 0, 64, 226, 1, 0, 0, 0, 0, 0])
  expect(instruction.accountIndices!.map((index) => message.staticAccounts[index])).toEqual([
    SOLANA_SENDER,
    SOLANA_RECIPIENT,
  ])
  expect(message.staticAccounts[instruction.programAddressIndex]).toBe(address('11111111111111111111111111111111'))
  expect(message.header.numSignerAccounts).toBe(1)
  expect(transactions).toHaveLength(1)
})

test('SPL funding gathers fragmented token accounts in one transaction and accounts for destination rent', async () => {
  const fixture_ok = fixture()
  const payment = {
    asset: { asset_id: 'usdc', blockchain: 'sol', symbol: 'USDC', decimals: 6, contract: SOLANA_MINT, price: 1 },
    recipient: SOLANA_RECIPIENT,
    amount: 1_000_000n,
  }
  await solana_send(fixture_ok.wallet, payment, () => {}, fixture_ok.rpc)
  const message = decode(fixture_ok.transactions[0])
  expect(message.instructions).toHaveLength(3)
  expect(message.header.numSignerAccounts).toBe(1)
  const [create, ...transfers] = message.instructions
  expect(Array.from(create.data!)).toEqual([1])
  expect(message.staticAccounts[create.programAddressIndex]).toBe(
    address('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL')
  )
  expect(
    transfers.map((instruction) =>
      new DataView(instruction.data!.buffer, instruction.data!.byteOffset).getBigUint64(1, true)
    )
  ).toEqual([400_000n, 600_000n])
  expect(transfers.map((instruction) => message.staticAccounts[instruction.accountIndices![0]])).toEqual([
    ...SOLANA_ACCOUNTS,
  ])
  expect(transfers.every((instruction) => instruction.data![0] === 12 && instruction.data![9] === 6)).toBe(true)
  expect(message.staticAccounts[create.accountIndices![2]]).toBe(SOLANA_RECIPIENT)
  expect(transfers.every((instruction) => instruction.accountIndices![2] === create.accountIndices![1])).toBe(true)
  const short = fixture(5000)
  await expect(solana_send(short.wallet, payment, () => {}, short.rpc)).rejects.toThrow('funding_source_gas')
  expect(short.transactions).toHaveLength(0)
})

test('Solana inventory reads all supported holdings in two calls and sums fragmented accounts', async () => {
  const methods: string[] = []
  const transport = async <TResponse>({ payload }: Parameters<RpcTransport>[0]): Promise<TResponse> => {
    const { id, method, params } = payload as { id: string; method: string; params: unknown[] }
    methods.push(method)
    if (method === 'getTokenAccountsByOwner')
      expect(params[1]).toEqual({ programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' })
    return { jsonrpc: '2.0', id, result: solana_rpc_result(method) } as TResponse
  }
  const assets = [
    { asset_id: 'sol', blockchain: 'sol', symbol: 'SOL', decimals: 9, price: 1 },
    { asset_id: 'usdc', blockchain: 'sol', symbol: 'USDC', decimals: 6, price: 1, contract: SOLANA_MINT },
    { asset_id: 'unowned', blockchain: 'sol', symbol: 'OTHER', decimals: 6, price: 1, contract: SOLANA_RECIPIENT },
    { asset_id: 'eth', blockchain: 'eth', symbol: 'ETH', decimals: 18, price: 1 },
  ]
  const snapshot = await solana_balances(
    fixture().wallet,
    assets,
    new AbortController().signal,
    createSolanaRpcFromTransport(transport)
  )
  expect(snapshot.assets.map(({ asset_id, balance }) => [asset_id, balance])).toEqual([
    ['sol', 10_000_000_000n],
    ['usdc', 1_300_000n],
    ['unowned', 0n],
  ])
  expect(snapshot.failed).toBe(false)
  expect(methods.toSorted()).toEqual(['getBalance', 'getTokenAccountsByOwner'])
})
