// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'
import { encodeAbiParameters } from 'viem'
import type { BaseConnectedEthereumWallet } from '@privy-io/react-auth'

import { evm_balances, evm_send } from '../../src/wallet/evm_funding.ts'

const sender = `0x${'11'.repeat(20)}`
const recipient = `0x${'22'.repeat(20)}`
const token = `0x${'33'.repeat(20)}`
const asset = { asset_id: 'base-usdc', blockchain: 'base', symbol: 'USDC', decimals: 6, contract: token, price: 1 }
const source_wallet = (native_balance = '0xffffffffff', actual_account = sender) => {
  const requests: { method: string; params?: unknown }[] = []
  const wallet = {
    address: sender,
    switchChain: async () => {},
    getEthereumProvider: async () => ({
      request: async (request: { method: string; params?: unknown }) => {
        requests.push(request)
        const replies: Record<string, unknown> = {
          eth_chainId: '0x2105',
          eth_accounts: [actual_account],
          eth_estimateGas: '0x5208',
          eth_gasPrice: '0x1',
          eth_getBalance: native_balance,
          eth_sendTransaction: `0x${'ab'.repeat(32)}`,
        }
        if (!(request.method in replies)) throw new Error(`Unexpected RPC: ${request.method}`)
        return replies[request.method]
      },
    }),
  } as unknown as BaseConnectedEthereumWallet
  return { wallet, requests }
}

test('an ERC20 deposit transfers only the quoted amount to the deposit address without approvals', async () => {
  const { wallet, requests } = source_wallet()
  let submissions = 0
  await evm_send(wallet, { asset, recipient, amount: 1_300_000n }, () => {
    submissions++
  })
  expect(submissions).toBe(1)
  const transactions = requests.filter(({ method }) => method === 'eth_sendTransaction')
  expect(transactions).toHaveLength(1)
  const [transaction] = transactions[0].params as { from: string; to: string; data: string; value: string }[]
  expect(transaction.from).toBe(sender)
  expect(transaction.to).toBe(token)
  expect(transaction.data).toBe(
    `0xa9059cbb${recipient.slice(2).padStart(64, '0')}${1_300_000n.toString(16).padStart(64, '0')}`
  )
  expect(transaction.value).toBe('0x0')
})

test('source gas shortage and changed source account fail before any signing request', async () => {
  for (const fixture of [source_wallet('0x0'), source_wallet('0xffffffffff', recipient)]) {
    let submissions = 0
    await expect(
      evm_send(fixture.wallet, { asset, recipient, amount: 1n }, () => {
        submissions++
      })
    ).rejects.toThrow('funding_source_')
    expect(submissions).toBe(0)
    expect(fixture.requests.some(({ method }) => method === 'eth_sendTransaction')).toBe(false)
  }
})

test('EVM holdings use public batched reads without switching or prompting the connected wallet', async () => {
  const { wallet, requests } = source_wallet()
  const calls: string[] = []
  const send = (async (_url: string, options: RequestInit) => {
    const { method, id } = JSON.parse(String(options.body)) as { method: string; id: number }
    calls.push(method)
    const result =
      method === 'eth_getBalance'
        ? '0x1'
        : encodeAbiParameters(
            [
              {
                type: 'tuple[]',
                components: [
                  { name: 'success', type: 'bool' },
                  { name: 'returnData', type: 'bytes' },
                ],
              },
            ],
            [[{ success: true, returnData: encodeAbiParameters([{ type: 'uint256' }], [1_300_000n]) }]]
          )
    return Response.json({ jsonrpc: '2.0', id, result })
  }) as typeof fetch
  const native = { asset_id: 'base-eth', blockchain: 'base', symbol: 'ETH', decimals: 18, price: 1 }
  const snapshot = await evm_balances(wallet, [native, asset], new AbortController().signal, send)
  expect(snapshot.assets.map(({ asset_id, balance }) => [asset_id, balance])).toEqual([
    ['base-eth', 1n],
    ['base-usdc', 1_300_000n],
  ])
  expect(snapshot.failed).toBe(false)
  expect(calls.toSorted()).toEqual(['eth_call', 'eth_getBalance'])
  expect(requests).toEqual([])
})

test('an unavailable EVM token read preserves known holdings and reports an incomplete snapshot', async () => {
  const { wallet } = source_wallet()
  const send = (async (_url: string, options: RequestInit) => {
    const { method, id } = JSON.parse(String(options.body)) as { method: string; id: number }
    return Response.json(
      method === 'eth_getBalance'
        ? { jsonrpc: '2.0', id, result: '0x1' }
        : {
            jsonrpc: '2.0',
            id,
            error: { code: -32601, message: 'Not available' },
          }
    )
  }) as typeof fetch
  const native = { asset_id: 'base-eth', blockchain: 'base', symbol: 'ETH', decimals: 18, price: 1 }
  const snapshot = await evm_balances(wallet, [native, asset], new AbortController().signal, send)
  expect(snapshot.assets.map(({ asset_id }) => asset_id)).toEqual(['base-eth'])
  expect(snapshot.failed).toBe(true)
})
